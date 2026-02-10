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

| Tool                  | Description                                     |
| --------------------- | ----------------------------------------------- |
| `health_check`        | Verify the MCP server is running                |
| `login`               | Open browser to authenticate with Shopify       |
| `logout`              | Remove saved authentication for a store         |
| `get_auth_status`     | Check authentication status                     |
| `profile_page`        | Profile a store page (raw profiling data)       |
| `get_profile_summary` | Profile with human-readable performance summary |

## Development Status

- [x] Phase 1: Project Setup & Basic MCP Server
- [x] Phase 2: Shopify Authentication Module
- [x] Phase 3: Basic Profiling (MVP)
- [ ] Phase 4: Flame Graph Processing
- [ ] Phase 5: Performance Analysis Tools
- [ ] Phase 6: Advanced Features
- [ ] Phase 7: Documentation

## License

MIT
