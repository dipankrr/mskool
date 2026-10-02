/**
 * PHONE — the digits behind every family login (ADR-037). Pure on purpose:
 * hermetic unit tests must stay free of `process.env` (the fees-maths
 * precedent), and every DB-touching module validates env at import.
 */

/**
 * ASCII digits only, last 10 (tolerates +91 / leading 0 / spaces /
 * hyphens). Anything else — including native-script digits — is null, and
 * the UI's field error tells the parent exactly that (10 digits).
 *
 * Returns null rather than throwing — the caller chooses the wording:
 * staff input gets the field error, the public claim gets the uniform
 * refusal (never say which field missed).
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const tail = digits.length > 10 ? digits.slice(-10) : digits;
  return /^\d{10}$/.test(tail) ? tail : null;
}
