
import puppeteer from "puppeteer";
import { getSession } from "./src/auth/session-manager";

async function main() {
  const storeUrl = "onebed.com.au";
  const session = getSession("onebedau.myshopify.com"); // Use normalized URL

  if (!session) {
    console.error("No session found");
    return;
  }

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Set cookies
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

  // Go to Admin Themes page
  const adminUrl = "https://onebedau.myshopify.com/admin/themes";
  console.log(`Navigating to ${adminUrl}...`);
  await page.goto(adminUrl, { waitUntil: "networkidle2" });

  // Look for "Preview" link or live theme ID
  // Verify we are logged in
  if (page.url().includes("login")) {
    console.error("Redirected to login - session invalid?");
  } else {
    console.log("Logged in to Admin!");
    
    // Try to find the "Preview" button/link for the Live/Current theme
    // Selector might need adjustment based on Shopify Admin DOM
    const previewLink = await page.evaluate(() => {
        // Look for links that contain 'preview'
        const links = Array.from(document.querySelectorAll('a'));
        const previewLinks = links.filter(a => a.innerText.toLowerCase().includes('preview') || a.href.includes('preview_theme_id'));
        return previewLinks.map(a => a.href);
    });

    console.log("Found preview links:", previewLink);
    
    // Try to find current theme ID
    const themeId = await page.evaluate(() => {
        // Shopify often puts current theme ID in global var or url
        return (window as any).Shopify?.Theme?.id || "not found";
    });
    console.log("Global Theme ID:", themeId);
  }

  // Keep browser open for a bit
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

main();
