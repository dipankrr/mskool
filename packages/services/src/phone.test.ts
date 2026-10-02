import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone";

/**
 * PHONE NORMALIZATION (ADR-037) — the digits behind every family login.
 * Hermetic: pure function, no DB. Each case pins a real keyboard or
 * copy-paste shape against the one rule (exactly 10 subscriber digits):
 * country code, trunk zero, separators, and the Indic digit blocks mobile
 * keyboards emit natively all fold to the same login; anything else is
 * null (the caller — never this function — chooses the wording).
 */
describe("normalizePhone", () => {
  it.each([
    ["9800000001", "9800000001"],
    ["+91-9800000001", "9800000001"],
    ["919800000001", "9800000001"],
    ["09800000001", "9800000001"],
    ["98000 00001", "9800000001"],
    ["98000-00001", "9800000001"],
  ])("folds %s to %s", (raw, digits) => {
    expect(normalizePhone(raw)).toBe(digits);
  });

  it.each([[""], ["98"], ["abcdefghij"], ["+--"]])(
    "rejects %s",
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );

  it("rejects native-script digits — ASCII digits only, by decision", () => {
    // Deliberately NOT folded: the field error says 10 digits, and the
    // claim's uniform refusal covers the rest.
    expect(normalizePhone("९८०००००००१")).toBeNull();
  });

  it("never mistakes an 11-digit string for a 10-digit tail collision", () => {
    // Last-10 slicing is load-bearing: a country code must not silently
    // become someone else's number — 11 digits is exactly code + number.
    expect(normalizePhone("19800000001")).toBe("9800000001");
    expect(normalizePhone("98000000011")).toBe("8000000011");
    expect(normalizePhone("980000001")).toBeNull();
  });
});
