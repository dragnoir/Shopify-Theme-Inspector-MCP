# Shopify Theme Inspector MCP - Development Tasks

## Phase 1: Project Setup & Basic MCP Server ✅

- [x] Initialize Node.js/TypeScript project with MCP SDK
- [x] Set up project structure (src, tests, config)
- [x] Create basic MCP server with health check tool
- [x] Configure build and development scripts
- [x] Test basic MCP server connection

## Phase 2: Shopify Authentication Module ✅

- [x] Research Shopify OAuth flow for theme access
- [x] Implement legacy cookie-based OAuth authentication handler
- [x] Create session/token management
- [x] Add store configuration resource
- [x] Test authentication flow

## Phase 3: Profiler Core - Basic Profiling ✅

- [x] Implement store URL fetching with profiling enabled
- [x] Parse profiling data from response headers/body
- [x] Create basic profiling result interface
- [x] Implement `profile_page` tool (MVP)
- [x] Test profiling on a sample store

## Phase 4: OAuth2 Fix — Full Flame Graph Data ✅ (v0.2.0)

> **Root cause:** The MCP was using cookie-based auth + `?profile_liquid=true`, which
> only returns basic Server-Timing metrics. The Chrome extension uses OAuth2 Bearer
> tokens + `Accept: application/vnd.speedscope+json` to get full flame graph data.
> See `ROOT-CAUSE-ANALYSIS.md` for complete details.

- [x] Reverse-engineer Shopify Theme Inspector Chrome Extension source code
- [x] Identify correct OAuth2 PKCE flow (client ID, scopes, token exchange)
- [x] Implement `src/auth/shopify-identity-oauth.ts` (OAuth2 module)
- [x] Handle redirect URI mismatch (use Chrome extension's URI + Puppeteer interception)
- [x] Implement RFC 8693 token exchange (client token → subject token)
- [x] Implement token storage (`~/.shopify-theme-inspector/oauth-tokens.json`)
- [x] Rewrite `src/profiler/page-profiler.ts` to use Bearer token + speedscope Accept header
- [x] Implement speedscope JSON parser (Open/Close evented format → flame graph)
- [x] Update `src/index.ts` — `login` tool now uses OAuth2
- [x] Preserve legacy `login_legacy` for Admin API theme asset access
- [x] Test `login` with real store (onebed.com.au) — ✅ working
- [x] Test `profile_page` — ✅ returns 3,232 nodes with file paths and line numbers
- [x] Write `ROOT-CAUSE-ANALYSIS.md` documenting the issue and fix

## Phase 5: Flame Graph Data Processing ✅

- [x] Parse flame graph JSON data structure (speedscope evented format)
- [x] Create data models for profiling nodes (`SpeedscopeFrame`, `SpeedscopeEvent`, etc.)
- [x] Implement hierarchical data transformation (O/C events → tree)
- [x] Add aggregation for performance metrics (totalTime, selfTime, percentage)
- [x] Create `get_profile_summary` tool — ✅ returns per-template breakdown
- [x] Create `find_slow_templates` tool — ✅ identifies bottleneck templates with file/line

## Phase 6: Performance Analysis Tools ✅

- [x] Implement `find_slow_templates` tool with configurable threshold
- [x] Create `analyze_liquid_file` tool (static analysis via Admin API)
- [x] Add template breakdown with render counts and self-time percentages
- [x] Implement top slow nodes identification with file and line info

## Phase 7: Documentation ✅

- [x] Write comprehensive `ROOT-CAUSE-ANALYSIS.md`
- [x] Create `TESTING.md` with test procedures
- [x] Document OAuth2 flow, data format, and architecture

---

## Phase 8: Advanced Features & Polish ⬅️ NEXT

### 8a: Improve profiling output for AI consumption ✅ (v0.3.0)

- [x] Add performance recommendations engine (auto-detect anti-patterns like `all_products[]`)
- [x] Add severity ratings to slow template findings (critical/warning/info)
- [x] Create a `get_bottlenecks` tool that combines profiling + auto-recommendations
- [x] Summarize optimization suggestions based on known Shopify anti-patterns

### 8b: Token management improvements ✅ (v0.3.0)

- [x] Implement automatic token refresh using the refresh token
  - Fixed critical bug: `getOAuthTokens()` was discarding expired tokens, preventing refresh
  - Added `getOAuthTokensRaw()` for internal access to expired tokens (to read refresh_token)
  - `getProfilingAccessToken()` now reliably auto-refreshes and preserves refresh tokens
  - Revoked refresh tokens (4xx errors) trigger automatic cleanup of stale tokens
- [x] Add token expiry checking before profiling requests
  - Added `getTokenStatus()` — detailed diagnostics: validity, time remaining, refresh capability
  - Added `getProfilingTokenStatus()` — informational status for error messaging
  - `get_auth_status` tool now shows `timeRemaining`, `canAutoRefresh`, and `profilingStatus`
- [x] Graceful re-authentication prompt when tokens expire
  - Context-aware error messages in `page-profiler.ts`: distinguishes "not authenticated", "expired + refresh failed", and "expired + no refresh token"

### 8c: Multi-page & comparison features ✅ (v0.3.0)

- [x] Implement page comparison tool (profile two pages, show diff)
  - `compare_pages` tool: profiles both in parallel, shows delta, template-by-template diff, unique recommendations per page
- [x] Create batch profiling for multiple pages at once
  - `batch_profile` tool: profiles up to 10 pages in parallel, sorts by slowest, shows per-page issues and top templates
- [x] Add historical profiling data storage for trend tracking
  - `profile-history.ts` module: file-based history at `~/.shopify-theme-inspector/history/`
  - `get_profile_history` tool: view trends (improving/degrading/stable), list profiled pages, clear history
  - All profiling tools auto-save snapshots (profile_page, get_bottlenecks, compare_pages, batch_profile)

### 8d: Export & integration

- [ ] Add export functionality (speedscope JSON, CSV summary)
- [ ] Generate direct [speedscope.app](https://www.speedscope.app) links for visualization
- [ ] Add Markdown report generation for sharing

### 8e: README & publishing

- [ ] Update README.md with full setup instructions
- [ ] Add tool usage examples with sample outputs
- [ ] Create configuration guide (MCP client setup, Claude Desktop, etc.)
- [ ] Add troubleshooting section
- [ ] Publish to npm (optional)
