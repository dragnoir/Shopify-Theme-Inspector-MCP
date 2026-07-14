#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// NEW OAuth2 auth (same as Chrome extension) - for profiling
import {
  loginWithOAuth,
  beginOAuthInExistingChrome,
  completeOAuthInExistingChrome,
  getOAuthTokens,
  deleteOAuthTokens,
  getOAuthenticatedStores,
  getProfilingAccessToken,
  getTokenStatus,
  getProfilingTokenStatus,
} from "./auth/shopify-identity-oauth.js";

// Legacy cookie-based auth - still used for Admin API (theme assets)
import {
  getAuthenticatedStores as getLegacyStores,
  deleteSession,
  normalizeStoreUrl,
  getSession,
} from "./auth/session-manager.js";
import { loginToShopify } from "./auth/shopify-oauth.js";

import { fetchThemeAsset, listThemeAssets } from "./api/theme-assets.js";
import { analyzeLiquidCode } from "./profiler/static-analysis.js";
import { logger } from "./utils/logger.js";

// Profiler imports (now uses OAuth2 token-based approach)
import { profilePage } from "./profiler/page-profiler.js";
import { generateSummary } from "./profiler/flamegraph-parser.js";
import { generateRecommendations } from "./profiler/recommendations.js";
import { saveProfileSnapshot, getProfileHistory, getProfiledPages, clearProfileHistory } from "./profiler/profile-history.js";
import { exportSpeedscopeJson, exportCsv, exportMarkdown } from "./profiler/profile-export.js";
import { VERSION } from "./version.js";

// Create the MCP server instance
const server = new McpServer({
  name: "shopify-theme-inspector",
  version: VERSION,
}, {
  instructions:
    "Profile Shopify Liquid rendering without changing the store. Start with health_check, then get_auth_status. " +
    "If authentication is needed, use login; use login_in_chrome plus complete_login_in_chrome when the user asks to reuse an existing Chrome profile. " +
    "For a readable audit, combine get_profile_summary, get_bottlenecks, and find_slow_templates. Explain findings in plain language and prioritize measured impact.",
});

// ============================================================================
// TOOL: health_check
// Basic health check to verify MCP connection
// ============================================================================
server.tool(
  "health_check",
  "Check if the Shopify Theme Inspector MCP server is running correctly",
  {},
  async () => {
    const oauthStores = getOAuthenticatedStores();
    const legacyStores = getLegacyStores();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "healthy",
            server: "shopify-theme-inspector",
            version: VERSION,
            timestamp: new Date().toISOString(),
            authMethod: "OAuth2 (same as Chrome extension)",
            authenticatedStores: oauthStores.length,
            legacySessionStores: legacyStores.length,
            capabilities: [
              "health_check",
              "login (OAuth2 via Shopify Identity)",
              "login_in_chrome (start OAuth in the existing Chrome profile)",
              "complete_login_in_chrome (finish external Chrome OAuth)",
              "login_legacy (cookie-based, for Admin API)",
              "logout",
              "get_auth_status",
              "profile_page (full speedscope flame graph!)",
              "get_profile_summary",
              "find_slow_templates",
              "get_bottlenecks (auto-detect anti-patterns)",
              "compare_pages (diff two pages)",
              "batch_profile (profile multiple pages)",
              "get_profile_history (trend tracking)",
              "export_profile (speedscope/CSV/markdown)",
              "analyze_liquid_file",
            ],
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: login
// OAuth2 login via Shopify Identity (same as Chrome extension)
// ============================================================================
server.tool(
  "login",
  "Authenticate with Shopify via OAuth2 (same method as the Chrome Theme Inspector extension). Opens a browser for you to log in. This provides full flame graph profiling data.",
  {
    storeUrl: z.string().describe("The Shopify store URL (e.g., onebed.com.au or mystore.myshopify.com)"),
  },
  async ({ storeUrl }) => {
    try {
      logger.info(`Tool 'login' called for: ${storeUrl}`);
      const result = await loginWithOAuth(storeUrl);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              storeUrl: result.storeUrl,
              message: result.message,
              authMethod: "OAuth2 (Shopify Identity)",
              expiresAt: result.tokens?.expiresAt,
              note: result.success
                ? "You can now use profile_page, get_profile_summary, and find_slow_templates to get FULL flame graph data."
                : undefined,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              storeUrl,
              message: `Login error: ${errorMessage}`,
            }, null, 2),
          },
        ],
      };
    }
  }
);

// ============================================================================
// TOOLS: login_in_chrome / complete_login_in_chrome
// Two-step OAuth that reuses an already-running signed-in Chrome profile.
// ============================================================================
server.tool(
  "login_in_chrome",
  "Start Shopify OAuth in the user's existing Chrome profile without closing Chrome. After authorization, copy the full final callback URL and pass it to complete_login_in_chrome.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
  },
  async ({ storeUrl }) => {
    try {
      logger.info(`Tool 'login_in_chrome' called for: ${storeUrl}`);
      const result = await beginOAuthInExistingChrome(storeUrl);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: result.success,
            storeUrl: result.storeUrl,
            message: result.message,
            callbackUrlPrefix: result.callbackUrlPrefix,
            authorizationUrl: result.authorizationUrl,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            storeUrl,
            message: `Chrome OAuth start failed: ${error instanceof Error ? error.message : String(error)}`,
          }, null, 2),
        }],
      };
    }
  },
);

server.tool(
  "complete_login_in_chrome",
  "Complete a login_in_chrome flow using the full final chromiumapp.org callback URL copied from Chrome's address bar.",
  {
    storeUrl: z.string().describe("The same Shopify store URL used with login_in_chrome"),
    callbackUrl: z.string().describe("The full final URL from Chrome's address bar, including code and state"),
  },
  async ({ storeUrl, callbackUrl }) => {
    const result = await completeOAuthInExistingChrome(storeUrl, callbackUrl);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: result.success,
          storeUrl: result.storeUrl,
          message: result.message,
          authMethod: "OAuth2 through existing Chrome",
          expiresAt: result.tokens?.expiresAt,
        }, null, 2),
      }],
    };
  },
);

// ============================================================================
// TOOL: login_legacy
// Cookie-based login (needed for analyze_liquid_file Admin API access)
// ============================================================================
server.tool(
  "login_legacy",
  "Legacy cookie-based Shopify login. Opens browser for manual login. Required for 'analyze_liquid_file' tool which needs Admin API access. Use 'login' (OAuth2) for profiling tools.",
  {
    storeUrl: z.string().describe("The Shopify store URL (e.g., mystore.myshopify.com)"),
  },
  async ({ storeUrl }) => {
    try {
      const result = await loginToShopify(storeUrl);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              storeUrl: result.storeUrl,
              message: result.message,
              authMethod: "Cookie-based (legacy)",
              storeName: result.session?.storeName,
              expiresAt: result.session?.expiresAt,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              storeUrl: normalizeStoreUrl(storeUrl),
              message: `Login error: ${errorMessage}`,
            }, null, 2),
          },
        ],
      };
    }
  }
);

// ============================================================================
// TOOL: logout
// Remove saved authentication for a store
// ============================================================================
server.tool(
  "logout",
  "Remove saved authentication (both OAuth2 and legacy sessions) for a Shopify store",
  {
    storeUrl: z.string().describe("The Shopify store URL to logout from"),
  },
  async ({ storeUrl }) => {
    const oauthDeleted = deleteOAuthTokens(storeUrl);
    const legacyDeleted = deleteSession(storeUrl);
    const normalizedUrl = normalizeStoreUrl(storeUrl);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: oauthDeleted || legacyDeleted,
            storeUrl: normalizedUrl,
            oauthTokenDeleted: oauthDeleted,
            legacySessionDeleted: legacyDeleted,
            message: (oauthDeleted || legacyDeleted)
              ? `Successfully logged out from ${normalizedUrl}`
              : `No session found for ${normalizedUrl}`,
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: get_auth_status
// Check authentication status for stores
// ============================================================================
server.tool(
  "get_auth_status",
  "Check authentication status. Shows both OAuth2 (for profiling) and legacy (for Admin API) authentication.",
  {
    storeUrl: z.string().optional().describe("Optional: specific store URL to check. If omitted, lists all authenticated stores."),
  },
  async ({ storeUrl }) => {
    const oauthStores = getOAuthenticatedStores();
    const legacyStores = getLegacyStores();

    if (storeUrl) {
      const normalizedUrl = normalizeStoreUrl(storeUrl);
      const tokenStatus = getTokenStatus(normalizedUrl);
      const profilingStatus = getProfilingTokenStatus(normalizedUrl);
      const legacySession = getSession(normalizedUrl);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              storeUrl: normalizedUrl,
              oauth2: tokenStatus.hasTokens ? {
                authenticated: tokenStatus.subjectTokenValid,
                tokenValid: tokenStatus.subjectTokenValid,
                expiresAt: tokenStatus.expiresAt,
                timeRemaining: tokenStatus.timeRemainingHuman || (tokenStatus.canAutoRefresh ? "expired (auto-refresh available)" : "expired"),
                hasRefreshToken: tokenStatus.hasRefreshToken,
                canAutoRefresh: tokenStatus.canAutoRefresh,
                profilingStatus: profilingStatus.message,
                note: tokenStatus.subjectTokenValid 
                  ? "Can use profile_page, get_profile_summary, find_slow_templates, get_bottlenecks"
                  : tokenStatus.canAutoRefresh
                    ? "Token expired but will auto-refresh on next profiling request"
                    : "Token expired. Use 'login' to re-authenticate.",
              } : {
                authenticated: false,
                note: "Use 'login' tool to authenticate with OAuth2 for profiling",
              },
              legacy: legacySession ? {
                authenticated: true,
                storeName: legacySession.storeName,
                expiresAt: legacySession.expiresAt,
                note: "Can use analyze_liquid_file (Admin API)",
              } : {
                authenticated: false,
                note: "Use 'login_legacy' tool to authenticate for Admin API access",
              },
            }, null, 2),
          },
        ],
      };
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalOAuthStores: oauthStores.length,
            totalLegacyStores: legacyStores.length,
            oauthStores,
            legacyStores,
            message: oauthStores.length === 0
              ? "No stores authenticated via OAuth2. Use the 'login' tool to authenticate for profiling."
              : `${oauthStores.length} store(s) authenticated via OAuth2.`,
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: profile_page
// Profile a Shopify store page (now uses OAuth2 Bearer token!)
// ============================================================================
server.tool(
  "profile_page",
  "Profile a Shopify store page to analyze Liquid template rendering performance. Returns FULL flame graph profiling data (same as Chrome extension). Requires OAuth2 authentication first (use the 'login' tool).",
  {
    storeUrl: z.string().describe("The Shopify store URL (e.g., onebed.com.au or mystore.myshopify.com)"),
    pagePath: z.string().optional().describe("The page path to profile (e.g., /products/example). Defaults to homepage '/'"),
  },
  async ({ storeUrl, pagePath }) => {
    logger.info(`Tool 'profile_page' called`, { storeUrl, pagePath });

    const result = await profilePage({
      storeUrl,
      pagePath: pagePath || "/",
    });

    if (!result.success || !result.data) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              storeUrl: result.storeUrl,
              pagePath: result.pagePath,
              error: result.error,
            }, null, 2),
          },
        ],
      };
    }

    // Generate auto-recommendations
    const recommendations = generateRecommendations(result.data, result.summary);

    // Auto-save to history
    if (result.summary) {
      try { saveProfileSnapshot(result.storeUrl, result.pagePath, result.summary, recommendations); } catch (_) {}
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: result.storeUrl,
            pagePath: result.pagePath,
            profileUrl: result.profileUrl,
            totalTime: result.data.totalTime,
            nodeCount: result.data.nodeCount,
            performanceRating: recommendations.overallRating,
            timestamp: result.data.timestamp,
            warning: result.warning,
            summary: result.summary,
            recommendations: {
              count: recommendations.recommendations.length,
              critical: recommendations.summary.critical,
              warning: recommendations.summary.warning,
              info: recommendations.summary.info,
              estimatedSavingsMs: recommendations.summary.estimatedSavingsMs,
              items: recommendations.recommendations.slice(0, 5),
            },
            rawData: result.data.raw,
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: get_profile_summary
// Get a human-readable performance summary for a store page
// ============================================================================
server.tool(
  "get_profile_summary",
  "Profile a Shopify store page and return a structured performance summary with top slow nodes and template breakdown. More readable than raw profile_page data. Requires OAuth2 authentication first.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePath: z.string().optional().describe("The page path to profile"),
  },
  async ({ storeUrl, pagePath }) => {
    logger.info(`Tool 'get_profile_summary' called`, { storeUrl, pagePath });

    const result = await profilePage({
      storeUrl,
      pagePath: pagePath || "/",
    });

    if (!result.success || !result.data) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: result.error,
            }, null, 2),
          },
        ],
      };
    }

    // Generate auto-recommendations
    const recommendations = generateRecommendations(result.data, result.summary);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: result.storeUrl,
            pagePath: result.pagePath,
            performanceRating: recommendations.overallRating,
            warning: result.warning,
            summary: result.summary,
            recommendations: {
              count: recommendations.recommendations.length,
              critical: recommendations.summary.critical,
              warning: recommendations.summary.warning,
              info: recommendations.summary.info,
              estimatedSavingsMs: recommendations.summary.estimatedSavingsMs,
              items: recommendations.recommendations,
            },
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: find_slow_templates
// Identify templates that exceed a performance threshold
// ============================================================================
server.tool(
  "find_slow_templates",
  "Identify Liquid templates and sections that are taking longer than a specified threshold to render. Requires OAuth2 authentication.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePath: z.string().optional().describe("The page path to profile"),
    thresholdMs: z.number().optional().describe("Threshold in milliseconds. Defaults to 50ms."),
  },
  async ({ storeUrl, pagePath, thresholdMs = 50 }) => {
    logger.info(`Tool 'find_slow_templates' called`, { storeUrl, pagePath, thresholdMs });

    const result = await profilePage({ storeUrl, pagePath: pagePath || "/" });
    
    if (!result.success || !result.data || !result.summary) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: result.error || "No data" }, null, 2) }]
      };
    }

    const breakdown = result.summary.templateBreakdown || [];
    const slowTemplates = breakdown.filter(t => t.totalTime > thresholdMs);

    const isBasic = result.data.raw?.type === "basic";
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            totalRenderTime: result.summary.totalRenderTime,
            thresholdMs,
            slowTemplatesCount: slowTemplates.length,
            slowTemplates,
            warning: result.warning,
            note: isBasic 
              ? "Got basic profiling data only. Try 'logout' then 'login' again to refresh your OAuth2 token." 
              : undefined
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: get_bottlenecks
// Comprehensive bottleneck analysis with auto-detected anti-patterns
// ============================================================================
server.tool(
  "get_bottlenecks",
  "Profile a page and automatically detect performance anti-patterns. Returns prioritized recommendations with severity ratings (critical/warning/info), specific file/line locations, measured impact, and concrete fix suggestions. This is the BEST tool for identifying what to optimize.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePath: z.string().optional().describe("The page path to analyze (defaults to '/')"),
  },
  async ({ storeUrl, pagePath }) => {
    logger.info(`Tool 'get_bottlenecks' called`, { storeUrl, pagePath });

    const result = await profilePage({ storeUrl, pagePath: pagePath || "/" });

    if (!result.success || !result.data) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: result.error || "Failed to profile page. Make sure you are logged in (use 'login' tool).",
            }, null, 2),
          },
        ],
      };
    }

    const report = generateRecommendations(result.data, result.summary);

    // Auto-save to history
    if (result.summary) {
      try { saveProfileSnapshot(result.storeUrl, result.pagePath, result.summary, report); } catch (_) {}
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: result.storeUrl,
            pagePath: result.pagePath,
            totalRenderTimeMs: report.totalRenderTimeMs,
            overallRating: report.overallRating,
            summary: {
              critical: report.summary.critical,
              warning: report.summary.warning,
              info: report.summary.info,
              estimatedSavingsMs: report.summary.estimatedSavingsMs,
              message: report.recommendations.length === 0
                ? "No performance issues detected. The page renders efficiently."
                : `Found ${report.recommendations.length} recommendation(s): ` +
                  `${report.summary.critical} critical, ${report.summary.warning} warnings, ${report.summary.info} info.`,
            },
            recommendations: report.recommendations,
          }, null, 2),
        },
      ],
    };
  }
);

import { getThemes } from "./api/theme-assets.js";

// ============================================================================
// TOOL: analyze_liquid_file
// Statically analyze Liquid files for performance issues
// ============================================================================
server.tool(
  "analyze_liquid_file",
  "Statically analyze a specific Liquid file for performance anti-patterns. Requires legacy cookie authentication (use 'login_legacy' tool).",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    fileName: z.string().optional().describe("Specific file to analyze (e.g., 'layout/theme.liquid'). If omitted, analyzes layout/theme.liquid."),
    themeId: z.number().optional().describe("Theme ID to analyze. Defaults to the live (main) theme."),
  },
  async ({ storeUrl, fileName, themeId }) => {
    logger.info(`Tool 'analyze_liquid_file' called`, { storeUrl, fileName, themeId });
    const session = getSession(normalizeStoreUrl(storeUrl));
    if (!session) {
       return {
        content: [{ type: "text", text: JSON.stringify({ 
          success: false, 
          message: "Not authenticated with legacy session. Use the 'login_legacy' tool first (needed for Admin API access)." 
        }, null, 2) }]
       };
    }

    try {
      let targetThemeId = themeId;
      if (!targetThemeId) {
        const themes = await getThemes(session);
        const mainTheme = themes.find(t => t.role === "main");
        if (!mainTheme) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, message: "Could not find main theme." }, null, 2) }]
            };
        }
        targetThemeId = mainTheme.id;
      }

      const targetFile = fileName || "layout/theme.liquid";
      
      const asset = await fetchThemeAsset(session, targetThemeId, targetFile);
      if (!asset || !asset.value) {
           return {
            content: [{ type: "text", text: JSON.stringify({ success: false, message: `File '${targetFile}' not found in theme ${targetThemeId}.` }, null, 2) }]
           };
      }

      const analysis = analyzeLiquidCode(asset.value);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              storeUrl: session.storeUrl,
              themeId: targetThemeId,
              file: targetFile,
              score: analysis.score,
              issues: analysis.issues
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) }]
      };
    }
  }
);

// ============================================================================
// TOOL: compare_pages
// Profile two pages and compare their performance side-by-side
// ============================================================================
server.tool(
  "compare_pages",
  "Profile two pages on the same store and compare their performance side-by-side. Shows differences in render time, template breakdown, and recommendations. Great for A/B testing template changes or comparing product vs collection page performance.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePathA: z.string().describe("First page path (e.g., '/' or '/products/my-product')"),
    pagePathB: z.string().describe("Second page path to compare against"),
  },
  async ({ storeUrl, pagePathA, pagePathB }) => {
    logger.info(`Tool 'compare_pages' called`, { storeUrl, pagePathA, pagePathB });

    // Profile both pages in parallel
    const [resultA, resultB] = await Promise.all([
      profilePage({ storeUrl, pagePath: pagePathA }),
      profilePage({ storeUrl, pagePath: pagePathB }),
    ]);

    if (!resultA.success || !resultA.data || !resultA.summary) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          success: false,
          error: `Failed to profile page A (${pagePathA}): ${resultA.error || "No data"}`,
        }, null, 2) }],
      };
    }
    if (!resultB.success || !resultB.data || !resultB.summary) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          success: false,
          error: `Failed to profile page B (${pagePathB}): ${resultB.error || "No data"}`,
        }, null, 2) }],
      };
    }

    const recsA = generateRecommendations(resultA.data, resultA.summary);
    const recsB = generateRecommendations(resultB.data, resultB.summary);

    // Auto-save both to history
    try { saveProfileSnapshot(resultA.storeUrl, resultA.pagePath, resultA.summary, recsA); } catch (_) {}
    try { saveProfileSnapshot(resultB.storeUrl, resultB.pagePath, resultB.summary, recsB); } catch (_) {}

    const timeA = recsA.totalRenderTimeMs;
    const timeB = recsB.totalRenderTimeMs;
    const deltaMs = timeB - timeA;
    const deltaPercent = timeA > 0 ? (deltaMs / timeA) * 100 : 0;

    // Build template comparison
    const allTemplates = new Set<string>();
    for (const t of resultA.summary.templateBreakdown) allTemplates.add(t.file);
    for (const t of resultB.summary.templateBreakdown) allTemplates.add(t.file);

    const templateComparison = Array.from(allTemplates).map((file) => {
      const a = resultA.summary!.templateBreakdown.find((t) => t.file === file);
      const b = resultB.summary!.templateBreakdown.find((t) => t.file === file);
      return {
        file,
        pageA: a ? { totalTime: a.totalTime, renders: a.renders, percentage: a.percentage } : null,
        pageB: b ? { totalTime: b.totalTime, renders: b.renders, percentage: b.percentage } : null,
        deltaMs: (b?.totalTime || 0) - (a?.totalTime || 0),
      };
    }).sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs)).slice(0, 15);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: resultA.storeUrl,
            comparison: {
              pageA: {
                path: pagePathA,
                totalRenderTimeMs: timeA,
                rating: recsA.overallRating,
                nodeCount: resultA.data.nodeCount,
                issues: { critical: recsA.summary.critical, warning: recsA.summary.warning, info: recsA.summary.info },
              },
              pageB: {
                path: pagePathB,
                totalRenderTimeMs: timeB,
                rating: recsB.overallRating,
                nodeCount: resultB.data.nodeCount,
                issues: { critical: recsB.summary.critical, warning: recsB.summary.warning, info: recsB.summary.info },
              },
              delta: {
                renderTimeMs: Math.round(deltaMs * 100) / 100,
                renderTimePercent: Math.round(deltaPercent * 100) / 100,
                verdict: Math.abs(deltaPercent) < 5
                  ? "Both pages have similar render times."
                  : deltaMs > 0
                    ? `Page B is ${Math.abs(deltaPercent).toFixed(0)}% slower than Page A.`
                    : `Page B is ${Math.abs(deltaPercent).toFixed(0)}% faster than Page A.`,
              },
            },
            templateComparison,
            recommendationsOnlyInA: recsA.recommendations
              .filter((ra) => !recsB.recommendations.some((rb) => rb.id === ra.id))
              .map((r) => ({ id: r.id, title: r.title, severity: r.severity })),
            recommendationsOnlyInB: recsB.recommendations
              .filter((rb) => !recsA.recommendations.some((ra) => ra.id === rb.id))
              .map((r) => ({ id: r.id, title: r.title, severity: r.severity })),
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: batch_profile
// Profile multiple pages in one call
// ============================================================================
server.tool(
  "batch_profile",
  "Profile multiple pages on the same store in a single call. Returns a summary comparison of all pages sorted by render time. Useful for finding the slowest pages on a site. Maximum 10 pages per call.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePaths: z.array(z.string()).min(1).max(10).describe("Array of page paths to profile (e.g., ['/', '/collections/all', '/products/my-product'])"),
  },
  async ({ storeUrl, pagePaths }) => {
    logger.info(`Tool 'batch_profile' called`, { storeUrl, pageCount: pagePaths.length });

    // Profile all pages in parallel
    const results = await Promise.all(
      pagePaths.map((pagePath) => profilePage({ storeUrl, pagePath }))
    );

    const pageResults = results.map((result, idx) => {
      if (!result.success || !result.data || !result.summary) {
        return {
          pagePath: pagePaths[idx],
          success: false,
          error: result.error || "No data",
        };
      }

      const recs = generateRecommendations(result.data, result.summary);

      // Auto-save to history
      try { saveProfileSnapshot(result.storeUrl, result.pagePath, result.summary, recs); } catch (_) {}

      return {
        pagePath: pagePaths[idx],
        success: true,
        totalRenderTimeMs: recs.totalRenderTimeMs,
        rating: recs.overallRating,
        nodeCount: result.data.nodeCount,
        issues: {
          critical: recs.summary.critical,
          warning: recs.summary.warning,
          info: recs.summary.info,
        },
        estimatedSavingsMs: recs.summary.estimatedSavingsMs,
        topTemplates: result.summary.templateBreakdown.slice(0, 3).map((t) => ({
          file: t.file,
          totalTime: t.totalTime,
          percentage: t.percentage,
        })),
      };
    });

    // Sort by render time (slowest first among successful ones)
    const successful = pageResults.filter((p) => p.success && "totalRenderTimeMs" in p);
    const failed = pageResults.filter((p) => !p.success);
    successful.sort((a, b) => ((b as any).totalRenderTimeMs || 0) - ((a as any).totalRenderTimeMs || 0));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl,
            totalPages: pagePaths.length,
            successfulProfiles: successful.length,
            failedProfiles: failed.length,
            pages: [...successful, ...failed],
            summary: successful.length > 0 ? {
              slowestPage: (successful[0] as any).pagePath,
              fastestPage: (successful[successful.length - 1] as any).pagePath,
              averageRenderTimeMs: Math.round(
                successful.reduce((sum, p) => sum + ((p as any).totalRenderTimeMs || 0), 0) / successful.length * 100
              ) / 100,
            } : undefined,
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: get_profile_history
// View historical profiling data and performance trends
// ============================================================================
server.tool(
  "get_profile_history",
  "View profiling history and performance trends for a store. Shows how render times have changed over time. Every profiling call is automatically saved to history. Use this to track the impact of optimizations.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePath: z.string().optional().describe("Filter history to a specific page path. If omitted, lists all profiled pages."),
    limit: z.number().optional().describe("Maximum number of history entries to return (default: 10)"),
    clearHistory: z.boolean().optional().describe("Set to true to clear history for this store/page."),
  },
  async ({ storeUrl, pagePath, limit, clearHistory: shouldClear }) => {
    logger.info(`Tool 'get_profile_history' called`, { storeUrl, pagePath, limit });

    if (shouldClear) {
      const deleted = clearProfileHistory(storeUrl, pagePath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Cleared ${deleted} history entries${pagePath ? ` for ${pagePath}` : ""}.`,
            }, null, 2),
          },
        ],
      };
    }

    // If no pagePath, list all profiled pages
    if (!pagePath) {
      const pages = getProfiledPages(storeUrl);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              storeUrl,
              profiledPages: pages,
              message: pages.length === 0
                ? "No profiling history found. Profile a page first using 'profile_page', 'get_bottlenecks', or 'batch_profile'."
                : `Found ${pages.length} profiled page(s). Specify a pagePath to see trend details.`,
            }, null, 2),
          },
        ],
      };
    }

    // Get trend for specific page
    const history = getProfileHistory(storeUrl, pagePath, limit || 10);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: history.storeUrl,
            pagePath: history.pagePath,
            trend: history.trend,
            snapshots: history.snapshots.map((s) => ({
              timestamp: s.timestamp,
              totalRenderTimeMs: s.totalRenderTimeMs,
              rating: s.overallRating,
              recommendations: s.recommendations,
              topSlowTemplates: s.topSlowTemplates,
            })),
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: export_profile
// Export profiling results in various formats
// ============================================================================
server.tool(
  "export_profile",
  "Profile a page and export the results in a specified format. Supported formats: 'speedscope' (JSON for speedscope.app visualization), 'csv' (spreadsheet-friendly), 'markdown' (shareable report with tables, recommendations, and severity badges). Can save to a file or return inline.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePath: z.string().optional().describe("The page path to profile (defaults to '/')"),
    format: z.enum(["speedscope", "csv", "markdown"]).describe("Export format: 'speedscope', 'csv', or 'markdown'"),
    outputPath: z.string().optional().describe("Optional file path to save the export. If omitted, returns content inline."),
  },
  async ({ storeUrl, pagePath, format, outputPath }) => {
    logger.info(`Tool 'export_profile' called`, { storeUrl, pagePath, format, outputPath });

    const result = await profilePage({ storeUrl, pagePath: pagePath || "/" });

    if (!result.success || !result.data || !result.summary) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: result.error || "Failed to profile page. Make sure you are logged in (use 'login' tool).",
            }, null, 2),
          },
        ],
      };
    }

    const recommendations = generateRecommendations(result.data, result.summary);

    // Auto-save to history
    try { saveProfileSnapshot(result.storeUrl, result.pagePath, result.summary, recommendations); } catch (_) {}

    const exportOptions = {
      storeUrl: result.storeUrl,
      pagePath: result.pagePath,
      data: result.data,
      summary: result.summary,
      recommendations,
    };

    let exportResult;
    switch (format) {
      case "speedscope":
        exportResult = exportSpeedscopeJson(exportOptions, outputPath);
        break;
      case "csv":
        exportResult = exportCsv(exportOptions, outputPath);
        break;
      case "markdown":
        exportResult = exportMarkdown(exportOptions, outputPath);
        break;
    }

    // For speedscope format, don't return the full JSON inline (too large)
    const inlineContent = format === "speedscope" && !outputPath
      ? `Speedscope JSON is ${exportResult.content.length} bytes. Use the 'outputPath' parameter to save it to a file, then open it at ${exportResult.speedscopeUrl}`
      : format === "speedscope" && outputPath
        ? `Speedscope JSON saved to ${exportResult.filePath}. Open it at ${exportResult.speedscopeUrl} by dragging the file into the browser.`
        : outputPath
          ? `${format.toUpperCase()} report saved to ${exportResult.filePath}`
          : exportResult.content;

    return {
      content: [
        {
          type: "text",
          text: format === "speedscope"
            ? JSON.stringify({
                success: true,
                format: exportResult.format,
                filePath: exportResult.filePath || null,
                speedscopeUrl: exportResult.speedscopeUrl,
                sizeBytes: exportResult.content.length,
                message: inlineContent,
                totalRenderTimeMs: recommendations.totalRenderTimeMs,
                rating: recommendations.overallRating,
              }, null, 2)
            : outputPath
              ? JSON.stringify({
                  success: true,
                  format: exportResult.format,
                  filePath: exportResult.filePath,
                  message: inlineContent,
                  totalRenderTimeMs: recommendations.totalRenderTimeMs,
                  rating: recommendations.overallRating,
                }, null, 2)
              : exportResult.content,
        },
      ],
    };
  }
);

// ============================================================================
// Start the server
// ============================================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Shopify Theme Inspector MCP server v${VERSION} running on stdio`);
  console.error("Auth: OAuth2 via Shopify Identity (auto-refresh enabled)");
  console.error("Tools: profile_page, get_bottlenecks, compare_pages, batch_profile, export_profile, get_profile_history");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
