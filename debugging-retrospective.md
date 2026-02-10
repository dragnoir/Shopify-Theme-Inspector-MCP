# Debugging Retrospective: Shopify Liquid Profiling

## Overview

This document summarizes the technical challenges and solutions encountered while implementing the `profile_page` tool for the Shopify Theme Inspector MCP server. The primary issue was a persistent failure to extract profiling data from a store using a custom domain (`onebed.com.au`), despite successful authentication.

## Key Issues & Solutions

### 1. Authentication & Cookie Scope

**Problem:**
The initial OAuth implementation (`shopify-oauth.ts`) relied on Puppeteer's `page.cookies()` to capture session cookies.

- **Mistake:** `page.cookies()` defaults to the _current page URL_. If the login flow ended on the custom domain (e.g., `onebed.com.au`), we only captured cookies for that domain.
- **Impact:** We missed the critical `admin.shopify.com` and `.shopify.com` cookies required for Admin API access. Subsequent requests to `https://[shop].myshopify.com/admin/themes.json` failed or redirected to login because we lacked the necessary authentication cookies.

**Solution:**
We modified the OAuth flow to explicitly capture cookies for the Admin domain (`https://admin.shopify.com`) in addition to the custom domain. This ensures we have a complete session capable of accessing both the storefront and the admin API.

### 2. Custom Domain Redirects & Admin API

**Problem:**
The tool assumed `session.storeUrl` (e.g., `onebed.com.au`) was sufficient for all API calls.

- **Mistake:** Constructing Admin API URLs using the custom domain: `https://onebed.com.au/admin/themes.json`.
- **Impact:** While this URL often redirects to `admin.shopify.com`, the redirect chain caused issues with cookie validation and sometimes resulted in a login page instead of JSON data, breaking the tool.

**Solution:**
We implemented a dynamic discovery mechanism for the `myshopify.com` domain.

- When fetching `themes.json`, we observe the redirect chain.
- If the request redirects to `https://admin.shopify.com/store/[handle]/themes.json`, we extract the store handle (e.g., `onebedau`) and reconstruct the canonical domain: `onebedau.myshopify.com`.
- This ensures subsequent API calls use the correct, authenticated domain.

### 3. Draft Theme Profiling on Custom Domains

**Problem:**
The tool attempted to profile draft themes using the custom domain: `https://onebed.com.au/?preview_theme_id=[id]&profile_liquid=true`.

- **Mistake:** Profiling flags (`?profile_liquid=true`) often fail to trigger when accessed via a custom domain due to caching, CDN behavior (Cloudflare), or strict domain policies.
- **Impact:** The response contained no profiling headers (`Server-Timing`), leading to "No profiling data found" errors.

**Solution:**
We modified `page-profiler.ts` to force the profiling request to happen on the **canonical myshopify domain** (`https://onebedau.myshopify.com/?preview_theme_id=...`).

- Even if this request redirects to the custom domain, the initial hit on `myshopify.com` sets the necessary internal flags/cookies to enable profiling for the session.
- Result: Valid `Server-Timing` headers are returned in the final response.

### 4. Strict Profiling Data Parsing

**Problem:**
The `extractProfilingData` function strictly filtered `Server-Timing` headers for entries containing the keyword "liquid".

- **Mistake:** Some stores (or when on custom domains/cached) return only high-level "Basic" timing data (e.g., `processing`, `db`, `render`) without granular `liquid-render-template` entries.
- **Impact:** The tool correctly received `Server-Timing` headers but discarded them because they didn't match the strict filter, reporting a failure to the user.

**Solution:**
We relaxed the parsing logic in `parseServerTimingHeader`.

- If no specific "liquid" entries are found, the parser now accepts generic timing entries (`render`, `db`, `processing`) as a fallback.
- The tool tags this data as `type: "basic"`.
- This ensures the user receives useful performance metrics (total server time, database time) even if deep Liquid profiling is unavailable.

## Best Practices for Future AI

1. **Always Capture Admin Cookies:** Ensure you have `.shopify.com` and `admin.shopify.com` cookies, not just the store domain cookies.
2. **Prefer Canonical Domains:** Use `[shop].myshopify.com` for Admin API interactions and profiling requests whenever possible.
3. **Handle Redirects Gracefully:** Expect redirects when accessing admin resources via custom domains. Use the final URL to discover the canonical store handle.
4. **Resilient Parsing:** Profiling data formats can vary. Support fallback mechanisms for basic data when detailed flame graphs are missing.
