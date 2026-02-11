# Shopify Theme Inspector MCP

An MCP (Model Context Protocol) server that gives AI agents deep performance profiling and optimization capabilities for Shopify Liquid themes. Uses the same OAuth2 authentication as the official [Shopify Theme Inspector Chrome extension](https://chrome.google.com/webstore/detail/shopify-theme-inspector/fndnankcflemoafdeboboehphmiijkgp).

## Quick Setup

Add this to your AI agent's MCP configuration:

```json
{
  "mcpServers": {
    "shopify-theme-inspector": {
      "command": "npx",
      "args": ["-y", "shopify-theme-inspector-mcp@latest"]
    }
  }
}
```

### Where to add this config

| AI Agent              | Config File Location                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Claude Desktop**    | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Cursor**            | Settings → MCP Servers → Add Server                                                                                                  |
| **Windsurf**          | `~/.codeium/windsurf/mcp_config.json`                                                                                                |
| **VS Code + Copilot** | `.vscode/mcp.json` in your workspace                                                                                                 |

### Alternative: Run from source

```bash
git clone https://github.com/dragnoir/Shopify-Theme-Inspector-MCP.git
cd Shopify-Theme-Inspector-MCP
npm install
npm run build
```

Then configure your AI agent to use:

```json
{
  "mcpServers": {
    "shopify-theme-inspector": {
      "command": "node",
      "args": ["/absolute/path/to/Shopify-Theme-Inspector-MCP/dist/index.js"]
    }
  }
}
```

## Authentication

Before profiling, you must authenticate with Shopify. Just ask your AI agent:

> "Log in to my Shopify store at mystore.myshopify.com"

This triggers the `login` tool which opens a browser window for Shopify Identity OAuth2 login. After you sign in, the token is stored locally at `~/.shopify-theme-inspector/oauth-tokens.json` and **auto-refreshes** when it expires — you typically only need to log in once.

## Available Tools

### 🔐 Authentication

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `login`           | Authenticate via Shopify Identity OAuth2 (opens browser)          |
| `login_legacy`    | Cookie-based auth for Admin API access (theme file analysis)      |
| `logout`          | Remove stored authentication for a store                          |
| `get_auth_status` | Check token validity, time remaining, and auto-refresh capability |
| `health_check`    | Verify server is running and show all capabilities                |

### 📊 Profiling

| Tool                  | Description                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `profile_page`        | Profile a page and get full speedscope flame graph data with auto-recommendations                              |
| `get_profile_summary` | Get a concise summary of render time, template breakdown, and recommendations                                  |
| `find_slow_templates` | Find templates exceeding a render time threshold                                                               |
| `get_bottlenecks`     | **Best tool for optimization** — auto-detects anti-patterns with severity ratings and concrete fix suggestions |

### 🔄 Comparison & Batch

| Tool            | Description                                                                             |
| --------------- | --------------------------------------------------------------------------------------- |
| `compare_pages` | Profile two pages side-by-side — shows delta, template diff, and unique recommendations |
| `batch_profile` | Profile up to 10 pages in parallel — sorted by slowest, with per-page issues            |

### 📈 History & Trends

| Tool                  | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `get_profile_history` | View how render times change over time — trend direction, averages, min/max |

### 📤 Export

| Tool             | Description                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export_profile` | Export profiling data as **speedscope JSON** (for [speedscope.app](https://www.speedscope.app)), **CSV** (for spreadsheets), or **Markdown** (shareable report) |

### 🔍 Static Analysis

| Tool                  | Description                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `analyze_liquid_file` | Statically analyze a specific Liquid file for performance anti-patterns (requires legacy auth) |

## Usage Examples

### Profile a page and get optimization suggestions

> "Profile the homepage of mystore.myshopify.com and tell me what's slow"

The AI will call `get_bottlenecks` and return something like:

```
Overall Rating: 🟡 Moderate (287ms)
Found 4 recommendations: 1 critical, 2 warnings, 1 info

🔴 CRITICAL: content_for_header string manipulation
   File: layout/theme.liquid:15
   Impact: 12.3ms (4.3%)
   Fix: Remove character-level iteration. Use JavaScript-based
   script loading instead of Liquid string manipulation.

🟡 WARNING: Third-party app: seoant-speedup
   Impact: 8.1ms (2.8%)
   Fix: Evaluate if this app is essential. Consider disabling
   the app embed or contacting the developer.
```

### Compare two pages

> "Compare the homepage vs the /collections/all page on mystore.myshopify.com"

### Batch profile your key pages

> "Profile these pages on mystore.myshopify.com: /, /collections/all, /products/my-product, /cart"

### Track optimization impact

> "Show me the profiling history for the homepage of mystore.myshopify.com"

Returns trend data:

```
Trend: improving ↓
Latest: 245ms (was 312ms)
Delta: -67ms (-21.5%)
Average: 278ms over 5 data points
```

### Export a Markdown report

> "Export a markdown performance report for mystore.myshopify.com to ./report.md"

Generates a formatted report with tables, severity badges, and fix suggestions.

## Auto-Detected Anti-Patterns

The recommendations engine detects these known Shopify Liquid performance issues:

| Anti-Pattern                             | Category              | Why It's Slow                               |
| ---------------------------------------- | --------------------- | ------------------------------------------- |
| `all_products[handle]`                   | Expensive Lookup      | Full product lookup by handle on every call |
| `content_for_header` string manipulation | String Manipulation   | 50KB+ string, O(n) per operation            |
| `for` loop over `content_for_header`     | String Manipulation   | Character-by-character iteration            |
| Cart drawer on every page                | Unnecessary Rendering | Renders even when cart is empty             |
| `\| money` filter in loops               | Expensive Filter      | Cumulative cost in product loops            |
| `\| image_url` heavy usage               | Expensive Filter      | Multiple CDN URL transformations            |
| Large `{% schema %}` blocks              | Large Schema          | Parsed on every page load                   |
| Excessive template renders (100+)        | Excessive Rendering   | Nested loops or deep block iteration        |
| Heavy third-party app blocks             | Third-Party Apps      | Server-side Liquid on every page            |
| Templates taking >15% of total time      | Heavy Templates       | Disproportionate single-template cost       |

## How It Works

This MCP server replicates the exact authentication and data retrieval mechanism used by the [Shopify Theme Inspector Chrome extension](https://chrome.google.com/webstore/detail/shopify-theme-inspector/fndnankcflemoafdeboboehphmiijkgp):

1. **OAuth2 PKCE** flow with `accounts.shopify.com` using the Chrome extension's client ID
2. **Token exchange** for a `storefront-renderer-devtools` subject token
3. **Speedscope request**: fetches `Accept: application/vnd.speedscope+json` with `Authorization: Bearer <token>`
4. Shopify returns detailed **flame graph profiling data** instead of the HTML page

The key insight is that Shopify's profiling is server-side — the token tells Shopify to measure and return Liquid render performance data in speedscope format.

## Data Storage

All data is stored locally on your machine:

| Data            | Location                                       | Purpose                                 |
| --------------- | ---------------------------------------------- | --------------------------------------- |
| OAuth tokens    | `~/.shopify-theme-inspector/oauth-tokens.json` | Authentication (auto-refreshed)         |
| Profile history | `~/.shopify-theme-inspector/history/`          | Trend tracking (auto-pruned to 50/page) |

No data is sent to any third-party service.

## Requirements

- **Node.js** ≥ 18.0.0
- **Chromium/Chrome** (for the initial OAuth2 login via Puppeteer)
- A **Shopify store** you have access to (as staff or collaborator)

## Troubleshooting

### "Not authenticated" error

Run the `login` tool first. It opens a browser window — sign in with your Shopify account.

### Token expired

The server auto-refreshes tokens using the OAuth2 refresh token. If refresh fails (rare), just run `login` again.

### Puppeteer browser doesn't open

Make sure Chrome/Chromium is installed. On headless servers, you may need to install additional dependencies:

```bash
npx puppeteer browsers install chrome
```

### Empty or basic profiling data

Make sure you're logged into a store where you have staff access. Draft/development themes may have limited profiling data.

### Port conflicts with MCP Inspector

If running the inspector for debugging:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
