import puppeteer, { Browser, Page, HTTPResponse } from "puppeteer";
import {
  getSession,
  normalizeStoreUrl,
  isSessionValid,
  getStorefrontUrl,
  getPrimaryMyshopifySession,
} from "../auth/session-manager.js";
import { ProfileResult, ProfilingData, parseProfilingTree } from "./flamegraph-parser.js";
import { analyzeProfile } from "./profile-analyzer.js";

export interface ProfilePageOptions {
  storeUrl: string;
  pagePath: string;
  timeout?: number; // ms, default 30s
}

/**
 * Profile a Shopify store page by loading it with profiling enabled.
 * Uses Puppeteer with stored session cookies to access the profiling data.
 *
 * The Shopify Theme Inspector Chrome extension works by:
 * 1. Authenticating via Shopify admin/partner OAuth
 * 2. Loading the page with `?profile_liquid=true` query parameter
 * 3. The response contains a JSON blob with the Liquid profiling data
 */
export async function profilePage(
  options: ProfilePageOptions
): Promise<ProfileResult> {
  const { storeUrl, pagePath = "/", timeout = 30000 } = options;
  const normalizedUrl = normalizeStoreUrl(storeUrl);

  // Validate session
  const session = getSession(normalizedUrl);
  if (!session || !isSessionValid(session)) {
    return {
      success: false,
      storeUrl: normalizedUrl,
      pagePath,
      error: "Not authenticated. Use the login tool first.",
    };
  }

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();
  
  // Set User Agent to avoid Cloudflare/Bot detection on headless requests
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');


    // Set stored cookies for authentication
    const cookiesToSet = session.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));
    await page.setCookie(...cookiesToSet);

    // Build the profiling URL with ?profile_liquid=true
    // CRITICAL: We must use the .myshopify.com domain because that's where our
    // admin session cookies (koa.sid, _shopify_y, etc.) are valid.
    // If we use a custom domain (e.g., onebed.com.au), the browser won't send
    // the admin cookies, and Shopify won't return profiling data.
    const baseUrl = `https://${normalizedUrl}`;
    const cleanPath = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
    const url = new URL(cleanPath, baseUrl);
    url.searchParams.set("profile_liquid", "true");
    // Add preview_theme_id if you want to profile a specific theme, 
    // but for now we profile the live theme.

    const profileUrl = url.toString();
    console.error(`Profiling on admin domain: ${profileUrl}`);

    // Set up response capture to get headers and body
    // Navigate to the page
    const response = await page.goto(profileUrl, {
      waitUntil: "networkidle2",
      timeout,
    });

    // Try multiple extraction methods
    const profilingData = await extractProfilingData(page, response);

    if (!profilingData) {
      // Collect debug info to help diagnose
      const currentUrl = page.url();
      const pageTitle = await page.title();
      const statusCode = response?.status();
      
      let fallbackErrorDetails: string | undefined;

      // Fallback: Try to find a draft theme to profile if the live theme failed (likely due to redirect)
      console.error("No profiling data on primary URL. Attempting to profile a draft theme...");
      
      try {
          // Fetch themes.json from Admin API
          // We use the same page/session which should be authenticated
          // CRITICAL: Use session.storeUrl (myshopify.com) not normalizedUrl (which might be custom domain)
          let targetStoreUrl = session.storeUrl;
          if (!targetStoreUrl.includes('.myshopify.com')) {
              const primarySession = getPrimaryMyshopifySession();
              if (primarySession) {
                  targetStoreUrl = primarySession.storeUrl;
                  console.error(`Switched to primary myshopify session: ${targetStoreUrl}`);
                  
                  // CRITICAL: Inject cookies from the primary session (admin.shopify.com cookies)
                  // otherwise the request to admin/themes.json will fail (redirect to login)
                  // because the browser currently only has cookies for the custom domain.
                  if (primarySession.cookies && primarySession.cookies.length > 0) {
                      const cookiesToSet = primarySession.cookies.map((c) => ({
                        name: c.name,
                        value: c.value,
                        domain: c.domain,
                        path: c.path,
                        expires: c.expires,
                        httpOnly: c.httpOnly,
                        secure: c.secure,
                      }));
                      await page.setCookie(...cookiesToSet);
                  }
              } else {
                  console.error("Warning: Could not find a myshopify.com session. Admin API might fail.");
              }
          }

          const themesUrl = `https://${targetStoreUrl}/admin/themes.json`;
          const themesResponse = await page.goto(themesUrl, { waitUntil: 'domcontentloaded' });
          
          if (themesResponse && themesResponse.ok()) {
              // Extract handle from redirect URL (e.g., https://admin.shopify.com/store/onebedau/themes.json)
              // This is crucial if we started with a custom domain and couldn't find the myshopify session key,
              // but the request succeeded via redirects (due to valid cookies).
              const finalThemesUrl = themesResponse.url();
              let myshopifyDomain = targetStoreUrl;
              const match = finalThemesUrl.match(/store\/([^\/]+)\/themes/);
              if (match && match[1]) {
                  const handle = match[1];
                  myshopifyDomain = `${handle}.myshopify.com`;
                  console.error(`Extracted myshopify domain from redirect: ${myshopifyDomain}`);
              }

              const content = await page.evaluate(() => document.body.innerText);
              const data = JSON.parse(content);
              const themes = data.themes || [];
              
              // Find a draft theme (unpublished) or "Dawn" as a fallback
              const draftTheme = themes.find((t: any) => t.role === 'unpublished');
              
              if (draftTheme) {
                  console.error(`Found draft theme: ${draftTheme.name} (${draftTheme.id}). Retrying profiling...`);
                  
                  // Construct preview URL for the draft theme on myshopify.com
                  // Using the myshopify domain is likely required to ensure the profile_liquid flag works correctly
                  // and avoids custom domain caching/stripping issues.
                  const draftProfileUrl = `https://${myshopifyDomain}/?preview_theme_id=${draftTheme.id}&profile_liquid=true`;
                  
                  const retryResponse = await page.goto(draftProfileUrl, { waitUntil: 'networkidle2' });
                  
                  // Try extraction again
                  const retryData = await extractProfilingData(page, retryResponse);
                  
                  if (retryData) {
                       return {
                          success: true,
                          storeUrl: normalizedUrl,
                          pagePath: cleanPath,
                          profileUrl: draftProfileUrl,
                          data: retryData,
                          warning: `Profiled draft theme "${draftTheme.name}" because live theme profiling failed.`,
                       };
                  }
              }
          }
      } catch (fallbackError) {
          const errString = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          console.error("Draft theme fallback failed:", errString);
          fallbackErrorDetails = errString;
      }
      
      const debugInfo = `No profiling data found on live URL or fallback draft theme.\n` +
          (fallbackErrorDetails ? `Fallback error: ${fallbackErrorDetails}\n` : '') +
          `\nDebug info:\n` +
          `- Requested URL: ${profileUrl}\n` +
          `- Final URL: ${currentUrl}\n` +
          `- Page title: ${pageTitle}\n` +
          `- HTTP status: ${statusCode}\n\n` +
          `Possible causes:\n` +
          `- Session may have expired (try logging out and back in)\n` +
          `- Custom domain redirection might be blocking admin cookies\n` +
          `- The store may not support Liquid profiling`;

      return {
        success: false,
        storeUrl: normalizedUrl,
        pagePath: cleanPath,
        error: debugInfo
      };
    }

    return {
      success: true,
      storeUrl: normalizedUrl,
      pagePath: cleanPath,
      profileUrl,
      data: profilingData,
      summary: analyzeProfile(profilingData),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      success: false,
      storeUrl: normalizedUrl,
      pagePath,
      error: `Profiling failed: ${errorMessage}`,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Extract Liquid profiling data from the loaded page.
 *
 * When `?profile_liquid=true` is used with proper auth:
 * - The response body may be a JSON blob with profiling data
 * - Or the profiling data may be embedded in the page
 * - Or it may be in response headers (Server-Timing, X-Profiler, etc.)
 */
async function extractProfilingData(
  page: Page,
  response: HTTPResponse | null
): Promise<ProfilingData | null> {
  // Method 1: Try to parse the entire page body as JSON
  // When profile_liquid=true works, Shopify may return the profiling data
  // as the entire response body
  try {
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (bodyText.trim().startsWith("{") || bodyText.trim().startsWith("[")) {
      try {
        const jsonData = JSON.parse(bodyText.trim());
        if (isProfilingData(jsonData)) {
          console.error("Found profiling data in response body (JSON)");
          return normalizeProfilingData(jsonData);
        }
      } catch {
        // Not valid JSON
      }
    }
  } catch {
    // Page evaluation failed
  }

  // Method 2: Check page source for JSON (may be wrapped in HTML)
  try {
    const pageContent = await page.content();

    // Look for JSON between <pre> tags (common format)
    const preMatch = pageContent.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch?.[1]) {
      try {
        const jsonData = JSON.parse(preMatch[1].trim());
        if (isProfilingData(jsonData)) {
          console.error("Found profiling data in <pre> tag");
          return normalizeProfilingData(jsonData);
        }
      } catch {
        // Not valid JSON
      }
    }

    // Look for profiling JSON embedded anywhere in the page
    // Shopify profiling data typically has recognizable structures
    const profilingPatterns = [
      // Pattern: {"name":"liquid","...}
      /(\{"name"\s*:\s*"liquid"[\s\S]*?\})\s*$/m,
      // Pattern: typical profiling structure with "nodes" or "children"
      /(\{[\s\S]*?"(?:nodes|children|profiles?)"[\s\S]*?"(?:time|duration|total_time)"[\s\S]*?\})/,
      // Pattern: profiling data with "code" and "line_number"
      /(\{[\s\S]*?"code"[\s\S]*?"line_number"[\s\S]*?\})/,
    ];

    for (const pattern of profilingPatterns) {
      const match = pageContent.match(pattern);
      if (match?.[1]) {
        try {
          const jsonData = JSON.parse(match[1]);
          if (isProfilingData(jsonData)) {
            console.error("Found profiling data via pattern match");
            return normalizeProfilingData(jsonData);
          }
        } catch {
          // Not valid JSON
        }
      }
    }
  } catch {
    // Content retrieval failed
  }

  // Method 3: Check response headers
  if (response) {
    try {
      const headers = response.headers();
      
      // Check Server-Timing header
      const serverTiming = headers["server-timing"];
      if (serverTiming) {
        console.error("Found Server-Timing header:", serverTiming);
        return parseServerTimingHeader(serverTiming);
      }

      // Check for X-Profiler or similar headers
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase().includes("profil") || key.toLowerCase().includes("liquid")) {
          console.error(`Found profiling header ${key}:`, value);
          try {
            const jsonData = JSON.parse(value);
            return normalizeProfilingData(jsonData);
          } catch {
            // Not JSON
          }
        }
      }
    } catch {
      // Header extraction failed
    }
  }

  // Method 4: Look for profiling data in script tags or global variables
  try {
    const data = await page.evaluate(() => {
      // Check global variables
      const win = window as any;
      if (win.Shopify?.liquid?.profiler) return win.Shopify.liquid.profiler;
      if (win.__st_prof) return win.__st_prof;
      if (win.ShopifyAnalytics?.meta?.profiling) return win.ShopifyAnalytics.meta.profiling;

      // Look for profiling script tag
      const profilingScript = document.querySelector(
        'script[id="elements-data"], script[data-profiling], script[type="application/json"][data-liquid-profiling]'
      );
      if (profilingScript?.textContent) {
        try { return JSON.parse(profilingScript.textContent); } catch { /* skip */ }
      }

      // Search all script tags
      const scripts = document.querySelectorAll("script");
      for (const script of scripts) {
        const content = script.textContent || "";
        const match = content.match(
          /(?:profil(?:er?|ing)|liquid[_-]profil)/i
        );
        if (match && content.includes("{")) {
          // Try to extract JSON from the script
          const jsonMatch = content.match(/=\s*(\{[\s\S]*\})\s*;/);
          if (jsonMatch?.[1]) {
            try { return JSON.parse(jsonMatch[1]); } catch { /* skip */ }
          }
        }
      }

      // Check for performance bar
      const perfBar = document.querySelector(
        "#shopify-perf-bar, [data-perf-bar], .shopify-profiler"
      );
      if (perfBar) {
        const dataAttr = perfBar.getAttribute("data-profiling") 
          || perfBar.getAttribute("data-profile");
        if (dataAttr) {
          try { return JSON.parse(dataAttr); } catch { /* skip */ }
        }
      }

      return null;
    });

    if (data && isProfilingData(data)) {
      console.error("Found profiling data in page scripts/variables");
      return normalizeProfilingData(data);
    }
  } catch {
    // Page evaluation failed
  }

  // Method 5: Try fetching the page directly without rendering
  // (some profiling endpoints return raw JSON)
  if (response) {
    try {
      const responseBody = await response.text();
      if (responseBody.trim().startsWith("{") || responseBody.trim().startsWith("[")) {
        const jsonData = JSON.parse(responseBody.trim());
        if (isProfilingData(jsonData)) {
          console.error("Found profiling data in raw response body");
          return normalizeProfilingData(jsonData);
        }
      }
    } catch {
      // Response parsing failed
    }
  }

  return null;
}

/**
 * Check if a data object looks like Shopify Liquid profiling data
 */
function isProfilingData(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  
  // Check for known profiling data structures
  return (
    // Has nodes/children with timing data
    (data.nodes || data.children || data.profiles || data.profile) &&
    true
  ) || (
    // Has time/duration fields
    typeof data.time === "number" ||
    typeof data.duration === "number" ||
    typeof data.totalTime === "number" ||
    typeof data.total_time === "number"
  ) || (
    // Has code/line_number fields (individual node)
    data.code && (data.line_number !== undefined || data.line !== undefined)
  ) || (
    // Has name "liquid" (root profiling node)
    data.name === "liquid" || data.name === "layout"
  );
}

/**
 * Parse Server-Timing header into profiling data
 */
function parseServerTimingHeader(header: string): ProfilingData | null {
  try {
    // Server-Timing format: metric;dur=X;desc="Y", ...
    const entries = header.split(",").map((entry) => {
      const parts = entry.trim().split(";");
      const name = parts[0]?.trim();
      let duration = 0;
      let description = "";

      for (const part of parts.slice(1)) {
        const [key, val] = part.split("=");
        if (key?.trim() === "dur") duration = parseFloat(val || "0");
        if (key?.trim() === "desc") description = (val || "").replace(/"/g, "");
      }

      return { name, duration, description };
    });

    const liquidEntries = entries.filter(
      (e) => e.name?.toLowerCase().includes("liquid") || e.description?.toLowerCase().includes("liquid")
    );
    
    // If no specific liquid entries found, return all entries as basic profiling
    // This happens when detailed liquid profiling is not enabled or supported,
    // but the server still returns high-level stats (render, db, processing).
    const validEntries = liquidEntries.length > 0 ? liquidEntries : entries;

    if (validEntries.length > 0) {
      const totalTime = validEntries.reduce((sum, e) => sum + e.duration, 0);
      const isBasic = liquidEntries.length === 0;
      
      return {
        timestamp: new Date().toISOString(),
        totalTime,
        nodeCount: validEntries.length,
        raw: { serverTiming: entries, type: isBasic ? "basic" : "liquid" },
        tree: {
          name: isBasic ? "root" : "liquid",
          children: validEntries.map((e) => ({
            name: e.description || e.name,
            time: e.duration,
          })),
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize raw profiling data into our standard format
 */
function normalizeProfilingData(rawData: any): ProfilingData {
  // Handle different data structures from Shopify
  if (rawData.nodes || rawData.children) {
    return {
      timestamp: new Date().toISOString(),
      totalTime: rawData.totalTime || rawData.total_time || rawData.duration || rawData.time || 0,
      nodeCount: countNodes(rawData),
      raw: rawData,
      tree: parseProfilingTree(rawData),
    };
  }

  if (rawData.profiles || rawData.profile) {
    const profile = rawData.profiles?.[0] || rawData.profile;
    return {
      timestamp: new Date().toISOString(),
      totalTime: profile.totalTime || profile.total_time || profile.duration || profile.time || 0,
      nodeCount: countNodes(profile),
      raw: rawData,
      tree: parseProfilingTree(profile),
    };
  }

  // Fallback: treat entire object as raw data
  return {
    timestamp: new Date().toISOString(),
    totalTime: rawData.totalTime || rawData.total_time || rawData.duration || rawData.time || 0,
    nodeCount: typeof rawData === "object" ? Object.keys(rawData).length : 0,
    raw: rawData,
    tree: parseProfilingTree(rawData),
  };
}

/**
 * Count nodes recursively
 */
function countNodes(data: any): number {
  if (!data || typeof data !== "object") return 0;
  let count = 1;
  const children = data.children || data.nodes || [];
  if (Array.isArray(children)) {
    for (const child of children) count += countNodes(child);
  }
  return count;
}
