import puppeteer from "puppeteer";
import { getSession } from "./dist/auth/session-manager.js";

async function main() {
  const session = getSession("onebedau.myshopify.com");

  if (!session) {
    console.error("No session found for onebedau.myshopify.com");
    return;
  }

  console.log("Session found, using cookies...");

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

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

  const jsonUrl = "https://onebedau.myshopify.com/admin/themes.json";
  console.log(`Fetching themes from ${jsonUrl}...`);

  const response = await page.goto(jsonUrl, { waitUntil: "domcontentloaded" });

  if (response.status() === 200) {
    const content = await page.evaluate(() => document.body.innerText);

    try {
      const data = JSON.parse(content);
      const themes = data.themes || [];

      let targetTheme = themes.find(
        (t) => t.name === "Dawn" || t.role === "unpublished",
      );
      if (!targetTheme) targetTheme = themes.find((t) => t.role === "main");

      if (targetTheme) {
        console.log(
          `FOUND THEME (${targetTheme.role}):`,
          targetTheme.name,
          targetTheme.id,
        );

        const profilingUrl = `https://onebedau.myshopify.com/?preview_theme_id=${targetTheme.id}&profile_liquid=true`;
        console.log(`Testing profiling with: ${profilingUrl}`);

        // Use loose wait to avoid hanging on long polls
        await page.goto(profilingUrl, { waitUntil: "domcontentloaded" });

        // Helper to wait for profiling data
        console.log("Waiting for data to appear...");
        for (let i = 0; i < 10; i++) {
          const bodyText = await page.evaluate(() => document.body.innerText);
          if (bodyText.includes("liquid") && bodyText.includes("count")) {
            console.log("SUCCESS! Found profiling data!");
            console.log(bodyText.substring(0, 300));
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (!bodyText.includes("liquid") || !bodyText.includes("count")) {
          console.log(
            "Still no data after wait. Body start:",
            bodyText.substring(0, 100),
          );
        }
      } else {
        console.error("No theme found in JSON");
      }
    } catch (e) {
      console.error("Failed to parse JSON:", e);
    }
  } else {
    console.error("Failed to access Admin API. Redirected?");
  }

  await browser.close();
}

main();
