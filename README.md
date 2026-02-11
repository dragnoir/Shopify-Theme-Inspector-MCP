# Shopify Theme Inspector MCP

An MCP (Model Context Protocol) server that enables AI agents to profile and debug Liquid templates on Shopify stores. Uses the **same OAuth2 authentication and profiling mechanism** as the official [Shopify Theme Inspector Chrome Extension](https://github.com/Shopify/shopify-theme-inspector) to retrieve **full flame graph data** with per-template, per-line timing.

## Features

- 🔥 **Full Flame Graph Data** — 3,000+ profiling nodes with file paths and line numbers (not just basic Server-Timing)
- 🔐 **OAuth2 Authentication** — Same OAuth2 PKCE flow as the Chrome extension (via Shopify Identity)
- 📊 **Performance Summaries** — Auto-generated breakdown of slow templates, bottleneck sections, and render counts
- 🔍 **Static Analysis** — Detect Liquid anti-patterns directly in theme code via the Admin API
- 🤖 **AI-Ready** — Designed for seamless integration with AI coding assistants (Claude, Gemini, etc.)

## Quick Start

### Installation

```bash
npm install
npm run build
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "shopify-theme-inspector": {
      "command": "node",
      "args": ["path/to/shopify-theme-inspector-mcp/dist/index.js"]
    }
  }
}
```

### First Use

1. **Authenticate:** Ask Claude to `login` with your store URL
2. **Profile:** Ask Claude to `profile_page` on any page
3. **Analyze:** Ask Claude to `find_slow_templates` or `get_profile_summary`

## Available Tools

| Tool                  | Auth   | Description                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------------ |
| `health_check`        | None   | Verify the MCP server is running and check auth status                         |
| `login`               | —      | OAuth2 login via Shopify Identity (opens browser). Required for profiling.     |
| `login_legacy`        | —      | Legacy cookie-based login (opens browser). Required for `analyze_liquid_file`. |
| `logout`              | —      | Remove all saved authentication for a store                                    |
| `get_auth_status`     | None   | Check authentication status for all stores                                     |
| `profile_page`        | OAuth2 | Profile a store page — returns full speedscope flame graph data                |
| `get_profile_summary` | OAuth2 | Profile with human-readable performance summary and template breakdown         |
| `find_slow_templates` | OAuth2 | Identify templates exceeding a duration threshold (default: 50ms)              |
| `analyze_liquid_file` | Legacy | Statically analyze Liquid files for performance anti-patterns                  |

## How It Works

### Authentication

The MCP uses **OAuth2 PKCE** via Shopify Identity (`accounts.shopify.com`), replicating the exact flow of the Chrome Theme Inspector extension:

1. Opens a Chromium browser window for Shopify login
2. Captures the OAuth authorization code via redirect interception
3. Exchanges the code for a client access token
4. Performs **RFC 8693 token exchange** to obtain a storefront-renderer devtools subject token
5. Stores the token locally (`~/.shopify-theme-inspector/oauth-tokens.json`)

### Profiling

With the subject token, profiling is a single HTTP request:

```http
GET /page-path HTTP/1.1
Host: storefront-url.com
Accept: application/vnd.speedscope+json
Authorization: Bearer <subject_access_token>
```

Shopify responds with full profiling data in [speedscope format](https://www.speedscope.app/file-format-schema.json) — the same data the Chrome extension visualizes as a flame graph.

### What You Get

The profiling data includes:

- **Per-template timing** — How long each section, snippet, and layout takes to render
- **Per-line timing** — Which specific Liquid tags are slow (e.g., `all_products[]` lookups)
- **Render counts** — How many times each template is rendered
- **Hierarchical call tree** — Full parent/child relationships for flame graph reconstruction

## Workflow Examples

### 1. Profile a Page

```
> profile_page(storeUrl="onebed.com.au", pagePath="/")

Returns: 3,232 nodes, 188ms total render time
- layout/theme: 25.7% (48.4ms, 676 renders)
- sections/more-from-onebed-carousel: 9.0% (16.9ms)
- snippets/header-mega-menu: 5.8% (11.0ms, 761 renders)
```

### 2. Find Slow Templates

```
> find_slow_templates(storeUrl="onebed.com.au", thresholdMs=5)

Returns: Templates exceeding 5ms with file paths and line numbers
```

### 3. Profile a Draft Theme

```
> profile_page(storeUrl="onebed.com.au", pagePath="/?preview_theme_id=123456789")
```

### 4. Static Analysis (Admin API)

For deep analysis of Liquid code patterns:

```
> login_legacy(storeUrl="mystore.myshopify.com")
> analyze_liquid_file(storeUrl="mystore.myshopify.com", fileName="layout/theme.liquid")
```

## Two Authentication Systems

| System              | Tool           | Purpose                                 | Token Storage                                  |
| ------------------- | -------------- | --------------------------------------- | ---------------------------------------------- |
| **OAuth2** (new)    | `login`        | Profiling tools (`profile_page`, etc.)  | `~/.shopify-theme-inspector/oauth-tokens.json` |
| **Cookie** (legacy) | `login_legacy` | Admin API tools (`analyze_liquid_file`) | `~/.shopify-theme-inspector/sessions.json`     |

- Use `login` for profiling (recommended first step)
- Use `login_legacy` only if you need `analyze_liquid_file` for static code analysis

## Development

```bash
# Build
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Watch mode
npm run dev
```

## Development Status

- [x] Phase 1: Project Setup & Basic MCP Server
- [x] Phase 2: Shopify Authentication Module (Cookie-based)
- [x] Phase 3: Basic Profiling (MVP)
- [x] Phase 4: OAuth2 Fix — Full Flame Graph Data (v0.2.0)
- [x] Phase 5: Flame Graph Processing & Summaries
- [x] Phase 6: Performance Analysis Tools
- [x] Phase 7: Documentation
- [ ] Phase 8: Advanced Features (recommendations engine, token refresh, batch profiling)

## Technical Details

See [`ROOT-CAUSE-ANALYSIS.md`](./ROOT-CAUSE-ANALYSIS.md) for the full technical investigation and implementation details.

## License

MIT
