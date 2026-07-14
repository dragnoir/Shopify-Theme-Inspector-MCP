# Shopify Theme Inspector MCP

[![npm version](https://img.shields.io/npm/v/shopify-theme-inspector-mcp.svg)](https://www.npmjs.com/package/shopify-theme-inspector-mcp)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Ask your AI assistant why a Shopify theme is slow—and get a report that points to the Liquid files and lines worth fixing.

Shopify Theme Inspector MCP connects Shopify's server-side Liquid profiler to AI tools such as Codex, Claude Desktop, Cursor, Windsurf, and VS Code. It measures a live storefront, finds expensive templates and repeated work, compares pages, and turns flame-graph data into readable recommendations.

**You do not need to be a programmer to run a report.** If your AI app supports MCP, the setup is mostly copy, paste, sign in, and ask a question.

> [!NOTE]
> This is an unofficial community project. It is not affiliated with or supported by Shopify.

## What can it do?

- Profile any page on a Shopify store you are authorized to inspect.
- Explain slow Liquid sections, snippets, blocks, tags, and app embeds.
- Point to relevant theme files and line numbers when Shopify provides them.
- Compare two pages or rank up to ten pages from slowest to fastest.
- Detect repeated rendering, expensive lookups, heavy templates, and other common patterns.
- Save profile history so you can measure whether a theme change helped.
- Export reports as Markdown, CSV, or Speedscope JSON.
- Read and explain the results through your AI assistant.

Profiling is read-only: it requests performance data from Shopify and does not edit or publish your theme.

## Before you start

You need:

1. **Node.js 18 or newer.** Download the LTS version from [nodejs.org](https://nodejs.org/) if it is not installed.
2. **Google Chrome or Chromium** for Shopify sign-in.
3. An AI app that supports local MCP servers.
4. A Shopify account authorized to access the store you want to profile.

You do **not** need to download this repository when using the npm package.

## Easiest setup: Codex

Open a terminal and run:

```bash
codex mcp add shopify-theme-inspector -- npx -y shopify-theme-inspector-mcp@latest
```

Restart Codex. Then ask:

> Use the shopify-theme-inspector health_check tool and show me the result.

Codex stores local MCP configuration in `~/.codex/config.toml`. The Codex app, CLI, and IDE extension share that configuration. See the official [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) for the current interface and configuration options.

## Setup in other MCP apps

Find **MCP Servers**, **Tools**, or **Integrations** in your AI application's settings and add a local/STDIO server with:

- **Name:** `shopify-theme-inspector`
- **Command:** `npx`
- **Arguments:** `-y`, `shopify-theme-inspector-mcp@latest`

If your app asks for JSON, use:

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

Restart the AI app after saving the server.

## Your first homepage report

Copy these prompts one at a time into your AI assistant. Replace the example domain with your store.

### 1. Check the connection

> Use Shopify Theme Inspector health_check and explain the result.

### 2. Sign in to Shopify

> Use the login tool for https://example-store.com/

A Chrome/Chromium window opens. Sign in with the Shopify account that has access to the store.

If you specifically want to reuse an already-open signed-in Chrome profile, ask:

> Log in to https://example-store.com/ using my existing Chrome profile.

The AI can use `login_in_chrome` followed by `complete_login_in_chrome`. Depending on your AI app, it may ask you to copy the final callback URL from Chrome's address bar. Treat that URL as temporary private login data and only provide it to the local MCP tool that started the login.

### 3. Ask for a readable audit

> Create a deep performance report for the homepage. Explain the findings in plain English, rank fixes by impact, and include the relevant Liquid files and lines.

That is enough to start. The AI chooses the profiling tools and turns the results into a report.

## Useful prompts anyone can use

### Find the biggest homepage problem

> Profile the homepage of https://example-store.com/ and tell me the three most important things to fix first.

### Compare pages

> Compare `/` with `/collections/all` on https://example-store.com/ and explain why one is slower.

### Check several pages

> Profile `/`, `/collections/all`, `/products/example`, and `/cart` on https://example-store.com/. Rank them from slowest to fastest.

### Measure a theme optimization

> Show the profile history for `/` on https://example-store.com/ and tell me whether performance is improving.

### Create a shareable report

> Export a Markdown performance report for the homepage of https://example-store.com/.

## What the AI can inspect

| Tool | What it does |
|---|---|
| `health_check` | Confirms the MCP server is working and lists its capabilities. |
| `get_auth_status` | Shows whether the store login is valid. |
| `login` | Opens Shopify Identity sign-in in a dedicated browser session. |
| `login_in_chrome` | Starts sign-in in an existing Chrome profile. |
| `complete_login_in_chrome` | Safely completes the existing-Chrome sign-in flow. |
| `logout` | Removes saved local authentication for a store. |
| `profile_page` | Returns the full Shopify Liquid flame graph. |
| `get_profile_summary` | Returns readable totals, top nodes, and template breakdowns. |
| `get_bottlenecks` | Finds performance patterns and recommends fixes. |
| `find_slow_templates` | Lists sections and snippets above a chosen threshold. |
| `compare_pages` | Profiles two pages and shows the differences. |
| `batch_profile` | Profiles up to ten pages and ranks them. |
| `get_profile_history` | Shows changes in render time across saved runs. |
| `export_profile` | Exports Markdown, CSV, or Speedscope JSON. |
| `login_legacy` | Starts the optional legacy session required for Admin API theme-file access. |
| `analyze_liquid_file` | Statically checks a Liquid file; requires the legacy login. |

For most users, `login`, `get_profile_summary`, `get_bottlenecks`, and `find_slow_templates` are enough.

## How to read the results

- **Total Liquid render time** is Shopify's server-side theme-rendering time, not the complete browser page-load time.
- **Self time** is work done by one operation without its children.
- **Total time** includes work done by nested operations.
- **Percentage** shows how much of that profile is attributed to a node or template.
- **Render/event count** highlights repeated work inside loops and nested theme structures.

Do not add every template percentage together as guaranteed savings; parent and child timings can overlap. Run several profiles and prioritize items that stay near the top.

## What it detects

The recommendation engine can flag:

- `all_products[handle]` and repeated product/resource lookups.
- Expensive work around `content_for_header`.
- Deep or repeated Liquid loops.
- Heavy sections, snippets, blocks, and third-party app embeds.
- Product, menu, image, price, schema, and cart rendering patterns.
- Templates that consume a disproportionate share of Liquid time.

Recommendations are starting points, not automatic proof that a feature should be removed. Business value and storefront behavior still matter.

## Privacy and local data

Authentication and profile history stay on the computer running the MCP server:

| Data | Default location |
|---|---|
| OAuth tokens | `~/.shopify-theme-inspector/oauth-tokens.json` |
| Profile history | `~/.shopify-theme-inspector/history/` |

- Tokens are used to request Shopify profiling data.
- The package does not send profiling results to a separate analytics service.
- Your AI application may have its own data and privacy policy; review that policy separately.
- Never post OAuth callback URLs, access tokens, or the local token file in issues or public chats.

Run `logout` for a store when you want to remove its saved authentication.

## What this does not measure

This package focuses on **Shopify's server-side Liquid rendering**. It is not a replacement for Lighthouse, WebPageTest, or real-user Core Web Vitals.

It does not directly measure:

- Browser JavaScript execution.
- Image transfer size or CDN download time.
- Fonts and third-party browser scripts.
- CLS, INP, or real-user LCP.
- Mobile network and device performance.

For a complete performance project, use this MCP for Liquid work and a browser performance tool for front-end work.

## Troubleshooting

### The AI cannot find the tools

Restart the AI app after adding the MCP server. In Codex, run:

```bash
codex mcp list
```

Confirm that `shopify-theme-inspector` is enabled.

### `npx` is not recognized

Install the Node.js LTS release from [nodejs.org](https://nodejs.org/), then reopen your terminal and AI app.

### Shopify says the store is not authenticated

Ask the AI to run `get_auth_status`, then run `login` again for the same store domain.

### The wrong Chrome profile opens

Keep your preferred Chrome profile open and ask the AI to use `login_in_chrome`. If Chrome still selects another profile, copy the authorization URL into the correct profile, complete sign-in, and provide the final callback URL only to `complete_login_in_chrome`.

### The report changes between runs

Some variation is normal because of Shopify infrastructure and cache state. Run three to five profiles and compare the median plus the slowest result.

### The browser does not open

Install Google Chrome or Chromium. On a headless Linux machine, Puppeteer may also need a browser download:

```bash
npx puppeteer browsers install chrome
```

## Install and run from source

This section is for contributors and developers.

```bash
git clone https://github.com/dragnoir/Shopify-Theme-Inspector-MCP.git
cd Shopify-Theme-Inspector-MCP
npm install
npm run build
npm run test:run
```

Run the built MCP server:

```bash
node dist/index.js
```

Open the MCP Inspector:

```bash
npm run inspector
```

## How it works

1. Shopify Identity OAuth authenticates the authorized Shopify account.
2. The server exchanges that login for a Storefront Renderer DevTools token.
3. It requests the storefront with Shopify's Speedscope response type.
4. Shopify returns a server-side Liquid flame graph instead of ordinary HTML.
5. The MCP parses, compares, stores, and exports that data for the AI assistant.

## Contributing

Issues and pull requests are welcome. Please include:

- The problem or improvement in plain language.
- Steps to reproduce it.
- A sanitized example that does not contain tokens or private store data.
- Test results for code changes.

Repository: [github.com/dragnoir/Shopify-Theme-Inspector-MCP](https://github.com/dragnoir/Shopify-Theme-Inspector-MCP)

## License

[MIT](LICENSE)
