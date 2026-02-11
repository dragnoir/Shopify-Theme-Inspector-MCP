/**
 * Profile History Storage
 *
 * Persists profiling results to disk so users can track performance trends
 * over time. Each profile run is stored as a compact snapshot with the key
 * metrics, and older entries are automatically pruned.
 *
 * Storage location: ~/.shopify-theme-inspector/history/
 * Format: One JSON file per store, containing an array of snapshots.
 */

import fs from "fs";
import path from "path";
import os from "os";
import type { ProfileSummary, TemplateStats, SlowNode } from "./flamegraph-parser.js";
import type { RecommendationsReport } from "./recommendations.js";

// ============================================================================
// Types
// ============================================================================

export interface ProfileSnapshot {
  id: string;                       // Unique ID (timestamp-based)
  storeUrl: string;
  pagePath: string;
  timestamp: string;                // ISO 8601
  totalRenderTimeMs: number;
  nodeCount: number;
  overallRating: string;            // fast | moderate | slow | critical
  recommendations: {
    critical: number;
    warning: number;
    info: number;
    estimatedSavingsMs: number;
  };
  topSlowTemplates: {               // Top 5 templates by time
    file: string;
    totalTime: number;
    renders: number;
    percentage: number;
  }[];
}

export interface ProfileTrend {
  storeUrl: string;
  pagePath: string;
  snapshots: ProfileSnapshot[];
  trend: {
    direction: "improving" | "degrading" | "stable" | "insufficient_data";
    latestMs: number;
    previousMs?: number;
    deltaMs?: number;
    deltaPercent?: number;
    averageMs: number;
    minMs: number;
    maxMs: number;
    dataPoints: number;
  };
}

// ============================================================================
// Storage
// ============================================================================

const HISTORY_DIR = path.join(os.homedir(), ".shopify-theme-inspector", "history");
const MAX_SNAPSHOTS_PER_PAGE = 50;

function ensureHistoryDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function storeKeyToFilename(storeUrl: string): string {
  return storeUrl
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .toLowerCase() + ".json";
}

interface StoreHistory {
  storeUrl: string;
  snapshots: ProfileSnapshot[];
  lastUpdated: string;
}

function loadStoreHistory(storeUrl: string): StoreHistory {
  ensureHistoryDir();
  const filePath = path.join(HISTORY_DIR, storeKeyToFilename(storeUrl));
  if (!fs.existsSync(filePath)) {
    return { storeUrl, snapshots: [], lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { storeUrl, snapshots: [], lastUpdated: new Date().toISOString() };
  }
}

function saveStoreHistory(history: StoreHistory): void {
  ensureHistoryDir();
  history.lastUpdated = new Date().toISOString();
  const filePath = path.join(HISTORY_DIR, storeKeyToFilename(history.storeUrl));
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Save a profiling snapshot to history.
 */
export function saveProfileSnapshot(
  storeUrl: string,
  pagePath: string,
  summary: ProfileSummary,
  report: RecommendationsReport,
): ProfileSnapshot {
  const snapshot: ProfileSnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    storeUrl: normalizeUrl(storeUrl),
    pagePath,
    timestamp: new Date().toISOString(),
    totalRenderTimeMs: report.totalRenderTimeMs,
    nodeCount: summary.nodeCount,
    overallRating: report.overallRating,
    recommendations: {
      critical: report.summary.critical,
      warning: report.summary.warning,
      info: report.summary.info,
      estimatedSavingsMs: report.summary.estimatedSavingsMs,
    },
    topSlowTemplates: summary.templateBreakdown.slice(0, 5).map((t) => ({
      file: t.file,
      totalTime: t.totalTime,
      renders: t.renders,
      percentage: t.percentage,
    })),
  };

  const history = loadStoreHistory(snapshot.storeUrl);

  // Add to the front (newest first)
  history.snapshots.unshift(snapshot);

  // Prune old entries per page path
  const pageGroups = new Map<string, ProfileSnapshot[]>();
  for (const s of history.snapshots) {
    const group = pageGroups.get(s.pagePath) || [];
    group.push(s);
    pageGroups.set(s.pagePath, group);
  }
  const pruned: ProfileSnapshot[] = [];
  for (const [, group] of pageGroups) {
    pruned.push(...group.slice(0, MAX_SNAPSHOTS_PER_PAGE));
  }
  history.snapshots = pruned.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  saveStoreHistory(history);
  return snapshot;
}

/**
 * Get profiling history for a specific store + page path.
 */
export function getProfileHistory(
  storeUrl: string,
  pagePath?: string,
  limit?: number
): ProfileTrend {
  const normalizedUrl = normalizeUrl(storeUrl);
  const history = loadStoreHistory(normalizedUrl);

  let snapshots = history.snapshots;
  const targetPath = pagePath || "/";

  if (pagePath !== undefined) {
    snapshots = snapshots.filter((s) => s.pagePath === targetPath);
  }

  if (limit && limit > 0) {
    snapshots = snapshots.slice(0, limit);
  }

  // Compute trend
  const trend = computeTrend(snapshots);

  return {
    storeUrl: normalizedUrl,
    pagePath: targetPath,
    snapshots,
    trend,
  };
}

/**
 * Get a list of all page paths that have been profiled for a store.
 */
export function getProfiledPages(storeUrl: string): { pagePath: string; count: number; lastProfiled: string }[] {
  const history = loadStoreHistory(normalizeUrl(storeUrl));
  const map = new Map<string, { count: number; lastProfiled: string }>();

  for (const s of history.snapshots) {
    const existing = map.get(s.pagePath);
    if (!existing || new Date(s.timestamp) > new Date(existing.lastProfiled)) {
      map.set(s.pagePath, {
        count: (existing?.count || 0) + 1,
        lastProfiled: s.timestamp,
      });
    } else {
      existing.count += 1;
    }
  }

  return Array.from(map.entries())
    .map(([pagePath, stats]) => ({ pagePath, ...stats }))
    .sort((a, b) => new Date(b.lastProfiled).getTime() - new Date(a.lastProfiled).getTime());
}

/**
 * Clear all history for a store (or a specific page).
 */
export function clearProfileHistory(storeUrl: string, pagePath?: string): number {
  const history = loadStoreHistory(normalizeUrl(storeUrl));
  const before = history.snapshots.length;

  if (pagePath) {
    history.snapshots = history.snapshots.filter((s) => s.pagePath !== pagePath);
  } else {
    history.snapshots = [];
  }

  saveStoreHistory(history);
  return before - history.snapshots.length;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
}

function computeTrend(
  snapshots: ProfileSnapshot[]
): ProfileTrend["trend"] {
  if (snapshots.length === 0) {
    return {
      direction: "insufficient_data",
      latestMs: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
      dataPoints: 0,
    };
  }

  if (snapshots.length === 1) {
    return {
      direction: "insufficient_data",
      latestMs: snapshots[0].totalRenderTimeMs,
      averageMs: snapshots[0].totalRenderTimeMs,
      minMs: snapshots[0].totalRenderTimeMs,
      maxMs: snapshots[0].totalRenderTimeMs,
      dataPoints: 1,
    };
  }

  const times = snapshots.map((s) => s.totalRenderTimeMs);
  const latest = times[0];
  const previous = times[1];
  const deltaMs = latest - previous;
  const deltaPercent = previous > 0 ? (deltaMs / previous) * 100 : 0;

  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  // Use threshold of 5% change to determine direction
  let direction: ProfileTrend["trend"]["direction"];
  if (Math.abs(deltaPercent) < 5) {
    direction = "stable";
  } else if (deltaMs < 0) {
    direction = "improving";
  } else {
    direction = "degrading";
  }

  return {
    direction,
    latestMs: Math.round(latest * 100) / 100,
    previousMs: Math.round(previous * 100) / 100,
    deltaMs: Math.round(deltaMs * 100) / 100,
    deltaPercent: Math.round(deltaPercent * 100) / 100,
    averageMs: Math.round(avg * 100) / 100,
    minMs: Math.round(min * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    dataPoints: times.length,
  };
}
