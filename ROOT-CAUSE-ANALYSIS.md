# Root Cause Analysis: Why MCP Returns "Basic" Profiling Data

## Date: February 2026

## Problem Statement

The MCP server's `profile_page` tool returns only "Basic" profiling data (server-timing metrics), while the official Shopify Theme Inspector Chrome extension returns detailed flame graph data for the same store (e.g., `https://onebed.com.au/`).

## Root Cause: Completely Wrong Authentication & Data Retrieval Method

### What the Chrome Extension Does (✅ Correct)

After reverse-engineering the complete source code of the [Shopify Theme Inspector Chrome Extension](https://github.com/Shopify/shopify-theme-inspector), here is exactly how it obtains full flame graph data:

```
1. OAuth2 PKCE Login via Shopify Identity (accounts.shopify.com)
   - Client ID: ff2a91a2-6854-449e-a37d-c03bcd181126
   - Scope: "openid profile https://api.shopify.com/auth/shop.storefront-renderer.devtools"

2. Token Exchange (RFC 8693)
   - Exchange the client access token for a SUBJECT access token
   - Subject/Audience: ee139b3d-5861-4d45-b387-1bc3ada7811c (storefront-renderer)
   - Grant type: urn:ietf:params:oauth:grant-type:token-exchange

3. Fetch Profile Data (the key insight!)
   - URL: The store page URL (e.g., https://onebed.com.au/)
   - Headers:
     - Accept: application/vnd.speedscope+json
     - Authorization: Bearer <subject_access_token>

4. Response: Full profiling data in speedscope JSON format
   - Contains profiles[] with evented Open/Close events
   - Contains shared.frames[] with file names, line numbers
   - Can be directly visualized as a flame graph
```

**Key files in the Chrome extension source:**

- `src/utils/getProfileData.ts` — The actual fetch with Bearer token + Accept header
- `src/utils/oauth2.ts` — Full OAuth2 PKCE flow with token exchange
- `src/env.ts` — Client IDs, subject IDs, scopes
- `src/background.ts` — Authentication orchestration

### What Our MCP Was Doing (❌ Wrong)

```
1. Cookie-based auth via Puppeteer browser login
   - Opens browser → user logs in → extracts cookies

2. Loads page with Puppeteer
   - URL: https://store.myshopify.com/path?profile_liquid=true
   - Uses session cookies (not Bearer tokens)

3. Tries to extract data from:
   - Response body (which is HTML, not JSON!)
   - Server-Timing headers (basic timing metrics only)
   - Script tags and global variables
   - Embedded JSON in page content
```

### Why This Was Wrong

When you send a request to a Shopify storefront with **cookies** and `?profile_liquid=true`, Shopify returns the **normal HTML page** with some basic `Server-Timing` headers. This gives you metrics like total processing time, but NOT the detailed per-template/per-line profiling data.

When you send a request with `Accept: application/vnd.speedscope+json` and a valid **storefront-renderer devtools Bearer token**, Shopify returns **pure JSON profiling data** in speedscope format. This contains the complete render tree with timing for every Liquid template, section, snippet, and tag — the actual flame graph data.

## The Fix (v0.2.0)

### New Module: `src/auth/shopify-identity-oauth.ts`

- Implements the exact same OAuth2 PKCE flow as the Chrome extension
- Uses Shopify Identity (accounts.shopify.com) with the correct client ID and scopes
- Performs RFC 8693 token exchange to get a storefront-renderer devtools token
- Opens a Puppeteer browser for the interactive login, captures the auth code via a local HTTP server redirect
- Stores tokens with refresh capability

### Rewritten: `src/profiler/page-profiler.ts`

- Instead of loading pages with Puppeteer + cookies:
  - Sends a simple HTTP `fetch()` with `Accept: application/vnd.speedscope+json` and `Authorization: Bearer <token>`
- Parses the speedscope JSON response into our `ProfilingData` structure
- Falls back to Server-Timing parsing if the token doesn't work

### Updated: `src/index.ts`

- `login` tool now uses OAuth2 (Shopify Identity)
- `login_legacy` tool preserved for Admin API access (theme asset analysis)
- `logout` cleans up both OAuth and legacy sessions
- Profiling tools no longer require cookie-based auth

## Data Format: Speedscope JSON

The profiling response is in [speedscope format](https://www.speedscope.app/file-format-schema.json):

```json
{
  "$schema": "https://www.speedscope.app/file-format-schema.json",
  "profiles": [
    {
      "type": "evented",
      "name": "liquid",
      "unit": "microseconds",
      "startValue": 0,
      "endValue": 150000,
      "events": [
        { "type": "O", "frame": 0, "at": 0 },
        { "type": "O", "frame": 1, "at": 100 },
        { "type": "C", "frame": 1, "at": 5000 },
        { "type": "C", "frame": 0, "at": 150000 }
      ]
    }
  ],
  "shared": {
    "frames": [
      { "name": "layout/theme.liquid", "file": "layout/theme.liquid" },
      {
        "name": "sections/header.liquid",
        "file": "sections/header.liquid",
        "line": 1
      }
    ]
  }
}
```

- **Events** use Open (O) / Close (C) to represent the call stack
- **Frames** contain file names and line numbers
- Self-time = total time - children's total time

## Key Lessons

1. **The `?profile_liquid=true` parameter is a red herring.** The Chrome extension doesn't use it at all. It uses Bearer token + Accept header.

2. **Cookie-based auth gives you HTML pages, not profiling data.** The profiling data endpoint is activated by the `Accept: application/vnd.speedscope+json` header combined with a valid devtools token.

3. **Token exchange (RFC 8693) is required.** You can't use the initial OAuth client token directly. You must exchange it for a storefront-renderer subject token.

4. **The client ID and subject ID are hardcoded in the Chrome extension.** They are not secret — they're part of the extension's public source code.

## Testing

To verify the fix:

1. Run `login` with a store URL
2. Complete the Shopify login in the browser that opens
3. Run `profile_page` — should now return full speedscope data with detailed template timing
4. Run `get_profile_summary` — should show per-file breakdown
5. Run `find_slow_templates` — should identify specific slow templates with file/line info
