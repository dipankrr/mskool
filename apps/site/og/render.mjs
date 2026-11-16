// Renders og/og.html to public/og.png (1200 x 630) with a locally installed Edge or Chrome.
// Needs the internet for the web fonts. Usage: pnpm --filter @repo/site og
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../public/og.png");
const page = pathToFileURL(path.join(here, "og.html")).href;

const candidates = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) {
  console.error("No Edge or Chrome found. Set BROWSER to its path.");
  process.exit(1);
}

// A fresh profile each run, so an open or lingering browser cannot serve a cached page.
const profile = mkdtempSync(path.join(os.tmpdir(), "mskool-og-"));
try {
execFileSync(browser, [
  "--headless=new",
  `--user-data-dir=${profile}`,
  "--disable-gpu",
  "--hide-scrollbars",
  "--allow-file-access-from-files",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  "--virtual-time-budget=8000",
  `--screenshot=${out}`,
  page,
], { stdio: "inherit" });
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
console.log("wrote", path.relative(process.cwd(), out));
