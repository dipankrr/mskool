#!/usr/bin/env node
/**
 * Mobile attendance E2E on the Android emulator (Maestro).
 *
 *   pnpm e2e:android
 *
 * What it does, in order:
 *   1. checks the API (:4000) and Metro (:8081) are already running;
 *   2. wipes the demo org and reseeds the deterministic fixture;
 *   3. pins the emulator clock to Fri 6 Mar 2026 11:00 IST (inside AY 2025-26);
 *   4. clears the app, reconnects the Expo dev client, dismisses its first-run
 *      sheet, and waits for the login screen;
 *   5. runs the three golden flows in order;
 *   6. asserts the writes in Postgres (`@repo/db verify:e2e`);
 *   7. restores the clock and animations, on success or failure.
 *
 * This is destructive for the demo org by design (same contract as
 * `pnpm reset:demo`). It refuses production via the reset script's own guard.
 *
 * Requires: an API 34 emulator with the dev client installed, Maestro 2.11+
 * on PATH (or in %USERPROFILE%\maestro\bin), Java 21, adb root. See README.md.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const flowDir = path.join(here, "flows");
const flowFiles = [
  "01-mark.yaml",
  "02-subject-teacher.yaml",
  "03-manage.yaml",
].map((name) => path.join(flowDir, name));

const device = process.env.E2E_DEVICE ?? "emulator-5554";
const metroHost = process.env.E2E_METRO_HOST ?? "10.0.2.2";
const appId = "com.mskool.app";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifacts = path.join(repoRoot, "apps/mobile/.expo/e2e", stamp);

const animationKeys = [
  "window_animation_scale",
  "transition_animation_scale",
  "animator_duration_scale",
];
const savedAnimations = new Map();

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function adb(args, { inherit = false } = {}) {
  return execFileSync("adb", ["-s", device, ...args], {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

function assertPort(port, hint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`nothing is listening on :${port}. ${hint}`));
    }, 3000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`nothing is listening on :${port} (${error.code}). ${hint}`));
    });
  });
}

function dumpUi() {
  adb(["shell", "uiautomator", "dump", "/sdcard/e2e-ui.xml"]);
  return adb(["exec-out", "cat", "/sdcard/e2e-ui.xml"]);
}

/** Waits for a stable login screen, dismissing the dev-client first-run sheet
 *  or the DevTools menu if either appears late in the launch. */
function waitForLogin(timeoutMs) {
  const started = Date.now();
  let lastXml = "";
  let loginSince = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      const xml = dumpUi();
      lastXml = xml;
      if (xml.includes("This is the developer menu")) {
        loginSince = 0;
        const match = xml.match(
          /text="Continue"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
        );
        if (match) {
          const x = Math.round((Number(match[1]) + Number(match[3])) / 2);
          const y = Math.round((Number(match[2]) + Number(match[4])) / 2);
          console.log(`  dismissing the dev-client first-run sheet at ${x},${y}`);
          adb(["shell", "input", "tap", String(x), String(y)]);
        }
      } else if (
        xml.includes("Runtime version: exposdk") ||
        xml.includes('text="TOOLS"')
      ) {
        // Continue advances the onboarding into the full DevTools menu; back
        // closes that menu and reveals the app underneath.
        loginSince = 0;
        console.log("  closing the DevTools menu");
        adb(["shell", "input", "keyevent", "4"]);
      } else if (xml.includes('resource-id="login-email"')) {
        // The dev sheet can appear a beat after the login screen draws; only
        // hand off after the login has survived a few seconds.
        if (loginSince === 0) loginSince = Date.now();
        if (Date.now() - loginSince >= 4000) return;
      } else {
        loginSince = 0;
      }
      if (
        xml.includes("Could not connect to development server") ||
        xml.includes("Unable to load script")
      ) {
        throw new Error(
          `the dev client could not load the bundle from http://${metroHost}:8081. ` +
            "Check Metro and that the emulator can reach the host.",
        );
      }
    } catch (error) {
      if (error.message.includes("dev client")) throw error;
      // uiautomator can fail while the window animates; retry.
    }
    sleep(2000);
  }
  writeFileSync(path.join(artifacts, "ui-timeout.xml"), lastXml);
  throw new Error(
    `timed out waiting for the login screen; last UI saved to ${path.relative(repoRoot, path.join(artifacts, "ui-timeout.xml"))}`,
  );
}

function pinClock() {
  const rootOutput = adb(["root"]);
  if (/cannot run as root/i.test(rootOutput)) {
    throw new Error("adb root is not available; the emulator must be a userdebug image.");
  }
  execFileSync("adb", ["-s", device, "wait-for-device"], { stdio: "ignore" });
  adb(["shell", "settings", "put", "global", "auto_time", "0"]);
  adb(["shell", "settings", "put", "global", "auto_time_zone", "0"]);
  adb(["shell", "date", "030611002026.00"]);
  const now = adb(["shell", "date"]).trim();
  if (!now.includes("2026")) throw new Error(`clock pin failed: ${now}`);
  console.log(`  clock pinned: ${now}`);
}

function restoreClock() {
  try {
    adb(["shell", "settings", "put", "global", "auto_time", "1"]);
    adb(["shell", "settings", "put", "global", "auto_time_zone", "1"]);
    console.log("  clock restored (auto_time=1)");
  } catch (error) {
    console.warn(`  could not restore the clock: ${error.message}`);
  }
}

function disableAnimations() {
  for (const key of animationKeys) {
    try {
      const value = adb(["shell", "settings", "get", "global", key]).trim();
      savedAnimations.set(key, value === "null" ? "1" : value);
      adb(["shell", "settings", "put", "global", key, "0"]);
    } catch {
      // Non-fatal: Maestro retries around animations anyway.
    }
  }
}

function restoreAnimations() {
  for (const [key, value] of savedAnimations) {
    try {
      adb(["shell", "settings", "put", "global", key, value || "1"]);
    } catch {
      // Non-fatal.
    }
  }
}

function resolveMaestro() {
  const lookup = process.platform === "win32" ? "where" : "which";
  try {
    const found = execSync(`${lookup} maestro`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)[0]
      .trim();
    if (found) return found;
  } catch {
    // Fall through to the per-user install.
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const local = path.join(home, "maestro", "bin", "maestro.bat");
  if (existsSync(local)) return local;
  throw new Error(
    "Maestro CLI not found. Install 2.11+ and put its bin folder on PATH — see apps/mobile/e2e/README.md.",
  );
}

function pnpm(command) {
  execSync(`pnpm ${command}`, { cwd: repoRoot, stdio: "inherit" });
}

async function main() {
  console.log("Mobile attendance E2E");
  console.log(`  device:  ${device}`);
  console.log(`  Metro:   http://${metroHost}:8081 (emulator alias)`);
  console.log(`  output:  ${path.relative(repoRoot, artifacts)}`);

  await assertPort(
    4000,
    "Start the API (`pnpm --filter @repo/api dev`); the web app is not needed.",
  );
  await assertPort(
    8081,
    "Start Metro (`pnpm --filter @repo/mobile start`).",
  );

  const devices = adb(["devices"]);
  if (!new RegExp(`^${device}\\s+device$`, "m").test(devices)) {
    throw new Error(`device ${device} is not attached. Start the emulator first.`);
  }
  for (const flow of flowFiles) {
    if (!existsSync(flow)) throw new Error(`missing flow file: ${flow}`);
  }
  mkdirSync(artifacts, { recursive: true });

  console.log("\n1/5 resetting the demo fixture");
  pnpm("reset:demo -- --yes");
  pnpm("db:seed");

  console.log("\n2/5 pinning the emulator clock");
  adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
  adb(["shell", "wm", "dismiss-keyguard"]);
  disableAnimations();
  pinClock();

  console.log("\n3/5 relaunching the dev client");
  const cleared = adb(["shell", "pm", "clear", appId]);
  if (!/Success/i.test(cleared)) {
    throw new Error(`${appId} is not installed on ${device} (pm clear: ${cleared.trim()}).`);
  }
  sleep(1500);
  const deepLink = `mskool://expo-development-client/?url=${encodeURIComponent(
    `http://${metroHost}:8081`,
  )}`;
  adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deepLink]);
  console.log("  waiting for the bundle and the login screen (up to 3 minutes)");
  waitForLogin(180_000);
  // The dev-client onboarding can pop several seconds after login draws. Give
  // it a quiet settle window, then dismiss it before Maestro takes over.
  sleep(15_000);
  waitForLogin(30_000);

  console.log("\n4/5 running Maestro flows");
  const maestro = resolveMaestro();
  execSync(
    `"${maestro}" test ${flowFiles.map((file) => `"${file}"`).join(" ")} ` +
      `--udid ${device} --test-output-dir "${artifacts}"`,
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        MAESTRO_CLI_NO_ANALYTICS: "true",
        MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
      },
    },
  );

  console.log("\n5/5 asserting the database writes");
  execSync("pnpm --filter @repo/db verify:e2e", {
    cwd: repoRoot,
    stdio: "inherit",
  });

  console.log(`\nE2E passed. Artifacts: ${path.relative(repoRoot, artifacts)}`);
}

try {
  await main();
} catch (error) {
  console.error(`\nE2E failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  restoreAnimations();
  restoreClock();
}
