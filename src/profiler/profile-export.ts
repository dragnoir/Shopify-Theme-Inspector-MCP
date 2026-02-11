/**
 * Profile Export Module
 *
 * Generates exportable reports from profiling data in multiple formats:
 *   - Speedscope JSON (for visualization at speedscope.app)
 *   - CSV summary (for spreadsheets)
 *   - Markdown report (for sharing / documentation)
 */

import fs from "fs";
import path from "path";
import type { ProfilingData, ProfileSummary, TemplateStats, SlowNode } from "./flamegraph-parser.js";
import type { RecommendationsReport, Recommendation } from "./recommendations.js";

// ============================================================================
// Types
// ============================================================================

export interface ExportResult {
  format: string;
  filePath?: string;        // If saved to file
  content: string;          // The exported content
  speedscopeUrl?: string;   // For speedscope JSON exports
}

export interface ExportOptions {
  storeUrl: string;
  pagePath: string;
  data: ProfilingData;
  summary: ProfileSummary;
  recommendations: RecommendationsReport;
}

// ============================================================================
// Speedscope JSON Export
// ============================================================================

/**
 * Export raw profiling data as speedscope-compatible JSON.
 * The raw data from Shopify is already in speedscope format,
 * so we just return it as-is with optional file save.
 */
export function exportSpeedscopeJson(
  options: ExportOptions,
  outputPath?: string
): ExportResult {
  const rawData = options.data.raw;

  // The raw data is already speedscope format
  const json = JSON.stringify(rawData, null, 2);

  if (outputPath) {
    const resolvedPath = resolvePath(outputPath);
    ensureDir(path.dirname(resolvedPath));
    fs.writeFileSync(resolvedPath, json);
  }

  // Generate a speedscope.app URL using the hash-based loader
  // speedscope.app supports loading via URL hash with base64 data
  // but for large files, we recommend the local file approach
  const speedscopeUrl = "https://www.speedscope.app/";

  return {
    format: "speedscope-json",
    filePath: outputPath ? resolvePath(outputPath) : undefined,
    content: json,
    speedscopeUrl,
  };
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Export profiling summary as CSV for spreadsheet analysis.
 * Includes template breakdown and recommendations.
 */
export function exportCsv(
  options: ExportOptions,
  outputPath?: string
): ExportResult {
  const { summary, recommendations, storeUrl, pagePath } = options;
  const lines: string[] = [];

  // Header section
  lines.push("Shopify Liquid Profile Report");
  lines.push(`Store,${csvEscape(storeUrl)}`);
  lines.push(`Page,${csvEscape(pagePath)}`);
  lines.push(`Date,${new Date().toISOString()}`);
  lines.push(`Total Render Time (ms),${summary.totalRenderTime}`);
  lines.push(`Overall Rating,${recommendations.overallRating}`);
  lines.push(`Node Count,${summary.nodeCount}`);
  lines.push("");

  // Template breakdown
  lines.push("--- Template Breakdown ---");
  lines.push("File,Total Time (ms),Self Time (ms),Renders,Percentage (%)");
  for (const t of summary.templateBreakdown) {
    lines.push(
      `${csvEscape(t.file)},${t.totalTime},${t.selfTime},${t.renders},${t.percentage}`
    );
  }
  lines.push("");

  // Top slow nodes
  lines.push("--- Top Slow Nodes ---");
  lines.push("Name,Type,File,Line,Time (ms),Percentage (%)");
  for (const n of summary.topSlowNodes) {
    lines.push(
      `${csvEscape(n.name)},${n.type},${csvEscape(n.file || "")},${n.line || ""},${n.time},${n.percentage}`
    );
  }
  lines.push("");

  // Recommendations
  lines.push("--- Recommendations ---");
  lines.push("Severity,Category,Title,File,Line,Impact (ms),Impact (%),Description,Suggestion");
  for (const r of recommendations.recommendations) {
    lines.push(
      [
        r.severity,
        csvEscape(r.category),
        csvEscape(r.title),
        csvEscape(r.file || ""),
        r.line || "",
        r.impact.timeMs,
        r.impact.percentage,
        csvEscape(r.description),
        csvEscape(r.suggestion),
      ].join(",")
    );
  }

  const csv = lines.join("\n");

  if (outputPath) {
    const resolvedPath = resolvePath(outputPath);
    ensureDir(path.dirname(resolvedPath));
    fs.writeFileSync(resolvedPath, csv);
  }

  return {
    format: "csv",
    filePath: outputPath ? resolvePath(outputPath) : undefined,
    content: csv,
  };
}

// ============================================================================
// Markdown Report Export
// ============================================================================

/**
 * Generate a comprehensive Markdown report suitable for sharing.
 */
export function exportMarkdown(
  options: ExportOptions,
  outputPath?: string
): ExportResult {
  const { storeUrl, pagePath, summary, recommendations: report } = options;
  const lines: string[] = [];

  // Header
  lines.push(`# Shopify Liquid Performance Report`);
  lines.push("");
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| **Store** | \`${storeUrl}\` |`);
  lines.push(`| **Page** | \`${pagePath}\` |`);
  lines.push(`| **Date** | ${new Date().toISOString()} |`);
  lines.push(`| **Total Render Time** | ${summary.totalRenderTime}ms |`);
  lines.push(`| **Rating** | ${ratingBadge(report.overallRating)} |`);
  lines.push(`| **Nodes Analyzed** | ${summary.nodeCount} |`);
  lines.push("");

  // Summary box
  lines.push(`## Summary`);
  lines.push("");
  if (report.recommendations.length === 0) {
    lines.push(`✅ **No performance issues detected.** The page renders efficiently.`);
  } else {
    lines.push(
      `Found **${report.recommendations.length}** recommendation(s): ` +
      `🔴 ${report.summary.critical} critical, ` +
      `🟡 ${report.summary.warning} warnings, ` +
      `🔵 ${report.summary.info} info.`
    );
    if (report.summary.estimatedSavingsMs > 0) {
      lines.push("");
      lines.push(
        `**Estimated savings:** ~${report.summary.estimatedSavingsMs}ms ` +
        `(${Math.round((report.summary.estimatedSavingsMs / summary.totalRenderTime) * 100)}% of total render time)`
      );
    }
  }
  lines.push("");

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push(`## Recommendations`);
    lines.push("");

    for (const rec of report.recommendations) {
      const icon = rec.severity === "critical" ? "🔴" : rec.severity === "warning" ? "🟡" : "🔵";
      lines.push(`### ${icon} ${rec.title}`);
      lines.push("");
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| **Severity** | ${rec.severity} |`);
      lines.push(`| **Category** | ${rec.category} |`);
      if (rec.file) lines.push(`| **File** | \`${rec.file}\`${rec.line ? `:${rec.line}` : ""} |`);
      lines.push(`| **Impact** | ${rec.impact.timeMs}ms (${rec.impact.percentage}%) |`);
      lines.push("");
      lines.push(`**Problem:** ${rec.description}`);
      lines.push("");
      lines.push(`**Fix:** ${rec.suggestion}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // Template breakdown
  lines.push(`## Template Breakdown`);
  lines.push("");
  lines.push(`| File | Total Time | Self Time | Renders | % of Total |`);
  lines.push(`|------|-----------|-----------|---------|------------|`);
  for (const t of summary.templateBreakdown.slice(0, 15)) {
    lines.push(
      `| \`${t.file}\` | ${t.totalTime}ms | ${t.selfTime}ms | ${t.renders} | ${t.percentage}% |`
    );
  }
  if (summary.templateBreakdown.length > 15) {
    lines.push(`| ... | ... | ... | ... | ... |`);
    lines.push(`| *${summary.templateBreakdown.length - 15} more templates* | | | | |`);
  }
  lines.push("");

  // Top slow nodes
  lines.push(`## Top Slow Nodes`);
  lines.push("");
  lines.push(`| Name | Type | File | Time | % of Total |`);
  lines.push(`|------|------|------|------|------------|`);
  for (const n of summary.topSlowNodes.slice(0, 10)) {
    lines.push(
      `| \`${truncate(n.name, 50)}\` | ${n.type} | ${n.file ? `\`${n.file}\`` : "—"}${n.line ? `:${n.line}` : ""} | ${n.time}ms | ${n.percentage}% |`
    );
  }
  lines.push("");

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(`*Generated by [Shopify Theme Inspector MCP](https://github.com/dragnoir/Shopify-Theme-Inspector-MCP) v0.3.0*`);
  lines.push("");

  const md = lines.join("\n");

  if (outputPath) {
    const resolvedPath = resolvePath(outputPath);
    ensureDir(path.dirname(resolvedPath));
    fs.writeFileSync(resolvedPath, md);
  }

  return {
    format: "markdown",
    filePath: outputPath ? resolvePath(outputPath) : undefined,
    content: md,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function ratingBadge(rating: string): string {
  switch (rating) {
    case "fast": return "🟢 Fast";
    case "moderate": return "🟡 Moderate";
    case "slow": return "🟠 Slow";
    case "critical": return "🔴 Critical";
    default: return rating;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.substring(0, max - 3) + "...";
}

function resolvePath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
