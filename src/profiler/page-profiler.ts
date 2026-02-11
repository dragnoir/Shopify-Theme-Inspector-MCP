/**
 * Shopify Liquid Page Profiler
 * 
 * This module profiles Shopify pages using the SAME mechanism as the Chrome
 * extension: sending an HTTP request with:
 *   - Accept: application/vnd.speedscope+json
 *   - Authorization: Bearer <storefront-renderer-devtools-token>
 * 
 * When Shopify receives this request, it returns the full Liquid render
 * profiling data in speedscope JSON format instead of the normal HTML page.
 * 
 * CRITICAL INSIGHT (from reverse-engineering the Chrome extension source):
 * The Chrome extension does NOT use cookies or ?profile_liquid=true.
 * It uses an OAuth2 Bearer token obtained through Shopify Identity, with
 * the storefront-renderer devtools scope. The response is pure JSON profiling
 * data in speedscope format.
 */

import { getProfilingAccessToken, getOAuthTokens } from "../auth/shopify-identity-oauth.js";
import { ProfileResult, ProfilingData, ProfileNode, parseProfilingTree } from "./flamegraph-parser.js";
import { analyzeProfile } from "./profile-analyzer.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// Speedscope data types (from the Chrome extension's expected response)
// ============================================================================

interface SpeedscopeFrame {
  name: string;
  file?: string;
  line?: number;
  col?: number;
}

interface SpeedscopeEvent {
  type: "O" | "C"; // Open or Close
  frame: number; // Index into shared.frames
  at: number; // Timestamp in microseconds
}

interface SpeedscopeEventedProfile {
  type: "evented";
  name: string;
  unit: string; // e.g., "microseconds"
  startValue: number;
  endValue: number;
  events: SpeedscopeEvent[];
}

interface SpeedscopeFile {
  $schema: string;
  profiles: SpeedscopeEventedProfile[];
  shared: {
    frames: SpeedscopeFrame[];
  };
  activeProfileIndex?: number;
  exporter?: string;
  name?: string;
}

// ============================================================================
// Public API
// ============================================================================

export interface ProfilePageOptions {
  storeUrl: string;
  pagePath: string;
  timeout?: number; // ms, default 30s
}

/**
 * Profile a Shopify store page using the OAuth2 Bearer token approach.
 * 
 * This is the CORRECT method, matching the Chrome extension:
 * 1. Fetch the page URL with Accept: application/vnd.speedscope+json
 * 2. Include Authorization: Bearer <subject_token>
 * 3. Parse the speedscope JSON response
 */
export async function profilePage(options: ProfilePageOptions): Promise<ProfileResult> {
  const { storeUrl, pagePath = "/", timeout = 30000 } = options;
  
  logger.info(`Profiling page: ${storeUrl}${pagePath}`);

  // Normalize the store URL
  const normalizedUrl = normalizeStoreUrl(storeUrl);

  // Try OAuth2 token-based profiling first (the correct method)
  const accessToken = await getProfilingAccessToken(normalizedUrl);
  
  if (!accessToken) {
    // Also try with the raw storeUrl in case it was stored differently
    const altToken = await getProfilingAccessToken(storeUrl);
    if (!altToken) {
      return {
        success: false,
        storeUrl: normalizedUrl,
        pagePath,
        error: "Not authenticated. Use the 'login' tool first to authenticate with Shopify Identity.",
      };
    }
    return await profileWithToken(normalizedUrl, pagePath, altToken, timeout);
  }

  return await profileWithToken(normalizedUrl, pagePath, accessToken, timeout);
}

/**
 * Profile a page using the Bearer token (replicating Chrome extension behavior)
 */
async function profileWithToken(
  storeUrl: string,
  pagePath: string,
  accessToken: string,
  timeout: number
): Promise<ProfileResult> {
  // Build the URL exactly as the Chrome extension does
  const cleanPath = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
  const profileUrl = `https://${storeUrl}${cleanPath}`;
  
  logger.info(`Fetching profiling data from: ${profileUrl}`);
  logger.info(`Using Bearer token auth (same as Chrome extension)`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(profileUrl, {
      method: "GET",
      headers: {
        "Accept": "application/vnd.speedscope+json",
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": "Shopify-Theme-Inspector-MCP/0.2.0",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        success: false,
        storeUrl,
        pagePath: cleanPath,
        error: `Profiling request failed: HTTP ${response.status} ${response.statusText}\n` +
               `URL: ${profileUrl}\n` +
               `Response: ${bodyText.substring(0, 500)}\n\n` +
               `This may mean:\n` +
               `- The OAuth token has expired (try logout + login again)\n` +
               `- The URL is not a valid Shopify storefront page\n` +
               `- The store doesn't support profiling for your account`,
      };
    }

    // Check Content-Type to see if we got JSON back
    const contentType = response.headers.get("content-type") || "";
    const responseBody = await response.text();

    logger.info(`Response Content-Type: ${contentType}`);
    logger.info(`Response body length: ${responseBody.length}`);
    logger.debug(`Response body preview: ${responseBody.substring(0, 500)}`);

    // Try to parse as speedscope JSON
    let jsonData: any;
    try {
      jsonData = JSON.parse(responseBody);
    } catch {
      // Response is HTML, not JSON — token may not be working
      logger.warn("Response is not JSON. Got HTML instead. Token may be invalid.");
      
      // Try to extract Server-Timing as fallback
      const serverTiming = response.headers.get("server-timing");
      if (serverTiming) {
        logger.info(`Found Server-Timing header: ${serverTiming}`);
        const basicData = parseServerTimingHeader(serverTiming);
        if (basicData) {
          return {
            success: true,
            storeUrl,
            pagePath: cleanPath,
            profileUrl,
            data: basicData,
            warning: "Got basic Server-Timing data only. The Bearer token may not have " +
                     "the correct scope or may have expired. Try 'logout' then 'login' again.",
            summary: analyzeProfile(basicData),
          };
        }
      }

      return {
        success: false,
        storeUrl,
        pagePath: cleanPath,
        error: `Expected speedscope JSON but got HTML response.\n` +
               `Content-Type: ${contentType}\n` +
               `Body preview: ${responseBody.substring(0, 300)}\n\n` +
               `The Bearer token may be invalid or expired. Try 'logout' then 'login' again.`,
      };
    }

    // We got JSON! Check if it's speedscope format
    if (isSpeedscopeFormat(jsonData)) {
      logger.info("✅ Got full speedscope profiling data!");
      const profilingData = parseSpeedscopeData(jsonData);
      return {
        success: true,
        storeUrl,
        pagePath: cleanPath,
        profileUrl,
        data: profilingData,
        summary: analyzeProfile(profilingData),
      };
    }

    // Got JSON but not speedscope format — might be another profiling format
    logger.info("Got JSON response but not in speedscope format. Trying alternative parsing...");
    logger.debug(`JSON keys: ${Object.keys(jsonData).join(", ")}`);

    // Check if it's a direct profiling data format
    if (jsonData.nodes || jsonData.children || jsonData.profiles || jsonData.profile) {
      const profilingData = normalizeGenericProfilingData(jsonData);
      return {
        success: true,
        storeUrl,
        pagePath: cleanPath,
        profileUrl,
        data: profilingData,
        summary: analyzeProfile(profilingData),
      };
    }

    // Unknown JSON format
    return {
      success: true,
      storeUrl,
      pagePath: cleanPath,
      profileUrl,
      data: {
        timestamp: new Date().toISOString(),
        totalTime: 0,
        nodeCount: 0,
        raw: jsonData,
        tree: { name: "root", type: "root", time: 0, totalTime: 0, children: [] },
      },
      warning: `Got JSON response but in an unexpected format. Keys: ${Object.keys(jsonData).join(", ")}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      storeUrl,
      pagePath,
      error: `Profiling failed: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Speedscope Format Parser
// ============================================================================

/**
 * Check if data is in speedscope format
 */
function isSpeedscopeFormat(data: any): data is SpeedscopeFile {
  return (
    data &&
    typeof data === "object" &&
    Array.isArray(data.profiles) &&
    data.shared &&
    Array.isArray(data.shared?.frames)
  );
}

/**
 * Parse speedscope format into our ProfilingData structure.
 * 
 * Speedscope format uses an "evented" profile with Open (O) and Close (C) events.
 * Each event references a frame index. By processing O/C events in order,
 * we can reconstruct a hierarchical call tree (flame graph).
 */
function parseSpeedscopeData(data: SpeedscopeFile): ProfilingData {
  const profiles = data.profiles;
  const frames = data.shared.frames;

  if (!profiles || profiles.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      totalTime: 0,
      nodeCount: 0,
      raw: data,
      tree: { name: "root", type: "root", time: 0, totalTime: 0, children: [] },
    };
  }

  // Use the first (usually only) profile
  const profile = profiles[0];
  const unit = profile.unit || "microseconds";
  const unitMultiplier = unit === "microseconds" ? 0.001 : unit === "milliseconds" ? 1 : 1;

  // Build the call tree from evented profile
  const rootNode: ProfileNode = {
    name: profile.name || "liquid",
    type: "root",
    time: 0,
    totalTime: (profile.endValue - profile.startValue) * unitMultiplier,
    children: [],
  };

  // Stack-based reconstruction of the call tree
  const stack: ProfileNode[] = [rootNode];
  const openTimes: number[] = [profile.startValue];

  for (const event of profile.events) {
    const frame = frames[event.frame];
    
    if (event.type === "O") {
      // Open event: push new node onto the stack
      const node: ProfileNode = {
        name: frame?.name || `frame_${event.frame}`,
        type: inferNodeType(frame?.name || "", frame),
        file: frame?.file,
        line: frame?.line,
        time: 0,
        totalTime: 0,
        children: [],
      };

      // Add as child of current top of stack
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      
      stack.push(node);
      openTimes.push(event.at);
    } else if (event.type === "C") {
      // Close event: pop from stack and calculate time
      if (stack.length > 1) {
        const node = stack.pop()!;
        const openTime = openTimes.pop()!;
        node.totalTime = (event.at - openTime) * unitMultiplier;
        
        // Self time = total time minus children's total time
        const childrenTime = node.children.reduce((sum, c) => sum + c.totalTime, 0);
        node.time = Math.max(0, node.totalTime - childrenTime);
      }
    }
  }

  // Count total nodes
  const nodeCount = countNodes(rootNode);
  
  // Recalculate root total time from children if needed
  if (rootNode.children.length > 0 && rootNode.totalTime === 0) {
    rootNode.totalTime = rootNode.children.reduce((sum, c) => sum + c.totalTime, 0);
  }
  rootNode.time = rootNode.totalTime - rootNode.children.reduce((sum, c) => sum + c.totalTime, 0);

  return {
    timestamp: new Date().toISOString(),
    totalTime: rootNode.totalTime,
    nodeCount,
    raw: data,
    tree: rootNode,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Infer the node type from its name
 */
function inferNodeType(name: string, frame?: any): string {
  if (frame?.type) return frame.type;
  
  const nameLower = name.toLowerCase();
  
  // Liquid-specific patterns
  if (nameLower === "liquid") return "root";
  if (nameLower.includes("layout/")) return "layout";
  if (nameLower.includes("template") || nameLower.includes("templates/")) return "template";
  if (nameLower.includes("section") || nameLower.includes("sections/")) return "section";
  if (nameLower.includes("snippet") || nameLower.includes("snippets/")) return "snippet";
  if (nameLower.includes("block") || nameLower.includes("blocks/")) return "block";
  
  // Liquid tag patterns from flame graph
  if (nameLower.startsWith("tag:")) return "tag";
  if (nameLower.startsWith("render") || nameLower.startsWith("tag:render")) return "render";
  if (nameLower.startsWith("tag:if") || nameLower.startsWith("tag:for")) return "tag";
  if (nameLower.startsWith("tag:sections")) return "sections";
  if (nameLower.startsWith("tag:section")) return "section";
  if (nameLower.includes("json_template")) return "template";
  if (nameLower.includes("liquid_template")) return "template";
  if (nameLower.includes("raw_section") || nameLower.includes("raw_on")) return "section";
  
  if (nameLower.startsWith("{%")) return "tag";
  if (nameLower.startsWith("{{")) return "output";
  
  return "other";
}

/**
 * Count nodes recursively
 */
function countNodes(node: ProfileNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Normalize a generic (non-speedscope) JSON profiling response
 */
function normalizeGenericProfilingData(rawData: any): ProfilingData {
  if (rawData.nodes || rawData.children) {
    return {
      timestamp: new Date().toISOString(),
      totalTime: rawData.totalTime || rawData.total_time || rawData.duration || rawData.time || 0,
      nodeCount: countNodes(rawData),
      raw: rawData,
      tree: parseProfilingTree(rawData),
    };
  }

  if (rawData.profiles || rawData.profile) {
    const profile = rawData.profiles?.[0] || rawData.profile;
    return {
      timestamp: new Date().toISOString(),
      totalTime: profile.totalTime || profile.total_time || profile.duration || profile.time || 0,
      nodeCount: countNodes(profile),
      raw: rawData,
      tree: parseProfilingTree(profile),
    };
  }

  return {
    timestamp: new Date().toISOString(),
    totalTime: rawData.totalTime || rawData.total_time || rawData.duration || rawData.time || 0,
    nodeCount: typeof rawData === "object" ? Object.keys(rawData).length : 0,
    raw: rawData,
    tree: parseProfilingTree(rawData),
  };
}

/**
 * Parse Server-Timing header into profiling data (fallback for basic data)
 */
function parseServerTimingHeader(header: string): ProfilingData | null {
  try {
    const entries = header.split(",").map((entry) => {
      const parts = entry.trim().split(";");
      const name = parts[0]?.trim();
      let duration = 0;
      let description = "";

      for (const part of parts.slice(1)) {
        const [key, val] = part.split("=");
        if (key?.trim() === "dur") duration = parseFloat(val || "0");
        if (key?.trim() === "desc") description = (val || "").replace(/"/g, "");
      }

      return { name, duration, description };
    });

    if (entries.length > 0) {
      const totalTime = entries.reduce((sum, e) => sum + e.duration, 0);
      return {
        timestamp: new Date().toISOString(),
        totalTime,
        nodeCount: entries.length,
        raw: { serverTiming: entries, type: "basic" },
        tree: {
          name: "root",
          children: entries.map((e) => ({
            name: e.description || e.name,
            time: e.duration,
          })),
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize store URL for consistent usage
 */
function normalizeStoreUrl(storeUrl: string): string {
  let normalized = storeUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  
  if (!normalized.includes(".myshopify.com") && !normalized.includes(".")) {
    normalized = `${normalized}.myshopify.com`;
  }
  
  return normalized;
}
