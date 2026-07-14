# Shopify Theme Inspector MCP

[![npm version](https://img.shields.io/npm/v/shopify-theme-inspector-mcp.svg)](https://www.npmjs.com/package/shopify-theme-inspector-mcp)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Ask your AI assistant why a Shopify theme is slow—and get a report that points to the Liquid files and lines worth fixing.

Shopify Theme Inspector MCP connects Shopify's server-side Liquid profiler to AI tools such as Codex, Claude Desktop, Cursor, Windsurf, and VS Code. It measures a live storefront, finds expensive templates and repeated work, compares pages, and turns flame-graph data into readable recommendations.

**You do not need to be a programmer to run a report.** If your AI app supports MCP, the setup is mostly copy, paste, sign in, and ask a question.

> [!NOTE]
> This is an unofficial community project. It is not affiliated with or supported by Shopify.

## Shopify store owner? Start here

This tool helps answer a practical question:

> **Which parts of my Shopify theme are making Shopify work harder before it can send the page to a customer?**

You can ask that question in normal language. Your AI assistant runs the technical checks, reads Shopify's profiling data, and explains the findings without expecting you to understand a flame graph.

For example, a report can tell you that:

- A homepage section is doing a large amount of server-side work.
- The same product, menu, price, or image code is being rendered many times.
- A third-party app block appears frequently in the slowest part of the profile.
- A collection or product template deserves attention before less important code.
- A recent theme change improved, worsened, or did not meaningfully change Liquid render time.

The result is a **prioritized investigation plan** that you can understand yourself or give to a Shopify developer. It helps replace “the store feels slow” with evidence about which Liquid files, sections, snippets, and operations deserve attention.

> [!IMPORTANT]
> The MCP diagnoses and explains potential theme bottlenecks. It does **not** automatically edit or publish your live theme. A theme developer should review, test, and deploy code changes safely—ideally on a duplicate theme first.

## What does “MCP” mean?

MCP stands for **Model Context Protocol**. In simple terms, it is a way to give an AI assistant access to a specialized set of tools.

Without this MCP, an AI assistant cannot normally request your store's Shopify Liquid performance profile directly. With it, the assistant can run authorized, read-only profiling checks and discuss the results with you.

Think of it as a local bridge:

```text
You ask a question
        ↓
Your AI assistant chooses the right inspection tool
        ↓
Shopify returns Liquid profiling data for the requested page
        ↓
The AI explains the evidence and suggests what to investigate
```

## How it can help your Shopify business

| Situation | How the MCP helps |
|---|---|
| The homepage feels slow | Finds the Liquid sections, snippets, and operations using the most server-rendering time. |
| Collection pages became slower as the catalogue grew | Compares pages and looks for repeated product, menu, filter, or loop work. |
| You installed or removed an app | Shows whether app-related theme blocks appear in expensive parts of the profile. |
| An agency or developer optimized the theme | Saves profile history so you can compare results before and after the work. |
| You do not know where to begin | Ranks likely bottlenecks so the team can investigate the highest-impact areas first. |
| You need to brief a developer | Produces a readable Markdown or CSV report with technical evidence and relevant file information when available. |
| Different page types behave differently | Compares the homepage, collections, products, cart, and other public storefront URLs. |

Finding and correcting Liquid bottlenecks can reduce Shopify's server-side theme-rendering work. However, this tool does not promise a particular Lighthouse score, Core Web Vitals result, search ranking, or sales increase. Those outcomes also depend on images, JavaScript, apps, network conditions, customer devices, theme design, and many other factors.

## What happens during an inspection?

1. **You choose a page**, such as the homepage, a collection, or a product.
2. **You sign in to Shopify** with an account authorized to access that store.
3. **The MCP requests a read-only Liquid profile** for the page.
4. **Shopify returns timing data** showing how the theme was rendered on the server.
5. **Your AI assistant explains the profile** and organizes the findings by likely importance.
6. **You or your developer decide what to change.** The MCP does not change the theme.
7. **You run the profile again** after a safe theme update to see whether the result improved.

For more reliable comparisons, profile the same page several times. Shopify infrastructure and cache state can cause normal variation between runs.

## What can it inspect?

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

## npm package details

The MCP is published as a public package on npm, so supported AI applications can download and start it for you.

| Detail | Value |
|---|---|
| Package | [`shopify-theme-inspector-mcp`](https://www.npmjs.com/package/shopify-theme-inspector-mcp) |
| Current release | [`0.5.1`](https://www.npmjs.com/package/shopify-theme-inspector-mcp) |
| Runtime | Node.js 18 or newer |
| License | MIT |
| Source code | [GitHub repository](https://github.com/dragnoir/Shopify-Theme-Inspector-MCP) |
| MCP Registry identity | `io.github.dragnoir/shopify-theme-inspector` |
| MCP connection type | Local STDIO process |

The examples below use `npx -y shopify-theme-inspector-mcp@latest`. `npx` downloads the public package when needed and starts the MCP locally. You do not need a global installation, a cloned repository, or an npm account.

To check the newest published version:

```bash
npm view shopify-theme-inspector-mcp version
```

Using `@latest` automatically selects the current npm release. Teams that require repeatable environments can replace it with a fixed version, such as `shopify-theme-inspector-mcp@0.5.1`.

## Connect to Codex

Open a terminal and run:

```bash
codex mcp add shopify-theme-inspector -- npx -y shopify-theme-inspector-mcp@latest
```

Restart Codex. You can confirm the server is registered with:

```bash
codex mcp list
```

Then ask:

> Use the shopify-theme-inspector health_check tool and show me the result.

Codex stores local MCP configuration in `~/.codex/config.toml`. The Codex app, CLI, and IDE extension share that configuration on the same Codex host. You can also add the server through **Settings → MCP servers** in supported Codex interfaces. See the official [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) for current configuration options.

## Connect to Claude Code

Open a terminal and run:

```bash
claude mcp add --transport stdio --scope user shopify-theme-inspector -- npx -y shopify-theme-inspector-mcp@latest
```

The `--scope user` option makes the MCP available across your Claude Code projects. Confirm the connection with:

```bash
claude mcp list
```

Inside Claude Code, you can also run `/mcp` to view the server and its tools. Then ask:

> Use the shopify-theme-inspector health_check tool and explain the result.

See the official [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for scopes, server management, and troubleshooting.

## Connect to Claude Desktop

Claude Desktop can run this package as a local MCP server on macOS or Windows:

1. Install Node.js 18 or newer.
2. Open **Claude Desktop → Settings → Developer → Edit Config**.
3. Add the configuration below inside the `mcpServers` object.
4. Save the file, fully quit Claude Desktop, and reopen it.

```json
{
  "mcpServers": {
    "shopify-theme-inspector": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "shopify-theme-inspector-mcp@latest"]
    }
  }
}
```

If you already have other MCP servers, keep them and add only the `shopify-theme-inspector` entry. Do not create a second `mcpServers` object.

After restarting, open the **Connectors** menu from the `+` button in the chat box to confirm the tools are available. Then ask Claude:

> Use Shopify Theme Inspector health_check and explain whether everything is ready.

The configuration file is normally located at:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

See the official MCP guide for [connecting local servers to Claude Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

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

### Create a report for your developer or agency

> Profile the homepage of https://example-store.com/. Create a handoff report for my Shopify developer with an owner-friendly summary, evidence for every finding, relevant Liquid files and lines, recommended fixes, risks to check before changing anything, and a before-and-after testing plan. Do not edit the theme.

See the [sanitized example homepage report](examples/example-homepage-performance-report.md) to understand the expected output before profiling your own store. It uses fictional store data and contains no merchant information or authentication data.

### Separate business decisions from code changes

> Review the homepage profile and separate the recommendations into: things I can decide as the store owner, things a Shopify developer should investigate, and things that need more evidence before anyone changes the theme.

## Do I need a Shopify developer?

You do not need to understand programming to follow the setup, request a profile, or read an owner-friendly report. The AI assistant can explain technical terms and help you prepare a clear brief. If you are uncomfortable installing Node.js or using a terminal, ask a developer or technical team member to complete the one-time setup for you.

You will usually want a Shopify theme developer to implement the recommendations. Liquid performance work can affect product cards, menus, pricing, localization, analytics, app features, and other storefront behavior. A developer can confirm the cause, make changes on a duplicate theme, test the storefront, and publish only after the change is safe.

A useful report should contain:

- **An owner summary:** what was inspected and why the result matters.
- **Prioritized findings:** what deserves attention now, later, or only if more evidence appears.
- **Evidence:** timings, repetition counts, template names, and file or line information when Shopify provides it.
- **A recommended action:** what the developer should investigate—not just a generic instruction to “optimize the theme.”
- **Risks and trade-offs:** features or business behavior that must continue working.
- **A validation plan:** how to profile and test the page again after the change.

Treat recommendations as leads to investigate, not permission to delete theme or app code. A frequently rendered component may still be essential to the shopping experience.

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

## Plain-English glossary

| Term | Meaning |
|---|---|
| **Theme** | The templates and code that control how your online store looks and behaves. |
| **Liquid** | Shopify's template language. It builds page content on Shopify's servers before the page reaches the shopper. |
| **Template** | The main layout for a type of page, such as a product or collection page. |
| **Section** | A configurable part of a theme page, such as a banner, product grid, or featured collection. |
| **Snippet** | A smaller reusable piece of Liquid code, such as a product card, price, or icon. |
| **App block or embed** | Theme code added by a Shopify app to provide a storefront feature. |
| **Server-side render time** | Time Shopify spends processing the Liquid theme before sending the response. It is only one part of the shopper's total page-load experience. |
| **Bottleneck** | Work that consumes enough time or repeats enough times to deserve investigation. |
| **Flame graph** | A technical visualization showing where rendering time was spent. The MCP translates this data into summaries and recommendations. |
| **Profile** | One recorded measurement of how Shopify rendered a particular storefront page. |

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
