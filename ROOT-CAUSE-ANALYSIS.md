# Root Cause Analysis: Shopify Theme Inspector MCP — From Basic to Full Profiling

## Date: February 2026

## Status: ✅ RESOLVED (v0.2.0)

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Investigation: How the Chrome Extension Works](#investigation-how-the-chrome-extension-works)
3. [Root Cause: What Was Wrong](#root-cause-what-was-wrong)
4. [The Fix: Step-by-Step Solution](#the-fix-step-by-step-solution)
5. [Critical Implementation Detail: The Redirect URI Problem](#critical-implementation-detail-the-redirect-uri-problem)
6. [Architecture Overview](#architecture-overview)
7. [Data Format: Speedscope JSON](#data-format-speedscope-json)
8. [Verified Results](#verified-results)
9. [Technical Reference](#technical-reference)
10. [Key Lessons Learned](#key-lessons-learned)
11. [Testing Guide](#testing-guide)

---

## Problem Statement

The MCP server's `profile_page` tool was returning only **basic** profiling data — a handful of Server-Timing metrics like total processing time. Meanwhile, the official [Shopify Theme Inspector Chrome Extension](https://github.com/Shopify/shopify-theme-inspector) returns **full flame graph data** for the same store, with per-template, per-line timing for every Liquid render operation.

**Before (v0.1.0):** ~5 basic timing metrics  
**After (v0.2.0):** 3,232 profiling nodes with file paths and line numbers

---

## Investigation: How the Chrome Extension Works

We reverse-engineered the complete source code of the Shopify Theme Inspector Chrome Extension. The critical files are:

| File                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `src/env.ts`                  | Client IDs, subject IDs, scopes, OAuth domain        |
| `src/utils/oauth2.ts`         | Full OAuth2 PKCE flow + RFC 8693 token exchange      |
| `src/utils/getProfileData.ts` | The actual fetch with Bearer token + Accept header   |
| `src/background.ts`           | Authentication orchestration + `chrome.identity` API |

### The Chrome Extension's Exact Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: OAuth2 Authorization (PKCE)                        │
│  ─────────────────────────────────────────────────────────── │
│  Endpoint: https://accounts.shopify.com/oauth/authorize     │
│  Client ID: ff2a91a2-6854-449e-a37d-c03bcd181126            │
│  Scope: openid profile                                       │
│         https://api.shopify.com/auth/shop.storefront-        │
│         renderer.devtools                                    │
│  Redirect: https://<ext-id>.chromiumapp.org/auth0            │
│  PKCE: S256 code challenge                                   │
│  Result: Authorization code                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Token Exchange (Authorization Code → Client Token)  │
│  ─────────────────────────────────────────────────────────── │
│  Endpoint: https://accounts.shopify.com/oauth/token          │
│  Grant Type: authorization_code                              │
│  Code Verifier: from PKCE step                               │
│  Result: Client Access Token + Refresh Token                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Subject Token Exchange (RFC 8693)                   │
│  ─────────────────────────────────────────────────────────── │
│  Endpoint: https://accounts.shopify.com/oauth/token          │
│  Grant Type: urn:ietf:params:oauth:grant-type:token-exchange │
│  Subject Token: client access token (from Step 2)            │
│  Subject Token Type:                                         │
│    urn:ietf:params:oauth:token-type:access_token             │
│  Audience: ee139b3d-5861-4d45-b387-1bc3ada7811c              │
│    (storefront-renderer devtools)                            │
│  Result: Subject Access Token (the profiling key!)           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 4: Fetch Profile Data                                  │
│  ─────────────────────────────────────────────────────────── │
│  URL: https://storefront-url.com/page-path                   │
│  Method: GET                                                 │
│  Headers:                                                    │
│    Accept: application/vnd.speedscope+json    ← KEY HEADER  │
│    Authorization: Bearer <subject_access_token> ← KEY AUTH  │
│  Response: Full speedscope JSON (3000+ nodes)                │
└─────────────────────────────────────────────────────────────┘
```

### Critical Constants (from `src/env.ts`)

```typescript
OAUTH2_DOMAIN = "accounts.shopify.com";
OAUTH2_CLIENT_ID = "ff2a91a2-6854-449e-a37d-c03bcd181126";
STOREFRONT_RENDERER_ID = "ee139b3d-5861-4d45-b387-1bc3ada7811c";
DEVTOOLS_SCOPE =
  "https://api.shopify.com/auth/shop.storefront-renderer.devtools";
COLLABORATORS_SCOPE =
  "https://api.shopify.com/auth/partners.collaborator-relationships.readonly";
```

These are **not secrets** — they're hardcoded in the Chrome extension's public source code and are used to identify the application to Shopify's OAuth provider.

---

## Root Cause: What Was Wrong

### Our MCP Was Doing (❌ Wrong)

```
1. Cookie-based auth via Puppeteer browser login
   - Opens browser → user logs into admin → extracts cookies

2. Loads page with Puppeteer
   - URL: https://store.myshopify.com/path?profile_liquid=true
   - Uses session cookies (not Bearer tokens)
   - No Accept header for speedscope format

3. Tries to extract profiling data from:
   - Response body (HTML, not JSON!)
   - Server-Timing headers (basic timing metrics only)
   - Script tags and global variables
   - Embedded JSON in page content
```

### Why This Was Fundamentally Wrong

| Aspect            | Our MCP (Wrong)                            | Chrome Extension (Correct)              |
| ----------------- | ------------------------------------------ | --------------------------------------- |
| **Auth method**   | Session cookies                            | OAuth2 Bearer token                     |
| **Auth target**   | Shopify Admin                              | Shopify Identity (accounts.shopify.com) |
| **Token type**    | None (cookies)                             | Storefront-renderer subject token       |
| **Request URL**   | `store.myshopify.com/?profile_liquid=true` | `storefront-url.com/page-path`          |
| **Accept header** | `text/html` (default)                      | `application/vnd.speedscope+json`       |
| **Response**      | HTML with Server-Timing headers            | Pure JSON profiling data                |
| **Data quality**  | ~5 timing metrics                          | 3,000+ nodes with file/line info        |

When you send a request with **cookies** and `?profile_liquid=true`, Shopify returns the **normal HTML page** with some basic `Server-Timing` headers. This gives you a total processing time, but NOT the detailed per-template/per-line profiling data.

When you send a request with `Accept: application/vnd.speedscope+json` and a valid **storefront-renderer devtools Bearer token**, Shopify returns **pure JSON profiling data** in speedscope format — the complete render tree.

---

## The Fix: Step-by-Step Solution

### 1. New Module: `src/auth/shopify-identity-oauth.ts`

This module implements the **exact same OAuth2 PKCE flow** used by the Chrome extension:

```typescript
// Key configuration (mirrors Chrome extension's env.ts)
const OAUTH2_DOMAIN = "accounts.shopify.com";
const OAUTH2_CLIENT_ID = "ff2a91a2-6854-449e-a37d-c03bcd181126";
const STOREFRONT_RENDERER_SUBJECT_ID = "ee139b3d-5861-4d45-b387-1bc3ada7811c";
const DEVTOOLS_SCOPE =
  "https://api.shopify.com/auth/shop.storefront-renderer.devtools";

// The Chrome extension's redirect URI (see Section 5 for why this matters)
const CHROME_EXTENSION_REDIRECT_URI =
  "https://fndnankcflemoafdeboboehphmiijkgp.chromiumapp.org/auth0";
```

**Key functions:**

| Function                              | Purpose                                            |
| ------------------------------------- | -------------------------------------------------- |
| `loginWithOAuth(storeUrl)`            | Complete OAuth2 PKCE flow with Puppeteer browser   |
| `captureOAuthRedirect(page, authUrl)` | Intercepts the OAuth redirect to extract auth code |
| `getProfilingAccessToken(storeUrl)`   | Returns current valid subject token for profiling  |
| `getOAuthTokens(storeUrl)`            | Retrieves stored tokens from disk                  |
| `saveOAuthTokens(tokens)`             | Persists tokens to `~/.shopify-theme-inspector/`   |

**Token lifecycle:**

```typescript
// Step 1: PKCE Code Verifier + Challenge
const codeVerifier = generateCodeVerifier(); // 64-byte random
const codeChallenge = generateCodeChallenge(codeVerifier); // SHA-256 + base64url

// Step 2: Build auth URL
const authUrl = new URL(`https://accounts.shopify.com/oauth/authorize`);
authUrl.searchParams.set("client_id", OAUTH2_CLIENT_ID);
authUrl.searchParams.set("scope", scope);
authUrl.searchParams.set("redirect_uri", CHROME_EXTENSION_REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

// Step 3: User completes login in browser, code captured via redirect intercept

// Step 4: Exchange code → client token
const clientToken = await fetch(tokenEndpoint, {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OAUTH2_CLIENT_ID,
    redirect_uri: CHROME_EXTENSION_REDIRECT_URI,
    code: authorizationCode,
    code_verifier: codeVerifier,
  }),
});

// Step 5: Exchange client token → subject token (RFC 8693)
const subjectToken = await fetch(tokenEndpoint, {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: OAUTH2_CLIENT_ID,
    audience: STOREFRONT_RENDERER_SUBJECT_ID,
    subject_token: clientToken.accessToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scopes: DEVTOOLS_SCOPE,
  }),
});
```

### 2. Rewritten: `src/profiler/page-profiler.ts`

Instead of loading pages with Puppeteer + cookies, we now send a **simple HTTP fetch**:

```typescript
async function profileWithToken(
  storeUrl: string,
  pagePath: string,
  accessToken: string,
  timeout: number,
): Promise<ProfileResult> {
  const profileUrl = `https://${storeUrl}${pagePath}`;

  const response = await fetch(profileUrl, {
    method: "GET",
    headers: {
      Accept: "application/vnd.speedscope+json", // ← THE KEY HEADER
      Authorization: `Bearer ${accessToken}`, // ← SUBJECT TOKEN
      "User-Agent": "Shopify-Theme-Inspector-MCP/0.2.0",
    },
    signal: AbortSignal.timeout(timeout),
  });

  const contentType = response.headers.get("content-type");

  // If Shopify returns JSON → full profiling data
  if (contentType?.includes("json")) {
    const data = await response.json();
    // Parse speedscope format into our ProfileResult
    return parseSpeedscopeResponse(data);
  }

  // Fallback: parse Server-Timing headers for basic data
  return parseServerTimingFallback(response);
}
```

**Speedscope parser** — Converts Open/Close evented format into a hierarchical flame graph:

```typescript
function parseSpeedscopeData(data: SpeedscopeFile): ProfilingData {
  // Speedscope events represent a stack trace:
  // O(frame0) → O(frame1) → C(frame1) → C(frame0)
  // This translates to: frame0 contains frame1 as a child

  const stack: ProfileNode[] = [];

  for (const event of profile.events) {
    const frame = frames[event.frame];
    if (event.type === "O") {
      // Push new node onto stack
      const node = { name: frame.name, file: frame.file, ... };
      stack[stack.length - 1]?.children.push(node);
      stack.push(node);
    } else {
      // Close: pop from stack, calculate self time
      const finished = stack.pop();
      finished.totalTime = event.at - finished.startAt;
    }
  }
}
```

### 3. Updated: `src/index.ts`

| Tool                  | Auth Method               | Purpose                              |
| --------------------- | ------------------------- | ------------------------------------ |
| `login`               | OAuth2 (Shopify Identity) | Authenticate for profiling           |
| `login_legacy`        | Cookie-based (Admin)      | Authenticate for theme asset access  |
| `logout`              | Clears both               | Clean up all sessions                |
| `profile_page`        | OAuth2 token              | Profile a page with full flame graph |
| `get_profile_summary` | OAuth2 token              | Get performance breakdown            |
| `find_slow_templates` | OAuth2 token              | Identify bottleneck templates        |
| `analyze_liquid_file` | Legacy cookies            | Static analysis of Liquid code       |

---

## Critical Implementation Detail: The Redirect URI Problem

This was the **hardest bug to solve** and warrants specific documentation.

### The Problem

The Chrome extension uses Chrome's `chrome.identity.launchWebAuthFlow()` API, which provides a redirect URI in this format:

```
https://<chrome-extension-id>.chromiumapp.org/auth0
```

When registering the OAuth2 client with Shopify, this **exact** redirect URI is registered. Shopify strictly validates redirect URIs — any mismatch results in:

```
error: redirect_uri_mismatch
```

### Failed Approach: Local HTTP Server

Our initial approach was to start a local HTTP server and use `http://127.0.0.1:{port}/callback` as the redirect URI. This **failed** because Shopify's OAuth client only accepts the Chrome extension's registered redirect URI.

```
❌ http://127.0.0.1:4891/callback → "redirect_uri_mismatch"
```

### Working Solution: Puppeteer Request Interception

Instead of running a server at the redirect URI, we:

1. **Use the Chrome extension's actual redirect URI** in the OAuth request
2. **Intercept the redirect** in Puppeteer before the browser tries to navigate to it

```typescript
const CHROME_EXTENSION_REDIRECT_URI =
  "https://fndnankcflemoafdeboboehphmiijkgp.chromiumapp.org/auth0";
```

The Chrome extension ID (`fndnankcflemoafdeboboehphmiijkgp`) is obtained from the [Chrome Web Store listing](https://chromewebstore.google.com/detail/shopify-theme-inspector-f/fndnankcflemoafdeboboehphmiijkgp).

```typescript
async function captureOAuthRedirect(page, authUrl, redirectUri, timeout) {
  return new Promise(async (resolve, reject) => {
    // Enable request interception
    await page.setRequestInterception(true);

    page.on("request", (request) => {
      const url = request.url();

      if (url.startsWith(redirectUri)) {
        // This is the OAuth callback! Extract the authorization code
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get("code");

        if (code) {
          resolve(code);
        }

        // Abort the request — don't actually navigate to the
        // Chrome extension URL (it's not a real webpage)
        request.abort().catch(() => {});
        return;
      }

      // Allow all other requests through normally
      request.continue().catch(() => {});
    });

    // Navigate to the Shopify login page
    await page.goto(authUrl, { waitUntil: "networkidle2" });
  });
}
```

**How it works:**

1. Puppeteer opens the Shopify Identity login page
2. User logs in manually
3. Shopify redirects to `https://fndnankcflemoafdeboboehphmiijkgp.chromiumapp.org/auth0?code=ABC123`
4. Puppeteer's request interceptor catches this redirect **before** the browser loads the URL
5. We extract `code=ABC123` from the URL
6. We abort the request (the URL isn't a real webpage anyway)
7. Browser closes, code is used for token exchange

This works because:

- Shopify accepts the redirect URI (it's the registered one)
- We never need to actually load the URL
- The authorization code is in the URL query parameters

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   MCP Server (index.ts)                  │
│                                                          │
│  Tools:                                                  │
│  ├── login          → shopify-identity-oauth.ts          │
│  ├── login_legacy   → shopify-oauth.ts (Admin cookies)   │
│  ├── profile_page   → page-profiler.ts                   │
│  ├── get_profile_summary → flamegraph-parser.ts          │
│  ├── find_slow_templates → flamegraph-parser.ts          │
│  ├── analyze_liquid_file → static-analysis.ts            │
│  └── health_check   → checks both auth systems           │
│                                                          │
│  Auth Systems:                                           │
│  ├── OAuth2 (NEW) ──→ Profiling (Bearer token)           │
│  └── Cookie (OLD) ──→ Admin API (theme assets)           │
└─────────────────────────────────────────────────────────┘

File Structure:
src/
├── index.ts                        # MCP server + tool definitions
├── auth/
│   ├── shopify-identity-oauth.ts   # NEW: OAuth2 PKCE + token exchange
│   ├── shopify-oauth.ts            # Legacy: Puppeteer cookie extraction
│   └── session-manager.ts          # Legacy: Cookie session storage
├── profiler/
│   ├── page-profiler.ts            # REWRITTEN: fetch + Bearer token
│   ├── flamegraph-parser.ts        # Profile summary generation
│   └── static-analysis.ts          # Liquid code static analysis
├── api/
│   └── theme-assets.js             # Admin API for theme files
└── utils/
    └── logger.ts                   # Logging utility

Token Storage:
~/.shopify-theme-inspector/
└── oauth-tokens.json               # Persisted OAuth2 tokens per store
```

---

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
      "endValue": 188204781,
      "events": [
        { "type": "O", "frame": 0, "at": 0 },
        { "type": "O", "frame": 1, "at": 100 },
        { "type": "C", "frame": 1, "at": 5000 },
        { "type": "C", "frame": 0, "at": 188204781 }
      ]
    }
  ],
  "shared": {
    "frames": [
      { "name": "liquid_template", "file": "layout/theme" },
      {
        "name": "tag:render 'cart-drawer'",
        "file": "layout/theme",
        "line": 359
      },
      {
        "name": "variable:product.price | money",
        "file": "sections/more-from-onebed-carousel",
        "line": 48
      }
    ]
  }
}
```

### Format Details

- **Events** use Open (`O`) / Close (`C`) to represent nested call stacks
- **Frames** contain the Liquid file path (e.g., `sections/header`) and line number
- **Self-time** = total time − sum of children's total time
- Each frame's `name` indicates the operation type:
  - `liquid_template` — template render
  - `section` — section render
  - `tag:render 'snippet'` — snippet include
  - `tag:for ...` — loop iteration
  - `tag:if ...` — conditional evaluation
  - `tag:assign ...` — variable assignment
  - `variable:x | filter` — variable output with filter
  - `filter:xxx` — Liquid filter execution

---

## Verified Results

### Test: `profile_page` on `onebed.com.au/` (February 11, 2026)

| Metric                  | Before (v0.1.0) | After (v0.2.0)                        |
| ----------------------- | --------------- | ------------------------------------- |
| **Data quality**        | Basic           | Full flame graph                      |
| **Node count**          | ~5              | **3,232**                             |
| **Total render time**   | ~188ms          | **188.2ms** (identical, now precise)  |
| **File paths**          | ❌ None         | ✅ Full paths with line numbers       |
| **Template breakdown**  | ❌ None         | ✅ 24 templates with render counts    |
| **Top slow operations** | ❌ None         | ✅ Per-line bottleneck identification |

### Sample Output: Top Slow Nodes

| Operation                                | File                                 | Line | Time  | %     |
| ---------------------------------------- | ------------------------------------ | ---- | ----- | ----- |
| `tag:assign product = all_products[...]` | `sections/our-mattresses-carousel`   | 15   | 6.1ms | 3.25% |
| `tag:if content_for_header contains...`  | `snippets/SEOAnt-SpeedUp`            | 14   | 6.8ms | 3.60% |
| `tag:render 'cart-drawer'`               | `layout/theme`                       | 359  | 5.6ms | 2.97% |
| `variable:product.price \| money`        | `sections/more-from-onebed-carousel` | 48   | 3.4ms | 1.80% |

### Sample Output: Template Breakdown

| File                                 | Renders | Time   | %     |
| ------------------------------------ | ------- | ------ | ----- |
| `layout/theme`                       | 676     | 48.4ms | 25.7% |
| `sections/more-from-onebed-carousel` | 124     | 16.9ms | 9.0%  |
| `sections/our-mattresses-carousel`   | 71      | 12.1ms | 6.4%  |
| `snippets/header-mega-menu`          | 761     | 11.0ms | 5.8%  |
| `sections/header`                    | 124     | 8.1ms  | 4.3%  |
| `snippets/SEOAnt-SpeedUp`            | 12      | 6.8ms  | 3.6%  |

This level of detail allows AI to pinpoint **exact lines** in Liquid templates causing performance issues.

---

## Technical Reference

### OAuth2 Endpoints

| Endpoint         | URL                                                             |
| ---------------- | --------------------------------------------------------------- |
| OpenID Discovery | `https://accounts.shopify.com/.well-known/openid-configuration` |
| Authorization    | `https://accounts.shopify.com/oauth/authorize`                  |
| Token            | `https://accounts.shopify.com/oauth/token`                      |
| UserInfo         | `https://accounts.shopify.com/oauth/userinfo`                   |

### OAuth2 Parameters

| Parameter                      | Value                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ID                      | `ff2a91a2-6854-449e-a37d-c03bcd181126`                                                                                                                    |
| Storefront Renderer Subject ID | `ee139b3d-5861-4d45-b387-1bc3ada7811c`                                                                                                                    |
| Redirect URI                   | `https://fndnankcflemoafdeboboehphmiijkgp.chromiumapp.org/auth0`                                                                                          |
| Scopes                         | `openid profile https://api.shopify.com/auth/shop.storefront-renderer.devtools https://api.shopify.com/auth/partners.collaborator-relationships.readonly` |
| PKCE Method                    | `S256`                                                                                                                                                    |
| Token Exchange Grant           | `urn:ietf:params:oauth:grant-type:token-exchange`                                                                                                         |

### Profiling Request

```http
GET /page-path HTTP/1.1
Host: storefront-url.com
Accept: application/vnd.speedscope+json
Authorization: Bearer <subject_access_token>
User-Agent: Shopify-Theme-Inspector-MCP/0.2.0
```

### Dependencies

| Package                     | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `puppeteer`                 | Browser automation for interactive OAuth login + redirect interception |
| `@modelcontextprotocol/sdk` | MCP server framework                                                   |
| `zod`                       | Schema validation for tool parameters                                  |
| `node:crypto`               | PKCE code verifier/challenge generation                                |

---

## Key Lessons Learned

1. **`?profile_liquid=true` is a red herring.** The Chrome extension does NOT use this query parameter. The profiling endpoint is activated solely by the `Accept: application/vnd.speedscope+json` header combined with a valid devtools Bearer token.

2. **Cookie-based auth gives you HTML pages, not profiling data.** Admin login cookies authenticate you for the Shopify Admin dashboard, not the storefront-renderer devtools API.

3. **RFC 8693 token exchange is mandatory.** You cannot use the initial OAuth client token directly for profiling. You must exchange it for a storefront-renderer subject token using the `urn:ietf:params:oauth:grant-type:token-exchange` grant type.

4. **The OAuth client's redirect URI is locked.** Shopify strictly validates the redirect URI. Since the client ID belongs to the Chrome extension, only the Chrome extension's registered redirect URI is accepted. The solution is to use that exact URI and intercept the redirect in Puppeteer.

5. **The Chrome extension ID is the key to the redirect URI.** The extension ID `fndnankcflemoafdeboboehphmiijkgp` can be found on the [Chrome Web Store page](https://chromewebstore.google.com/detail/shopify-theme-inspector-f/fndnankcflemoafdeboboehphmiijkgp). The redirect URI format is `https://<extension-id>.chromiumapp.org/auth0`.

6. **All critical constants are public.** The client ID, subject ID, and scopes are hardcoded in the Chrome extension's open-source code — they are not secrets.

7. **Token storage enables persistent sessions.** Tokens are saved to `~/.shopify-theme-inspector/oauth-tokens.json` so users don't need to re-authenticate on every MCP restart.

---

## Testing Guide

### Prerequisites

- Node.js 18+
- Chromium/Chrome (installed for Puppeteer)
- A Shopify store you have collaborator/staff access to

### Steps

1. **Build and start the MCP Inspector:**

   ```bash
   npm run build
   npx @modelcontextprotocol/inspector node dist/index.js
   ```

2. **Test the `login` tool:**
   - Input: `{ "storeUrl": "your-store.com" }`
   - A Chromium browser window opens → Shopify Identity login page
   - Log in with your Shopify account
   - Browser closes automatically → returns success with token info
   - Verify the token file is created at `~/.shopify-theme-inspector/oauth-tokens.json`

3. **Test `profile_page`:**
   - Input: `{ "storeUrl": "your-store.com", "pagePath": "/" }`
   - Should return `success: true` with `nodeCount` > 100
   - Should include `rawData` with `$schema: "https://www.speedscope.app/file-format-schema.json"`
   - Should include `summary.templateBreakdown` with file paths

4. **Test `get_profile_summary`:**
   - Provides a high-level performance overview
   - Should show per-file timing breakdown

5. **Test `find_slow_templates`:**
   - Identifies the slowest templates by self-time
   - Should include file paths and line numbers for bottlenecks

### Expected `profile_page` Response Structure

```json
{
  "success": true,
  "storeUrl": "your-store.com",
  "pagePath": "/",
  "totalTime": 188204781,
  "nodeCount": 3232,
  "summary": {
    "topSlowNodes": [
      {
        "name": "tag:assign product = all_products[...]",
        "file": "sections/our-mattresses-carousel",
        "line": 15,
        "time": 6118684,
        "percentage": 3.25
      }
    ],
    "templateBreakdown": [
      {
        "file": "layout/theme",
        "renders": 676,
        "totalTime": 48373382,
        "percentage": 25.7
      }
    ]
  },
  "rawData": {
    "$schema": "https://www.speedscope.app/file-format-schema.json",
    "profiles": [...],
    "shared": { "frames": [...] }
  }
}
```
