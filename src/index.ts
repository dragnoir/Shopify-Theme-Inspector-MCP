#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// NEW OAuth2 auth (same as Chrome extension) - for profiling
import {
  loginWithOAuth,
  getOAuthTokens,
  deleteOAuthTokens,
  getOAuthenticatedStores,
  getProfilingAccessToken,
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

// Create the MCP server instance
const server = new McpServer({
  name: "shopify-theme-inspector",
  version: "0.2.0",
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
            version: "0.2.0",
            timestamp: new Date().toISOString(),
            authMethod: "OAuth2 (same as Chrome extension)",
            authenticatedStores: oauthStores.length,
            legacySessionStores: legacyStores.length,
            capabilities: [
              "health_check",
              "login (OAuth2 via Shopify Identity)",
              "login_legacy (cookie-based, for Admin API)",
              "logout",
              "get_auth_status",
              "profile_page (full speedscope flame graph!)",
              "get_profile_summary",
              "find_slow_templates",
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
      const oauthTokens = getOAuthTokens(normalizedUrl) || getOAuthTokens(storeUrl);
      const legacySession = getSession(normalizedUrl);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              storeUrl: normalizedUrl,
              oauth2: oauthTokens ? {
                authenticated: true,
                expiresAt: oauthTokens.expiresAt,
                note: "Can use profile_page, get_profile_summary, find_slow_templates",
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
            timestamp: result.data.timestamp,
            warning: result.warning,
            summary: result.summary,
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: result.storeUrl,
            pagePath: result.pagePath,
            warning: result.warning,
            summary: result.summary,
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
// Start the server
// ============================================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Shopify Theme Inspector MCP server v0.2.0 running on stdio");
  console.error("Auth method: OAuth2 via Shopify Identity (same as Chrome extension)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
