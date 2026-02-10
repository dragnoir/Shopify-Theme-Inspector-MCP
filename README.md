# Shopify Theme Inspector MCP

An MCP (Model Context Protocol) server that enables AI agents to profile and debug Liquid templates on Shopify stores.

## Features

- 🔍 **Profile Liquid Templates** - Analyze rendering performance of any Shopify store page
- 📊 **Flame Graph Data** - Get detailed timing data for each Liquid node
- 🚀 **Performance Insights** - Identify slow templates, bottlenecks, and optimization opportunities
- 🔐 **Browser-based Auth** - Opens browser for Shopify login, saves session securely
- 🤖 **AI-Ready** - Designed for seamless integration with AI coding assistants

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Desktop

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

### Available Tools

| Tool                  | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| `health_check`        | Verify the MCP server is running                                                    |
| `login`               | Open browser to authenticate with Shopify                                           |
| `logout`              | Remove saved authentication for a store                                             |
| `get_auth_status`     | Check authentication status                                                         |
| `profile_page`        | Profile a store page (raw profiling data)                                           |
| `get_profile_summary` | Profile with human-readable performance summary (supports basic & detailed)         |
| `find_slow_templates` | Identify templates exceeding a duration threshold (e.g. 50ms)                       |
| `analyze_liquid_file` | Statically analyze Liquid files for performance anti-patterns (e.g. `all_products`) |

## Profiling Modes

The inspector supports two modes depending on what the store returns:

1.  **Detailed Liquid Profiling**: Returns a flame graph of every Liquid node (render, snippet, section). This requires the store to support `?profile_liquid=true`.
2.  **Basic Profiling**: Returns high-level server timing (processing, db, compression) when detailed data is unavailable (common on Enterprise/Plus or heavily cached stores).

> **Note:** The tools automatically detect the mode and adjust their output.

## Workflow

### 1. Profile a Page

```bash
profile_page(storeUrl="onebed.com.au", pagePath="/")
```

### 2. Profile a Draft Theme

To profile a draft theme, use the **Preview Theme ID** found in the Shopify Admin URL:

```bash
profile_page(storeUrl="onebed.com.au", pagePath="/?preview_theme_id=123456789")
```

_The tool automatically switches to the canonical `myshopify.com` domain to ensure profiling works._

### 3. Static Analysis (When Runtime Profiling is Limited)

If runtime profiling only returns "Basic" data, use static analysis to find code issues:

```bash
analyze_liquid_file(fileName="layout/theme.liquid")
```

## Development Status

- [x] Phase 1: Project Setup & Basic MCP Server
- [x] Phase 2: Shopify Authentication Module
- [x] Phase 3: Basic Profiling (MVP)
- [x] Phase 4: Flame Graph Processing & Summaries
- [x] Phase 5: Performance Analysis Tools (Static & Runtime)
- [x] Phase 6: Automatic Domain Discovery (Fix for Custom Domains)
- [ ] Phase 7: Advanced Features

## License

MIT
