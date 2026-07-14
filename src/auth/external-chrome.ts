import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

/**
 * Open a URL in the user's existing Chrome process. Unlike Puppeteer launch,
 * this does not claim or lock a Chrome profile. Chrome routes the URL to the
 * active signed-in profile when it is already running.
 */
export function openInExistingChrome(url: string): void {
  const executablePath = process.env.SHOPIFY_CHROME_EXECUTABLE || findChromeExecutable();
  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `Google Chrome was not found at ${executablePath}. Set SHOPIFY_CHROME_EXECUTABLE to chrome.exe.`,
    );
  }

  const child = spawn(executablePath, [url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function findChromeExecutable(): string {
  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}
