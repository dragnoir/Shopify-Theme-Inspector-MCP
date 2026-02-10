#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Auth imports
import { loginToShopify, checkAuthStatus, getStoreCookies } from "./auth/shopify-oauth.js";
import { getAuthenticatedStores, deleteSession, normalizeStoreUrl } from "./auth/session-manager.js";

// Profiler imports
import { profilePage } from "./profiler/page-profiler.js";
import { generateSummary } from "./profiler/flamegraph-parser.js";

// Create the MCP server instance
const server = new McpServer({
  name: "shopify-theme-inspector",
  version: "0.1.0",
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
    const stores = getAuthenticatedStores();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "healthy",
            server: "shopify-theme-inspector",
            version: "0.1.0",
            timestamp: new Date().toISOString(),
            authenticatedStores: stores.length,
            capabilities: [
              "health_check",
              "login",
              "logout", 
              "get_auth_status",
              "profile_page",
              "get_profile_summary",
              "find_slow_templates (coming soon)",
              "get_bottlenecks (coming soon)",
            ],
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: login
// Opens browser for Shopify authentication
// ============================================================================
server.tool(
  "login",
  "Open browser for Shopify authentication. The browser will open automatically, and you need to log in manually. Once logged in, the session will be saved for future profiling requests.",
  {
    storeUrl: z.string().describe("The Shopify store URL (e.g., mystore.myshopify.com or just 'mystore')"),
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
// Remove saved session for a store
// ============================================================================
server.tool(
  "logout",
  "Remove saved authentication session for a Shopify store",
  {
    storeUrl: z.string().describe("The Shopify store URL to logout from"),
  },
  async ({ storeUrl }) => {
    const deleted = deleteSession(storeUrl);
    const normalizedUrl = normalizeStoreUrl(storeUrl);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: deleted,
            storeUrl: normalizedUrl,
            message: deleted 
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
  "Check authentication status for a Shopify store or list all authenticated stores",
  {
    storeUrl: z.string().optional().describe("Optional: specific store URL to check. If omitted, lists all authenticated stores."),
  },
  async ({ storeUrl }) => {
    if (storeUrl) {
      // Check specific store
      const status = checkAuthStatus(storeUrl);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }
    
    // List all authenticated stores
    const stores = getAuthenticatedStores();
    const storeStatuses = stores.map((store) => checkAuthStatus(store));
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalStores: stores.length,
            stores: storeStatuses,
            message: stores.length === 0 
              ? "No stores authenticated. Use the login tool to authenticate with a Shopify store."
              : `${stores.length} store(s) authenticated.`,
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// TOOL: profile_page
// Profile a Shopify store page and return Liquid rendering data
// ============================================================================
server.tool(
  "profile_page",
  "Profile a Shopify store page to analyze Liquid template rendering performance. Returns raw profiling data including timing for each Liquid node. Requires authentication first (use the login tool).",
  {
    storeUrl: z.string().describe("The Shopify store URL (e.g., mystore.myshopify.com)"),
    pagePath: z.string().optional().describe("The page path to profile (e.g., /products/example). Defaults to homepage '/'"),
  },
  async ({ storeUrl, pagePath }) => {
    // Check authentication first
    const authStatus = checkAuthStatus(storeUrl);
    
    if (!authStatus.authenticated) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              message: `Not authenticated. ${authStatus.message}`,
              storeUrl: authStatus.storeUrl,
              action: "Please use the 'login' tool first to authenticate with this store.",
            }, null, 2),
          },
        ],
      };
    }

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
            rawData: result.data.raw,
            summary: result.summary,
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
  "Profile a Shopify store page and return a structured performance summary with top slow nodes and template breakdown. More readable than raw profile_page data. Requires authentication first.",
  {
    storeUrl: z.string().describe("The Shopify store URL (e.g., mystore.myshopify.com)"),
    pagePath: z.string().optional().describe("The page path to profile (e.g., /products/example). Defaults to homepage '/'"),
  },
  async ({ storeUrl, pagePath }) => {
    const authStatus = checkAuthStatus(storeUrl);
    
    if (!authStatus.authenticated) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              message: `Not authenticated. ${authStatus.message}`,
              action: "Please use the 'login' tool first.",
            }, null, 2),
          },
        ],
      };
    }

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

    const summary = result.summary;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            storeUrl: result.storeUrl,
            pagePath: result.pagePath,
            summary,
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
  "Identify Liquid templates and sections that are taking longer than a specified threshold to render.",
  {
    storeUrl: z.string().describe("The Shopify store URL"),
    pagePath: z.string().optional().describe("The page path to profile"),
    thresholdMs: z.number().optional().describe("Threshold in milliseconds. Defaults to 50ms."),
  },
  async ({ storeUrl, pagePath, thresholdMs = 50 }) => {
    const authStatus = checkAuthStatus(storeUrl);
    if (!authStatus.authenticated) {
       return {
        content: [{ type: "text", text: JSON.stringify({ success: false, message: "Not authenticated" }, null, 2) }]
       };
    }

    const result = await profilePage({ storeUrl, pagePath: pagePath || "/" });
    
    if (!result.success || !result.data || !result.summary) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: result.error || "No data" }, null, 2) }]
      };
    }

    const breakdown = result.summary.templateBreakdown || [];
    const slowTemplates = breakdown.filter(t => t.totalTime > thresholdMs);

    // If no templates found, check if it was a basic profile
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
            note: isBasic 
              ? "No detailed Liquid template data available (Basic Profiling Mode). This usually happens on live themes with caching or custom domains. Try profiling a draft theme on the myshopify.com domain for detailed Liquid stats." 
              : undefined
          }, null, 2),
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
  console.error("Shopify Theme Inspector MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
