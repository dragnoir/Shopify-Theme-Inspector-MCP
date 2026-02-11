/**
 * Shopify Identity OAuth2 Authentication
 * 
 * This module implements the SAME OAuth2 flow used by the official Shopify Theme
 * Inspector Chrome extension to obtain a storefront-renderer devtools token.
 * 
 * The Chrome extension uses:
 *   1. OAuth2 PKCE flow with accounts.shopify.com
 *   2. Client ID: ff2a91a2-6854-449e-a37d-c03bcd181126
 *   3. Scope: "openid profile https://api.shopify.com/auth/shop.storefront-renderer.devtools"
 *   4. Token exchange to get a subject token for storefront-renderer
 *      (subject ID: ee139b3d-5861-4d45-b387-1bc3ada7811c)
 *   5. The subject token is then used to fetch profiling data with:
 *      - Accept: application/vnd.speedscope+json
 *      - Authorization: Bearer <subject_token>
 * 
 * This implementation replicates that flow using Puppeteer for the interactive
 * login step, plus standard OAuth2 token endpoints for token exchange.
 */

import puppeteer, { Browser, Page } from "puppeteer";
import crypto from "crypto";
import { logger } from "../utils/logger.js";

// ============================================================================
// Shopify Identity OAuth2 Configuration
// Mirrors env.ts from the Chrome extension
// ============================================================================

const OAUTH2_DOMAIN = "accounts.shopify.com";
const OAUTH2_CLIENT_ID = "ff2a91a2-6854-449e-a37d-c03bcd181126";
const STOREFRONT_RENDERER_SUBJECT_ID = "ee139b3d-5861-4d45-b387-1bc3ada7811c";
const DEVTOOLS_SCOPE = "https://api.shopify.com/auth/shop.storefront-renderer.devtools";
const COLLABORATORS_SCOPE = "https://api.shopify.com/auth/partners.collaborator-relationships.readonly";
const OPENID_CONFIG_PATH = ".well-known/openid-configuration.json";

// How long to wait for user to complete login (5 minutes)
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

interface OpenIdConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  introspection_endpoint: string;
  [key: string]: any;
}

interface ClientAccessToken {
  accessToken: string;
  accessTokenDate: number;
  expiresIn: number; // ms
  scope: string;
  tokenType: string;
  refreshToken?: string;
  idToken?: string;
}

interface SubjectAccessToken {
  accessToken: string;
  accessTokenDate: number;
  expiresIn: number; // ms
  scope: string;
  tokenType: string;
}

export interface OAuthTokens {
  clientToken: ClientAccessToken;
  subjectToken: SubjectAccessToken;
  storeUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface OAuthLoginResult {
  success: boolean;
  storeUrl: string;
  message: string;
  tokens?: OAuthTokens;
}

// ============================================================================
// Token Storage (in-memory + file-based)
// ============================================================================

import fs from "fs";
import path from "path";
import os from "os";

const TOKEN_DIR = path.join(os.homedir(), ".shopify-theme-inspector");
const TOKEN_FILE = path.join(TOKEN_DIR, "oauth-tokens.json");

function ensureTokenDir(): void {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

interface TokenStore {
  tokens: Record<string, OAuthTokens>;
  lastUpdated: string;
}

function loadTokenStore(): TokenStore {
  ensureTokenDir();
  if (!fs.existsSync(TOKEN_FILE)) {
    return { tokens: {}, lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return { tokens: {}, lastUpdated: new Date().toISOString() };
  }
}

function saveTokenStore(store: TokenStore): void {
  ensureTokenDir();
  store.lastUpdated = new Date().toISOString();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

export function getOAuthTokens(storeUrl: string): OAuthTokens | null {
  const store = loadTokenStore();
  const key = normalizeForKey(storeUrl);
  const tokens = store.tokens[key];
  if (!tokens) return null;
  // Check expiry
  if (new Date(tokens.expiresAt) < new Date()) return null;
  // Check if subject token is still valid
  if (isTokenExpired(tokens.subjectToken)) return null;
  return tokens;
}

export function saveOAuthTokens(tokens: OAuthTokens): void {
  const store = loadTokenStore();
  const key = normalizeForKey(tokens.storeUrl);
  store.tokens[key] = tokens;
  saveTokenStore(store);
}

export function deleteOAuthTokens(storeUrl: string): boolean {
  const store = loadTokenStore();
  const key = normalizeForKey(storeUrl);
  if (store.tokens[key]) {
    delete store.tokens[key];
    saveTokenStore(store);
    return true;
  }
  return false;
}

export function getOAuthenticatedStores(): string[] {
  const store = loadTokenStore();
  return Object.keys(store.tokens);
}

function normalizeForKey(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
}

function isTokenExpired(token: ClientAccessToken | SubjectAccessToken): boolean {
  const safetyBuffer = 60000; // 1 minute buffer
  return Date.now() >= token.accessTokenDate + token.expiresIn - safetyBuffer;
}

// ============================================================================
// PKCE Helpers
// ============================================================================

function generateCodeVerifier(): string {
  const buffer = crypto.randomBytes(32);
  return base64URLEncode(buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64URLEncode(hash);
}

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/[=]/g, "");
}

// ============================================================================
// OpenID Configuration
// ============================================================================

let cachedConfig: OpenIdConfig | null = null;

async function getOpenIdConfig(): Promise<OpenIdConfig> {
  if (cachedConfig) return cachedConfig;
  
  const url = `https://${OAUTH2_DOMAIN}/${OPENID_CONFIG_PATH}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch OpenID config: ${response.statusText}`);
  cachedConfig = await response.json() as OpenIdConfig;
  return cachedConfig;
}

// ============================================================================
// OAuth2 Login Flow
// ============================================================================

/**
 * The Chrome extension's registered redirect URI.
 * 
 * The Chrome extension uses chrome.identity.getRedirectURL('auth0') which
 * generates: https://<extension-id>.chromiumapp.org/auth0
 * 
 * The official Shopify Theme Inspector extension ID (from Chrome Web Store) is:
 * fndnankcflemoafdeboboehphmiijkgp
 * 
 * So the redirect URI registered with the OAuth client is:
 * https://fndnankcflemoafdeboboehphmiijkgp.chromiumapp.org/auth0
 * 
 * We use this same redirect URI and intercept the redirect in Puppeteer
 * to capture the authorization code.
 */
const CHROME_EXTENSION_REDIRECT_URI = 
  "https://fndnankcflemoafdeboboehphmiijkgp.chromiumapp.org/auth0";

/**
 * Perform the full OAuth2 PKCE flow to obtain storefront-renderer devtools tokens.
 * 
 * Flow:
 * 1. Open browser → Shopify Identity login page (with PKCE params)
 * 2. User logs in manually
 * 3. Intercept the redirect to the Chrome extension URL in Puppeteer
 * 4. Extract authorization code from the redirect URL
 * 5. Exchange code for client access token
 * 6. Exchange client token for subject access token (storefront-renderer)
 * 7. Return the subject token for use in profiling requests
 */
export async function loginWithOAuth(storeUrl: string): Promise<OAuthLoginResult> {
  const normalizedUrl = normalizeForKey(storeUrl);
  
  // Check if we already have valid tokens
  const existing = getOAuthTokens(normalizedUrl);
  if (existing && !isTokenExpired(existing.subjectToken)) {
    return {
      success: true,
      storeUrl: normalizedUrl,
      message: `Already authenticated. Token valid until ${existing.expiresAt}`,
      tokens: existing,
    };
  }

  // Try to refresh using existing client token
  if (existing && existing.clientToken.refreshToken) {
    try {
      logger.info("Attempting token refresh...");
      const refreshed = await refreshAndExchange(existing.clientToken.refreshToken);
      const tokens: OAuthTokens = {
        ...refreshed,
        storeUrl: normalizedUrl,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + refreshed.subjectToken.expiresIn).toISOString(),
      };
      saveOAuthTokens(tokens);
      return {
        success: true,
        storeUrl: normalizedUrl,
        message: "Token refreshed successfully.",
        tokens,
      };
    } catch (e) {
      logger.warn(`Token refresh failed, falling back to full login: ${e}`);
    }
  }

  let browser: Browser | null = null;

  try {
    const config = await getOpenIdConfig();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Build authorization URL using the Chrome extension's redirect URI
    const scope = `openid profile ${DEVTOOLS_SCOPE} ${COLLABORATORS_SCOPE}`;
    const redirectUri = CHROME_EXTENSION_REDIRECT_URI;

    const authUrl = new URL(config.authorization_endpoint);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("client_id", OAUTH2_CLIENT_ID);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);

    logger.info(`Starting OAuth2 PKCE flow...`);
    logger.info(`Redirect URI: ${redirectUri}`);

    // Launch Puppeteer and intercept the redirect
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ["--start-maximized"],
    });

    const page = await browser.newPage();

    // Set up request interception to capture the redirect to the Chrome extension URL
    const code = await captureOAuthRedirect(page, authUrl.toString(), redirectUri, LOGIN_TIMEOUT_MS);

    logger.info("Authorization code captured! Closing browser...");
    await browser.close().catch(() => {});
    browser = null;

    // Exchange authorization code for client token
    logger.info("Exchanging authorization code for client token...");
    const clientToken = await exchangeCodeForToken(config, code, codeVerifier, redirectUri);
    logger.info("Got client token. Exchanging for subject token...");

    // Exchange client token for subject token (storefront-renderer)
    const subjectToken = await exchangeForSubjectToken(config, clientToken.accessToken);
    logger.info("Got subject token! Authentication complete.");

    const tokens: OAuthTokens = {
      clientToken,
      subjectToken,
      storeUrl: normalizedUrl,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + subjectToken.expiresIn).toISOString(),
    };

    saveOAuthTokens(tokens);

    return {
      success: true,
      storeUrl: normalizedUrl,
      message: `Successfully authenticated via OAuth2. Subject token for storefront-renderer obtained.`,
      tokens,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      storeUrl: normalizedUrl,
      message: `OAuth login failed: ${errorMessage}`,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ============================================================================
// Puppeteer-based OAuth Redirect Capture
// ============================================================================

/**
 * Navigate to the OAuth authorization URL and wait for the redirect to the
 * Chrome extension URL. Since the redirect URL is a chrome-extension:// URL
 * that won't load in a regular browser, we intercept the navigation request
 * and extract the authorization code from the URL.
 */
async function captureOAuthRedirect(
  page: Page,
  authUrl: string,
  redirectUri: string,
  timeoutMs: number
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let resolved = false;

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Login timed out. Please try again and complete login within 5 minutes."));
      }
    }, timeoutMs);

    // Method 1: Intercept requests to the redirect URI
    await page.setRequestInterception(true);
    
    page.on("request", (request) => {
      const url = request.url();
      
      if (url.startsWith(redirectUri)) {
        // This is the OAuth callback redirect - extract the code!
        logger.info("Intercepted OAuth redirect!");
        
        try {
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get("code");
          const error = urlObj.searchParams.get("error");

          if (error) {
            const errorDescription = urlObj.searchParams.get("error_description") || error;
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutHandle);
              reject(new Error(`OAuth error: ${errorDescription}`));
            }
          } else if (code) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutHandle);
              resolve(code);
            }
          } else {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutHandle);
              reject(new Error("No authorization code in redirect URL"));
            }
          }
        } catch (e) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            reject(new Error(`Failed to parse redirect URL: ${e}`));
          }
        }
        
        // Abort the request (don't actually navigate to the chrome extension URL)
        request.abort().catch(() => {});
        return;
      }

      // Allow all other requests to continue
      request.continue().catch(() => {});
    });

    // Navigate to the auth URL
    try {
      logger.info("Opening Shopify Identity login page...");
      await page.goto(authUrl, { waitUntil: "networkidle2", timeout: timeoutMs });
      logger.info("Login page loaded. Waiting for user to complete login...");
    } catch (e) {
      // Navigation might fail if the redirect happens too fast (which is actually success)
      if (!resolved) {
        logger.info(`Navigation ended (may be due to redirect intercept): ${e}`);
      }
    }
  });
}

// ============================================================================
// Token Exchange
// ============================================================================

/**
 * Exchange an authorization code for a client access token
 */
async function exchangeCodeForToken(
  config: OpenIdConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<ClientAccessToken> {
  const tokenUrl = new URL(config.token_endpoint);
  tokenUrl.search = new URLSearchParams([
    ["redirect_uri", redirectUri],
    ["grant_type", "authorization_code"],
    ["code_verifier", codeVerifier],
    ["client_id", OAUTH2_CLIENT_ID],
    ["code", code],
  ]).toString();

  const response = await fetch(tokenUrl.href, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const body = await response.json() as any;
  const responseDateHeader = response.headers.get("Date");
  const accessTokenDate = responseDateHeader
    ? new Date(responseDateHeader).valueOf()
    : Date.now();

  return {
    accessToken: body.access_token,
    accessTokenDate,
    expiresIn: body.expires_in * 1000, // Convert to ms
    scope: body.scope,
    tokenType: body.token_type,
    refreshToken: body.refresh_token,
    idToken: body.id_token,
  };
}

/**
 * Exchange a client token for a subject access token (storefront-renderer)
 */
async function exchangeForSubjectToken(
  config: OpenIdConfig,
  clientAccessToken: string
): Promise<SubjectAccessToken> {
  const tokenUrl = new URL(config.token_endpoint);
  
  const scope = `${DEVTOOLS_SCOPE} ${COLLABORATORS_SCOPE}`;
  
  tokenUrl.search = new URLSearchParams([
    ["grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"],
    ["client_id", OAUTH2_CLIENT_ID],
    ["audience", STOREFRONT_RENDERER_SUBJECT_ID],
    ["subject_token", clientAccessToken],
    ["subject_token_type", "urn:ietf:params:oauth:token-type:access_token"],
    ["destination", ""],
    ["scope", scope],
  ]).toString();

  const response = await fetch(tokenUrl.href, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Subject token exchange failed: ${response.status} ${text}`);
  }

  const body = await response.json() as any;
  const responseDateHeader = response.headers.get("Date");
  const accessTokenDate = responseDateHeader
    ? new Date(responseDateHeader).valueOf()
    : Date.now();

  return {
    accessToken: body.access_token,
    accessTokenDate,
    expiresIn: body.expires_in * 1000,
    scope: body.scope,
    tokenType: body.token_type,
  };
}

/**
 * Refresh client token and exchange for new subject token
 */
async function refreshAndExchange(
  refreshToken: string
): Promise<{ clientToken: ClientAccessToken; subjectToken: SubjectAccessToken }> {
  const config = await getOpenIdConfig();
  
  const tokenUrl = new URL(config.token_endpoint);
  tokenUrl.search = new URLSearchParams([
    ["grant_type", "refresh_token"],
    ["refresh_token", refreshToken],
    ["client_id", OAUTH2_CLIENT_ID],
  ]).toString();

  const response = await fetch(tokenUrl.href, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const body = await response.json() as any;
  const responseDateHeader = response.headers.get("Date");
  const accessTokenDate = responseDateHeader
    ? new Date(responseDateHeader).valueOf()
    : Date.now();

  const clientToken: ClientAccessToken = {
    accessToken: body.access_token,
    accessTokenDate,
    expiresIn: body.expires_in * 1000,
    scope: body.scope,
    tokenType: body.token_type,
    refreshToken: body.refresh_token,
    idToken: body.id_token,
  };

  const subjectToken = await exchangeForSubjectToken(config, clientToken.accessToken);

  return { clientToken, subjectToken };
}

// ============================================================================
// Public API: Get a valid subject access token for profiling requests
// ============================================================================

/**
 * Get a valid Bearer token for profiling requests.
 * This is the token used with:
 *   - Accept: application/vnd.speedscope+json
 *   - Authorization: Bearer <token>
 * 
 * Returns null if not authenticated or token expired.
 * Will try to auto-refresh if possible.
 */
export async function getProfilingAccessToken(storeUrl: string): Promise<string | null> {
  const key = normalizeForKey(storeUrl);
  let tokens = getOAuthTokens(key);

  if (!tokens) return null;

  // If subject token is expired but client token has a refresh token, try refresh
  if (isTokenExpired(tokens.subjectToken)) {
    if (tokens.clientToken.refreshToken) {
      try {
        logger.info("Subject token expired, attempting refresh...");
        const refreshed = await refreshAndExchange(tokens.clientToken.refreshToken);
        tokens = {
          ...refreshed,
          storeUrl: key,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + refreshed.subjectToken.expiresIn).toISOString(),
        };
        saveOAuthTokens(tokens);
        logger.info("Token refreshed successfully.");
      } catch (e) {
        logger.error(`Token refresh failed: ${e}`);
        return null;
      }
    } else {
      return null;
    }
  }

  return tokens.subjectToken.accessToken;
}
