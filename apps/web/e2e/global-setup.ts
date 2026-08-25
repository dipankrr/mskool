import fs from "node:fs";
import path from "node:path";

/**
 * Refreshes one saved auth state per seeded role, at the repo root
 * (`auth-*.json`, gitignored — each holds a live session cookie).
 *
 * Signing in over HTTP (like a browser) instead of reusing stale files keeps
 * the suite deterministic: a session expired mid-weekend fails here with a
 * clear message rather than as forty confusing 401s. The API must be up and
 * `pnpm db:seed` run before this succeeds.
 */
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
/** Dev only. The seed's password, not a secret. */
const PASSWORD = "Password123!";

// The states live at the repo root; Playwright runs from apps/web.
const STATES_DIR = path.resolve(process.cwd(), "..", "..");

const ROLES = [
  { file: "auth-orgadmin.json", email: "admin@demo-trust.test" },
  { file: "auth-principal.json", email: "principal@demo-trust.test" },
  { file: "auth-classteacher.json", email: "teacher@demo-trust.test" },
  { file: "auth-subjectteacher.json", email: "subject-teacher@demo-trust.test" },
] as const;

type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

/**
 * Turns one Set-Cookie header into Playwright's storage-state cookie shape.
 * Hand-rolled because better-auth may chunk its session cookie across several
 * Set-Cookie headers and there is no cookie parser in the dependency tree.
 */
function parseSetCookie(raw: string): StorageStateCookie {
  const parts = raw.split(";").map((part) => part.trim());
  const first = parts[0];
  if (first === undefined || !first.includes("=")) {
    throw new Error(`Unparseable Set-Cookie header: ${raw}`);
  }
  const attrs = parts.slice(1);
  const eq = first.indexOf("=");
  const name = first.slice(0, eq);
  const value = first.slice(eq + 1);

  const cookie: StorageStateCookie = {
    name,
    value,
    domain: new URL(WEB_URL).hostname,
    path: "/",
    // A week out. Moot in practice: every run signs in afresh.
    expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };

  for (const attr of attrs) {
    const attrEq = attr.indexOf("=");
    const attrName = (attrEq === -1 ? attr : attr.slice(0, attrEq)).toLowerCase();
    const attrValue = attrEq === -1 ? "" : attr.slice(attrEq + 1);

    switch (attrName) {
      case "domain":
        cookie.domain = attrValue.replace(/^\./, "");
        break;
      case "path":
        cookie.path = attrValue || "/";
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "samesite":
        cookie.sameSite =
          attrValue.toLowerCase() === "strict"
            ? "Strict"
            : attrValue.toLowerCase() === "none"
              ? "None"
              : "Lax";
        break;
      case "max-age": {
        const seconds = Number(attrValue);
        if (Number.isFinite(seconds) && seconds > 0) {
          cookie.expires = Math.floor(Date.now() / 1000) + seconds;
        }
        break;
      }
      default:
        break;
    }
  }

  return cookie;
}

async function main() {
  for (const role of ROLES) {
    // better-auth rejects state-changing calls without a trusted Origin, the
    // same way the smoke test has to send one.
    const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_URL },
      body: JSON.stringify({ email: role.email, password: PASSWORD }),
    });

    if (!res.ok) {
      throw new Error(
        `Sign-in failed for ${role.email} (${res.status}). Is the API running ` +
          `at ${API_URL}, and has \`pnpm db:seed\` been run?`,
      );
    }

    const setCookies = res.headers.getSetCookie();
    if (!setCookies || setCookies.length === 0) {
      throw new Error(`No session cookie returned for ${role.email}.`);
    }

    const state = { cookies: setCookies.map(parseSetCookie), origins: [] };
    const file = path.join(STATES_DIR, role.file);
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    console.log(`[e2e] refreshed ${role.file}`);
  }
}

export default main;
