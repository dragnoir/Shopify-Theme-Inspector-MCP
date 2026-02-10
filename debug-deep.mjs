import puppeteer from "puppeteer";
import {
  getSession,
  getPrimaryMyshopifySession,
  loadSessions,
} from "./dist/auth/session-manager.js";
import fs from "fs";

async function diagnose() {
  console.log("Starting DEEP diagnosis...");

  const allSessions = loadSessions();
  console.log("All Session Keys:", Object.keys(allSessions.sessions));

  // 1. Load Sessions
  const custom = "onebed.com.au";
  const s2 = getSession(custom);

  if (!s2) {
    console.error("No session for " + custom);
    return;
  }
  console.log(`Session found for ${custom}`);
  console.log("Cookie count:", s2.cookies.length);
  console.log("Cookie domains:", [...new Set(s2.cookies.map((c) => c.domain))]);
  console.log("Cookie names:", s2.cookies.map((c) => c.name).join(", "));

  let primarySession = null;
  if (!s2.storeUrl.includes("myshopify.com")) {
    console.log(
      `Store URL is custom: ${s2.storeUrl}. Looking for myshopify session...`,
    );
    primarySession = getPrimaryMyshopifySession();
    if (primarySession) {
      console.log(
        `Found primary myshopify session: ${primarySession.storeUrl}`,
      );
    } else {
      console.error("Could not find primary myshopify session!");
      return;
    }
  } else {
    primarySession = s2;
  }

  // 2. Launch Browser
  const browser = await puppeteer.launch({ headless: true }); // Headless true to match production tool
  const page = await browser.newPage();

  // Set User Agent (same as in page-profiler.ts)
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );

  // 3. Set Cookies
  if (primarySession.cookies && primarySession.cookies.length > 0) {
    console.log(
      `Injecting ${primarySession.cookies.length} cookies from ${primarySession.storeUrl}...`,
    );
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
  } else {
    console.error("No cookies to set!");
  }

  // 4. Navigate to Admin API
  const themesUrl = `https://${primarySession.storeUrl}/admin/themes.json`;
  console.log(`Navigating to ${themesUrl}...`);

  const response = await page.goto(themesUrl, {
    waitUntil: "domcontentloaded",
  });

  console.log(`Response Status: ${response.status()}`);
  console.log(`Final URL: ${page.url()}`);

  const content = await page.content();
  const bodyText = await page.evaluate(() => document.body.innerText);

  console.log(
    "Body Text Snippet:",
    bodyText.substring(0, 100).replace(/\n/g, "\\n"),
  );

  // 5. Screenshot
  await page.screenshot({ path: "debug_failure.png" });
  console.log("Saved screenshot to debug_failure.png");

  fs.writeFileSync("debug_failure.html", content);
  console.log("Saved HTML to debug_failure.html");

  // Check Cookies after navigation
  const currentCookies = await page.cookies();
  console.log(
    "Cookies after navigation:",
    currentCookies.map((c) => c.name).join(", "),
  );

  await browser.close();
  console.log("Done.");
}

diagnose();
