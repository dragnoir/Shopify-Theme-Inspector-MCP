import puppeteer from "puppeteer";
import {
  getSession,
  getPrimaryMyshopifySession,
} from "./dist/auth/session-manager.js";
import fs from "fs";

async function debugDraft() {
  console.log("Starting Draft Theme Debug...");

  // 1. Load Session
  const custom = "onebed.com.au";
  const s2 = getSession(custom);
  if (!s2) {
    console.error("No session");
    return;
  }

  let targetUrl = s2.storeUrl;
  const primarySession = getPrimaryMyshopifySession();
  if (primarySession) {
    console.log(`Found primary session: ${primarySession.storeUrl}`);
    targetUrl = primarySession.storeUrl;
  } else {
    console.log(
      "No primary myshopify session found. Using custom domain session.",
    );
    // We assume cookies are good now
  }

  // 2. Launch Browser
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );

  // 3. Inject Cookies from s2
  if (s2.cookies && s2.cookies.length > 0) {
    const cookiesToSet = s2.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));
    await page.setCookie(...cookiesToSet);
  } else {
    console.log("No cookies in session s2!");
  }

  // 4. Fetch Themes
  const themesUrl = `https://${targetUrl}/admin/themes.json`;
  console.log(`Fetching themes from ${themesUrl}...`);
  const themesResponse = await page.goto(themesUrl, {
    waitUntil: "domcontentloaded",
  });

  if (!themesResponse.ok()) {
    console.error(`Themes request failed: ${themesResponse.status()}`);
    console.log(await themesResponse.text());
    await browser.close();
    return;
  }

  // Extract handle from redirect URL (e.g., https://admin.shopify.com/store/onebedau/themes.json)
  const finalThemesUrl = themesResponse.url();
  console.log(`Final themes URL: ${finalThemesUrl}`);

  let myshopifyDomain = targetUrl;
  const match = finalThemesUrl.match(/store\/([^\/]+)\/themes/);
  if (match && match[1]) {
    const handle = match[1];
    myshopifyDomain = `${handle}.myshopify.com`;
    console.log(`Extracted myshopify domain: ${myshopifyDomain}`);
  } else {
    console.log("Could not extract handle from URL. Using targetUrl.");
  }

  const themesData = await themesResponse.json();
  const themes = themesData.themes || [];
  const draftTheme = themes.find((t) => t.role === "unpublished");

  if (!draftTheme) {
    console.error("No draft theme found.");
    await browser.close();
    return;
  }

  console.log(`Found draft theme: ${draftTheme.name} (${draftTheme.id})`);

  // 5. Profile Draft Theme on parsed domain
  const draftProfileUrl = `https://${myshopifyDomain}/?preview_theme_id=${draftTheme.id}&profile_liquid=true`;
  console.log(`Navigating to ${draftProfileUrl}...`);

  const profileResponse = await page.goto(draftProfileUrl, {
    waitUntil: "domcontentloaded", // Use domcontentloaded to avoid timeout
  });

  console.log(`Profile Status: ${profileResponse.status()}`);
  console.log(`Final URL: ${page.url()}`);

  const headers = profileResponse.headers();
  // Log relevant headers
  console.log("Headers:", JSON.stringify(headers, null, 2));

  // Check for Server-Timing
  const serverTiming = headers["server-timing"];
  if (serverTiming) {
    console.log("Server-Timing found!");
  } else {
    console.log("Server-Timing MISSING.");
  }

  // Check Body
  const content = await page.content();
  if (content.includes("profilerResult")) {
    console.log("Found 'profilerResult' in body.");
  } else {
    console.log("'profilerResult' NOT found in body.");
  }

  await page.screenshot({ path: "debug_draft.png" });
  await browser.close();
}

debugDraft();
