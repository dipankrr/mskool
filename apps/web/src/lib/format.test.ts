import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Imported from the module, not a barrel: A5 keeps these module-level exports
// while removing everything else from lib's public surface (A1/A5 note).
//
// This file is deliberately pure ASCII: the em/en dashes under test are
// written as \u2014 / \u2013 escapes so no editor or shell encoding can
// corrupt the assertions.
import {
  currentSessionStartYear,
  formatIsoDate,
  formatIsoDateRange,
  isIsoDate,
  isoYear,
  parseDisplayDate,
  sessionFromStartYear,
  sessionStartYearOptions,
  todayIso,
} from "./format";

/** The absent-value marker, duplicated here so the constant stays internal. */
const ABSENT = "\u2014";

describe("isIsoDate - well-formed AND real", () => {
  it("accepts a well-formed date that exists", () => {
    expect(isIsoDate("2026-03-31")).toBe(true);
  });

  it("rejects 30 February - regex passes, reality fails", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
  });

  it("rejects 29 February in a non-leap year", () => {
    expect(isIsoDate("2025-02-29")).toBe(false);
  });

  it("accepts 29 February in a leap year", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects 1900-02-29 - divisible by 100 but not 400", () => {
    expect(isIsoDate("1900-02-29")).toBe(false);
  });

  it("accepts 2000-02-29 - divisible by 400", () => {
    expect(isIsoDate("2000-02-29")).toBe(true);
  });

  it("rejects non-strings and malformed shapes", () => {
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(12345)).toBe(false);
    expect(isIsoDate({})).toBe(false);
    // Ten digits is not an ISO calendar date.
    expect(isIsoDate("20260331")).toBe(false);
  });
});

describe("formatIsoDate - ISO wire to DD/MM/YYYY screen", () => {
  it("formats day-first with slashes", () => {
    expect(formatIsoDate("2026-03-31")).toBe("31/03/2026");
  });

  it("renders an em dash for absent values", () => {
    expect(formatIsoDate(null)).toBe(ABSENT);
    expect(formatIsoDate(undefined)).toBe(ABSENT);
  });

  it("renders an em dash for junk rather than throwing", () => {
    expect(formatIsoDate("not-a-date")).toBe(ABSENT);
  });
});

describe("formatIsoDateRange - en dash between two dates", () => {
  it("joins two dates day-first with an en dash", () => {
    expect(formatIsoDateRange("2025-04-01", "2026-03-31")).toBe(
      "01/04/2025 \u2013 31/03/2026",
    );
  });

  it("keeps both slots even when one side is missing", () => {
    expect(formatIsoDateRange(null, "2026-03-31")).toBe(
      `${ABSENT} \u2013 31/03/2026`,
    );
  });
});

describe("parseDisplayDate - half-typed input is normal input", () => {
  it("converts DD/MM/YYYY to padded ISO", () => {
    expect(parseDisplayDate("31/03/2026")).toBe("2026-03-31");
  });

  it("accepts dashes and dots as separators, and trims whitespace", () => {
    expect(parseDisplayDate("31-03-2026")).toBe("2026-03-31");
    expect(parseDisplayDate("31.3.2026")).toBe("2026-03-31");
    expect(parseDisplayDate("  31/03/2026  ")).toBe("2026-03-31");
  });

  it("pads short parts and expands two-digit years to 2000+", () => {
    expect(parseDisplayDate("1/4/26")).toBe("2026-04-01");
  });

  it("returns null for a half-typed value instead of throwing", () => {
    expect(parseDisplayDate("31/")).toBeNull();
    expect(parseDisplayDate("31/0")).toBeNull();
  });

  it("returns null for a date that does not exist", () => {
    expect(parseDisplayDate("31/02/2026")).toBeNull();
  });
});

describe("todayIso - the reader's calendar, not UTC's", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a valid ISO calendar date", () => {
    expect(isIsoDate(todayIso())).toBe(true);
  });

  it("uses local parts where toISOString would roll back a day", () => {
    // 01:00 in Kolkata on 1 April is still 31 March in UTC. The machine runs
    // IST (+05:30), so this pins the exact failure mode documented at the top
    // of format.ts: `.toISOString().slice(0, 10)` would say 2026-03-31.
    const utcInstant = new Date("2026-04-01T01:00:00+05:30");
    if (new Date().getTimezoneOffset() === 0) return; // only meaningful east of UTC
    vi.setSystemTime(utcInstant);

    expect(todayIso()).toBe("2026-04-01");
    expect(todayIso()).not.toBe(utcInstant.toISOString().slice(0, 10));
  });
});

describe("isoYear", () => {
  it("reads the four-digit year from a valid date", () => {
    expect(isoYear("2026-03-31")).toBe(2026);
  });

  it("returns null for anything unparsable", () => {
    expect(isoYear("31/03/2026")).toBeNull();
    expect(isoYear(undefined)).toBeNull();
  });
});

describe("academic session maths - April/March boundaries", () => {
  it("names the session and freezes 1 April to 31 March", () => {
    const session = sessionFromStartYear(2025);
    expect(session.name).toBe("2025-26");
    expect(session.startDate).toBe("2025-04-01");
    expect(session.endDate).toBe("2026-03-31");
  });

  it("pins the documented 2099 edge: name wraps to -00", () => {
    // Wrong by design and unreachable via the picker window; pinned so that
    // anyone who changes the wrapping sees they have.
    expect(sessionFromStartYear(2099).name).toBe("2099-00");
  });

  it("puts April onwards in this calendar year and Jan-Mar in the previous one", () => {
    expect(currentSessionStartYear("2025-04-01")).toBe(2025);
    expect(currentSessionStartYear("2025-09-15")).toBe(2025);
    expect(currentSessionStartYear("2025-03-31")).toBe(2024);
    expect(currentSessionStartYear("2026-01-15")).toBe(2025);
  });

  it("offers a newest-first three-year window around today", () => {
    const options = sessionStartYearOptions("2025-06-01");
    expect(options).toEqual([2026, 2025, 2024]);
  });
});
