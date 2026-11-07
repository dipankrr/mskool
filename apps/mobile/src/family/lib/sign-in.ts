import { env } from "../../env";
import { withTimeout } from "../../lib/with-timeout";

/**
 * The family sign-in flow (ADR-037), as pure helpers plus the two public
 * claim endpoints. The server decides the second step from the phone alone
 * and refuses every mismatch with one uniform answer, so nothing here tells
 * which detail was wrong.
 */

export type SecondStep = "password" | "setup";

/** The last 10 digits of whatever was typed (+91, spaces, dashes allowed). */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

export function isPhone(value: string): boolean {
  return /^\d{10}$/.test(phoneDigits(value));
}

/** "98765 43210" for display. */
export function formatPhone(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

/**
 * Masks typing into "DD / MM / YYYY": digits only, slashes added as the
 * family types, at most 8 digits.
 */
export function maskDob(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join(" / ");
}

/** "DD / MM / YYYY" → "YYYY-MM-DD", or null when it isn't a real past date. */
export function dobToIso(masked: string, today = new Date()): string | null {
  const digits = masked.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (month < 1 || month > 12 || day < 1) return null;
  const length = new Date(year, month, 0).getDate();
  if (day > length) return null;
  if (year < 1900 || new Date(year, month - 1, day) > today) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const MIN_PASSWORD = 8;

/** Why a claim call failed, for the screen to word. */
export type ClaimFailure = "mismatch" | "tooMany" | "network" | "password";

async function post(path: string, body: unknown, signal: AbortSignal) {
  return fetch(`${env.EXPO_PUBLIC_API_URL}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Which second step this phone gets. Fails closed to `setup`, as the server
 * does: an unknown number looks exactly like a first-time one.
 */
export async function accountStatus(phone: string): Promise<SecondStep | "tooMany" | "network"> {
  try {
    const res = await withTimeout((signal) => post("/portal/account-status", { phone }, signal));
    if (res.status === 429) return "tooMany";
    const body = (await res.json().catch(() => ({}))) as { state?: string };
    return body.state === "password" ? "password" : "setup";
  } catch {
    return "network";
  }
}

/** First claim and forgot-password are the same call: the trio sets the password. */
export async function claim(input: {
  phone: string;
  admissionNumber: string;
  dateOfBirth: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; reason: ClaimFailure }> {
  try {
    const res = await withTimeout((signal) => post("/portal/claim", input, signal));
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, reason: "tooMany" };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    // The server's only non-uniform refusal is the password length rule.
    if (body.error && /characters/.test(body.error)) return { ok: false, reason: "password" };
    return { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
