import puppeteer, { Browser, Page } from "puppeteer";
import {
  ShopifySession,
  saveSession,
  getSession,
  normalizeStoreUrl,
  isSessionValid,
  getAdminUrl,
} from "./session-manager.js";

// How long to wait for user to complete login (5 minutes)
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// Session validity period (7 days)
const SESSION_VALIDITY_DAYS = 7;

export interface LoginResult {
  success: boolean;
  storeUrl: string;
  message: string;
  session?: ShopifySession;
}

export interface AuthStatusResult {
  authenticated: boolean;
  storeUrl: string;
  storeName?: string;
  expiresAt?: string;
  message: string;
}

/**
 * Open browser for user to login to Shopify
 * Returns the session after successful login
 */
export async function loginToShopify(storeUrl: string): Promise<LoginResult> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  
  // Check if we already have a valid session
  const existingSession = getSession(normalizedUrl);
  if (existingSession && isSessionValid(existingSession)) {
    return {
      success: true,
      storeUrl: normalizedUrl,
      message: `Already authenticated to ${normalizedUrl}. Session valid until ${existingSession.expiresAt}`,
      session: existingSession,
    };
  }

  let browser: Browser | null = null;

  try {
    // Launch browser in non-headless mode so user can see and interact
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null, // Use full window size
      args: ["--start-maximized"],
    });

    const page = await browser.newPage();
    
    // Navigate to the Shopify admin login
    const adminUrl = getAdminUrl(normalizedUrl);
    console.error(`Opening browser for Shopify login: ${adminUrl}`);
    
    await page.goto(adminUrl, { waitUntil: "networkidle2" });

    // Wait for login to complete by checking for successful navigation to admin
    // User needs to complete login manually
    console.error("Waiting for user to complete login...");
    
    const loginComplete = await waitForLogin(page, normalizedUrl, LOGIN_TIMEOUT_MS);
    
    if (!loginComplete) {
      return {
        success: false,
        storeUrl: normalizedUrl,
        message: "Login timed out. Please try again and complete the login within 5 minutes.",
      };
    }

    // Extract cookies after successful login
    const cookies = await page.cookies();
    
    // Create session object
    const session: ShopifySession = {
      storeUrl: normalizedUrl,
      storeName: await extractStoreName(page),
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
      })),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + SESSION_VALIDITY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
    };

    // Save the session
    saveSession(session);

    return {
      success: true,
      storeUrl: normalizedUrl,
      message: `Successfully authenticated to ${normalizedUrl}`,
      session,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      storeUrl: normalizedUrl,
      message: `Login failed: ${errorMessage}`,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Wait for the user to complete login
 * Detects successful login by checking URL patterns
 */
async function waitForLogin(
  page: Page,
  storeUrl: string,
  timeoutMs: number
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const currentUrl = page.url();
      
      // Check if we're on the admin dashboard or a logged-in page
      if (
        currentUrl.includes("/admin") &&
        !currentUrl.includes("/login") &&
        !currentUrl.includes("/auth") &&
        !currentUrl.includes("accounts.shopify.com")
      ) {
        // Additional check: look for elements that indicate logged-in state
        const isLoggedIn = await page.evaluate(() => {
          // Check for common admin elements that appear when logged in
          const adminNav = document.querySelector('[data-polaris-layer]');
          const homeLink = document.querySelector('a[href*="/admin"]');
          return !!(adminNav || homeLink);
        });

        if (isLoggedIn) {
          console.error("Login detected successfully!");
          return true;
        }
      }
      
      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      // Page might be navigating, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  
  return false;
}

/**
 * Extract store name from the logged-in page
 */
async function extractStoreName(page: Page): Promise<string> {
  try {
    const storeName = await page.evaluate(() => {
      // Try to find store name in various places
      const titleElement = document.querySelector('title');
      if (titleElement) {
        const title = titleElement.textContent || "";
        // Remove common suffixes
        return title.replace(/\s*[-·|]\s*Shopify.*$/i, "").trim();
      }
      return "";
    });
    
    return storeName || "Unknown Store";
  } catch {
    return "Unknown Store";
  }
}

/**
 * Check authentication status for a store
 */
export function checkAuthStatus(storeUrl: string): AuthStatusResult {
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  const session = getSession(normalizedUrl);
  
  if (!session) {
    return {
      authenticated: false,
      storeUrl: normalizedUrl,
      message: `Not authenticated to ${normalizedUrl}. Use the login tool to authenticate.`,
    };
  }
  
  if (!isSessionValid(session)) {
    return {
      authenticated: false,
      storeUrl: normalizedUrl,
      message: `Session expired for ${normalizedUrl}. Use the login tool to re-authenticate.`,
    };
  }
  
  return {
    authenticated: true,
    storeUrl: normalizedUrl,
    storeName: session.storeName,
    expiresAt: session.expiresAt,
    message: `Authenticated to ${normalizedUrl} (${session.storeName}). Session valid until ${session.expiresAt}`,
  };
}

/**
 * Get cookies for a store to use in requests
 */
export function getStoreCookies(storeUrl: string): string | null {
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  const session = getSession(normalizedUrl);
  
  if (!session || !isSessionValid(session)) {
    return null;
  }
  
  // Format cookies for use in HTTP headers
  return session.cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
