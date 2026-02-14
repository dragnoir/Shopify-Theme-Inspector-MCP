# Areas for Improvement

This document outlines the areas identified during the code review of the Shopify Theme Inspector MCP project, along with suggested actions for addressing each issue.

---

## Table of Contents

1. [Security Issues](#security-issues)
2. [Error Handling](#error-handling)
3. [Code Quality](#code-quality)
4. [Missing Features](#missing-features)
5. [Performance Considerations](#performance-considerations)
6. [Suggested Action Plan](#suggested-action-plan)

---

## Security Issues

### 1. No Encryption for Stored OAuth Tokens

**Severity:** Medium

**Location:** [`src/auth/shopify-identity-oauth.ts:123`](src/auth/shopify-identity-oauth.ts:123)

**Current Behavior:**
```typescript
fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
```

OAuth tokens are stored in plain JSON files at `~/.shopify-theme-inspector/oauth-tokens.json`.

**Risk:** If an attacker gains access to the filesystem, they can steal the OAuth tokens and potentially access the user's Shopify stores.

**Suggested Action:**
- Implement AES-256 encryption for stored tokens using a user-derived key
- Consider using OS-native keychain integration:
  - **Windows:** Use `keytar` package (wraps Windows Credential Manager)
  - **macOS:** Use Keychain Services
  - **Linux:** Use libsecret

**Example Implementation (conceptual):**
```typescript
import keytar from 'keytar';

const SERVICE_NAME = 'shopify-theme-inspector';
const ACCOUNT_NAME = 'oauth-tokens';

async function saveEncryptedTokens(encryptedData: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, encryptedData);
}
```

---

### 2. Hardcoded OAuth Client ID

**Severity:** Low

**Location:** [`src/auth/shopify-identity-oauth.ts:31`](src/auth/shopify-identity-oauth.ts:31)

**Current Behavior:**
```typescript
const OAUTH2_CLIENT_ID = "ff2a91a2-6854-449e-a37d-c03bcd181126";
```

The OAuth client ID is hardcoded in the source code.

**Risk:** If Shopify rotates this client ID (revokes it or issues a new one), the application will break without notice.

**Suggested Action:**
- Make it configurable via environment variable with a fallback to the default
- Add a warning when using the default client ID

**Example Implementation:**
```typescript
const OAUTH2_CLIENT_ID = process.env.SHOPIFY_OAUTH_CLIENT_ID || "ff2a91a2-6854-449e-a37d-c03bcd181126";
```

---

## Error Handling

### 1. Silent Error Handling in Logger

**Severity:** Low

**Location:** [`src/utils/logger.ts:44-48`](src/utils/logger.ts:44-48)

**Current Behavior:**
```typescript
try {
    fs.appendFileSync(LOG_FILE, logLine);
} catch (error) {
    // Fail silently if can't write to file
}
```

When logging to file fails, the error is silently ignored.

**Risk:** Developers may not realize there's a problem with log file writes, making debugging difficult.

**Suggested Action:**
- Log the failure to stderr as a fallback
- Consider adding a counter to warn after multiple failures

**Example Implementation:**
```typescript
try {
    fs.appendFileSync(LOG_FILE, logLine);
} catch (error) {
    console.error(`[WARN] Failed to write to log file: ${error}`);
}
```

---

### 2. Redundant Console.error in Logger

**Severity:** Low

**Location:** [`src/utils/logger.ts:41`](src/utils/logger.ts:41)

**Current Behavior:**
```typescript
export function log(level: LogLevel, message: string, data?: any) {
    if (level < currentLevel) return;
    
    const levelName = LogLevel[level];
    const logLine = formatMessage(levelName, message, data);
    
    // Using console.error for all levels is misleading
    console.error(`[${levelName}] ${message}`);
    // ...
}
```

Using `console.error` for all log levels (including INFO and DEBUG) is semantically incorrect.

**Suggested Action:**
- Use `console.log` for INFO and DEBUG levels
- Use `console.warn` for WARN level
- Use `console.error` for ERROR level

---

### 3. No Comprehensive Error Boundaries

**Severity:** Medium

**Location:** Multiple tool handlers in [`src/index.ts`](src/index.ts)

**Current Behavior:**
Most tool handlers catch errors and return a generic error message.

**Risk:** Users receive unhelpful error messages when things go wrong, making troubleshooting difficult.

**Suggested Action:**
- Create a custom error class hierarchy for different error types:
  - `AuthenticationError` - OAuth/login failures
  - `ProfilingError` - Profiling API failures
  - `StorageError` - File system issues
- Add error codes for programmatic error handling
- Provide actionable error messages with suggested fixes

**Example Implementation:**
```typescript
export class AuthenticationError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly suggestion?: string
    ) {
        super(message);
        this.name = 'AuthenticationError';
    }
}
```

---

## Code Quality

### 1. Magic Numbers in Thresholds

**Severity:** Low

**Location:** [`src/profiler/recommendations.ts:53-73`](src/profiler/recommendations.ts:53-73)

**Current Behavior:**
```typescript
const THRESHOLDS = {
    overallFast: 100,
    overallModerate: 250,
    overallSlow: 500,
    singleOpCritical: 10,
    // ...
};
```

Threshold values are magic numbers with no documentation.

**Risk:** Difficult to maintain and understand what each value represents.

**Suggested Action:**
- Document each threshold with JSDoc comments
- Consider making thresholds configurable via environment variables
- Group related thresholds into named objects

**Example Implementation:**
```typescript
/**
 * Performance thresholds for recommendations
 * 
 * Overall render time ratings (in ms):
 * - fast: < 100ms - Excellent performance
 * - moderate: 100-250ms - Acceptable performance
 * - slow: 250-500ms - Needs attention
 * - critical: > 500ms - Urgent optimization needed
 * 
 * Single operation thresholds (in ms):
 * - critical: > 10ms - Major performance issue
 * - warning: > 5ms - Minor performance issue
 */
const THRESHOLDS = {
    overallFast: 100,
    overallModerate: 250,
    overallSlow: 500,
    singleOpCritical: 10,
    // ...
};
```

---

### 2. Missing Input Validation

**Severity:** Medium

**Location:** Multiple locations (URL normalization referenced but not implemented)

**Current Behavior:**
The `normalizeStoreUrl` function is referenced in multiple places but may not handle all edge cases consistently.

**Risk:** Inconsistent URL handling could lead to authentication failures or incorrect store identification.

**Suggested Action:**
- Create a centralized URL validation/normalization utility
- Add comprehensive test cases for URL normalization
- Validate URLs at tool input boundaries

---

### 3. Console Logging Instead of Proper Logger

**Severity:** Low

**Location:** [`src/auth/session-manager.ts:57`](src/auth/session-manager.ts:57)

**Current Behavior:**
```typescript
console.error("Failed to load sessions:", error);
```

Direct `console.error` usage instead of the centralized logger.

**Suggested Action:**
- Replace all direct console usage with the centralized logger
- Ensure logger is initialized before other modules

---

## Missing Features

### 1. No Rate Limiting

**Severity:** Medium

**Location:** Profiler modules ([`src/profiler/page-profiler.ts`](src/profiler/page-profiler.ts))

**Current Behavior:**
The profiler makes API calls to Shopify without any rate limiting.

**Risk:**
- May trigger Shopify API rate limits
- Could cause throttling on slower stores
- Batch operations could overwhelm the system

**Suggested Action:**
- Implement a token bucket or sliding window rate limiter
- Add configurable rate limits via environment variables
- Add exponential backoff for retries

**Example Implementation:**
```typescript
import rateLimit from 'express-rate-limit';

const profileRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: { error: 'Too many profiling requests, please try again later' }
});
```

---

### 2. No Test Coverage

**Severity:** Medium

**Location:** Project root

**Current Behavior:**
The project has a `TESTING.md` file but no visible test files in the source directory.

**Risk:** Changes could break existing functionality without detection.

**Suggested Action:**
- Add unit tests for critical functions:
  - Token refresh logic
  - URL normalization
  - Anti-pattern detection
  - Profile history storage
- Add integration tests for OAuth flow (mocked)
- Use Vitest or Jest as the test framework

---

### 3. No Request/Response Logging Middleware

**Severity:** Low

**Location:** [`src/index.ts`](src/index.ts)

**Current Behavior:**
Tool calls are not logged in detail.

**Risk:** Difficult to debug issues when users report problems.

**Suggested Action:**
- Add logging for all tool invocations (input parameters, timing)
- Log API responses (with sensitive data redacted)
- Include correlation IDs for request tracking

---

### 4. No Health Check for External Dependencies

**Severity:** Low

**Location:** [`src/index.ts:48-88`](src/index.ts:48-88)

**Current Behavior:**
The `health_check` tool only verifies the server is running.

**Risk:** Users may not realize external services (Shopify API) are unavailable.

**Suggested Action:**
- Add optional checks for:
  - Shopify API connectivity
  - Token validity
  - Storage directory accessibility
- Make these checks optional to avoid slowing down startup

---

## Performance Considerations

### 1. File-Based State with Concurrent Access

**Severity:** Low

**Location:** Multiple storage modules

**Current Behavior:**
- `shopify-identity-oauth.ts` → `oauth-tokens.json`
- `session-manager.ts` → `sessions.json`
- `profile-history.ts` → `history/`

Each module loads and saves files independently.

**Risk:** Potential race conditions if multiple tool calls happen concurrently.

**Suggested Action:**
- Implement a file locking mechanism
- Use an in-memory cache with periodic persistence
- Consider using SQLite for atomic operations

---

### 2. Puppeteer Dependency for OAuth

**Severity:** Medium

**Location:** [`src/auth/shopify-oauth.ts`](src/auth/shopify-oauth.ts)

**Current Behavior:**
Puppeteer is used for the OAuth login flow, which is heavyweight.

**Risk:**
- Large dependency (100MB+)
- Slow startup time
- May not work in all environments (headless servers)

**Suggested Action:**
- Document Chrome/Chromium installation requirements clearly
- Provide an alternative manual token entry method for headless environments
- Consider using a lighter browser automation tool (Playwright, or native fetch with manual browser)

---

## Suggested Action Plan

### High Priority

1. **Add rate limiting** to prevent API throttling
   - Estimated effort: 2-4 hours
   - Impact: Prevents production issues

2. **Improve error handling** with custom error classes
   - Estimated effort: 4-6 hours
   - Impact: Better user experience

3. **Add test coverage** for critical paths
   - Estimated effort: 8-16 hours
   - Impact: Maintainability

### Medium Priority

4. **Encrypt tokens at rest**
   - Estimated effort: 4-8 hours
   - Impact: Security

5. **Environment variable configuration**
   - Estimated effort: 2-3 hours
   - Impact: Flexibility

6. **Add comprehensive logging middleware**
   - Estimated effort: 3-4 hours
   - Impact: Debugging

### Low Priority

7. **Refactor logger** to use correct console methods
   - Estimated effort: 1-2 hours
   - Impact: Code quality

8. **Add health checks** for external dependencies
   - Estimated effort: 2-3 hours
   - Impact: Observability

9. **Document magic numbers** in thresholds
   - Estimated effort: 1-2 hours
   - Impact: Maintainability

---

## Summary

The Shopify Theme Inspector MCP is a well-architected project with a solid foundation. The main areas for improvement center around:

1. **Security hardening** - Token encryption and secure configuration
2. **Error handling** - Better error messages and recovery
3. **Reliability** - Rate limiting and test coverage
4. **Maintainability** - Code quality improvements

Implementing the high-priority items will significantly improve the production readiness of the project.
