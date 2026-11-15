import { env } from "../env";
import { loginByPhone } from "./auth";
import { withTimeout } from "./with-timeout";

/**
 * Staff sign-in (ADR-068): phone first, then the server says `password` (has
 * joined) or `code` (everyone else, unknown numbers too). Joining sets the
 * password with the office's 6-digit code; the same path re-sets a
 * forgotten one. The login's username is `staff.` + the 10 digits, added here
 * so nobody ever types it.
 */

export type StaffSecondStep = "password" | "code";
export type JoinFailure = "mismatch" | "tooMany" | "network" | "password";

export const STAFF_MIN_PASSWORD = 8;

export function staffUsername(digits: string): string {
  return `staff.${digits}`;
}

async function post(path: string, body: unknown, signal: AbortSignal) {
  return fetch(`${env.EXPO_PUBLIC_API_URL}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Which second step this phone gets; fails closed to `code`. */
export async function staffAccountState(
  digits: string,
): Promise<StaffSecondStep | "paused" | "tooMany" | "network"> {
  try {
    const res = await withTimeout((signal) =>
      post("/staff/account-status", { phone: digits }, signal),
    );
    if (res.status === 429) return "tooMany";
    const body = (await res.json().catch(() => ({}))) as { state?: string };
    if (body.state === "paused") return "paused";
    return body.state === "password" ? "password" : "code";
  } catch {
    return "network";
  }
}

/** Phone + code + new password. On success the caller signs in with it. */
export async function joinWithCode(input: {
  phone: string;
  code: string;
  password: string;
}): Promise<{ ok: true; firstJoin: boolean } | { ok: false; reason: JoinFailure }> {
  try {
    const res = await withTimeout((signal) => post("/staff/join", input, signal));
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { firstJoin?: boolean };
      return { ok: true, firstJoin: body.firstJoin === true };
    }
    if (res.status === 429) return { ok: false, reason: "tooMany" };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error && /characters/.test(body.error)) return { ok: false, reason: "password" };
    return { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Signs a staff member in by phone + password. */
export function staffLogin(digits: string, password: string) {
  return loginByPhone(staffUsername(digits), password);
}
