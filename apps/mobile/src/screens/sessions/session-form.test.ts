import {
  currentSessionStartYear,
  matchedStartYear,
  sessionFromStartYear,
  sessionStartYearOptions,
  sessionStatus,
} from "../../lib/session-dates";
import {
  emptySessionForm,
  initialSessionForm,
  isSessionFormDirty,
  isStartYearTaken,
  sessionPayload,
  validateSessionForm,
} from "./session-form";

describe("session dates", () => {
  it("builds 1 April to 31 March and names the two years", () => {
    expect(sessionFromStartYear(2025)).toEqual({
      name: "2025-26",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("reads April onwards as this year and January to March as last", () => {
    expect(currentSessionStartYear("2026-10-23")).toBe(2026);
    expect(currentSessionStartYear("2026-04-01")).toBe(2026);
    expect(currentSessionStartYear("2026-03-31")).toBe(2025);
  });

  it("offers next, this and last, newest first", () => {
    expect(sessionStartYearOptions("2026-10-23")).toEqual([2027, 2026, 2025]);
  });

  it("matches a preset only while all three values still agree", () => {
    const preset = sessionFromStartYear(2026);
    expect(matchedStartYear(preset, [2027, 2026])).toBe(2026);
    expect(
      matchedStartYear({ ...preset, endDate: "2027-03-30" }, [2027, 2026]),
    ).toBeNull();
  });

  it("call the flagged year running even when its dates say otherwise", () => {
    expect(
      sessionStatus(
        { isCurrent: true, startDate: "2024-04-01", endDate: "2025-03-31" },
        "2026-10-23",
      ),
    ).toBe("running");
    expect(
      sessionStatus(
        { isCurrent: false, startDate: "2026-04-01", endDate: "2027-03-31" },
        "2026-10-23",
      ),
    ).toBe("not_running");
    expect(
      sessionStatus(
        { isCurrent: false, startDate: "2027-04-01", endDate: "2028-03-31" },
        "2026-10-23",
      ),
    ).toBe("upcoming");
    expect(
      sessionStatus(
        { isCurrent: false, startDate: "2024-04-01", endDate: "2025-03-31" },
        "2026-10-23",
      ),
    ).toBe("past");
  });
});

describe("emptySessionForm", () => {
  it("preselects the session the reader is actually in", () => {
    expect(emptySessionForm("2026-10-23")).toEqual({
      name: "2026-27",
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
  });
});

describe("initialSessionForm", () => {
  const taken = (startDate: string) => ({
    id: startDate,
    name: startDate.slice(0, 4),
    startDate,
    endDate: `${Number(startDate.slice(0, 4)) + 1}-03-31`,
  });

  it("opens on the current session while it is free", () => {
    expect(initialSessionForm([], "2026-10-23").name).toBe("2026-27");
  });

  it("moves to the next free year instead of opening on a taken preset", () => {
    expect(
      initialSessionForm([taken("2026-04-01")], "2026-10-23").name,
    ).toBe("2027-28");
  });

  it("falls back to the current year when every option is taken", () => {
    expect(
      initialSessionForm(
        [taken("2027-04-01"), taken("2026-04-01"), taken("2025-04-01")],
        "2026-10-23",
      ).name,
    ).toBe("2026-27");
  });
});

describe("validateSessionForm", () => {
  const form = {
    name: "2026-27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
  };
  const existing = [
    {
      id: "old",
      name: "2025-26",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    },
  ];

  it("accepts a clean, non-overlapping range", () => {
    expect(validateSessionForm(form, existing)).toEqual({});
  });

  it("requires a name of 4–20 characters", () => {
    expect(validateSessionForm({ ...form, name: "26" }, existing).name).toBeDefined();
    expect(
      validateSessionForm({ ...form, name: "x".repeat(21) }, existing).name,
    ).toBeDefined();
  });

  it("refuses a range that ends before it starts", () => {
    expect(
      validateSessionForm(
        { ...form, startDate: "2026-06-01", endDate: "2026-05-31" },
        existing,
      ).endDate,
    ).toBeDefined();
  });

  it("treats a shared boundary day as an overlap (the dates are inclusive)", () => {
    expect(
      validateSessionForm({ ...form, startDate: "2026-03-31" }, existing).endDate,
    ).toBeDefined();
    expect(
      validateSessionForm({ ...form, startDate: "2026-04-01" }, existing).endDate,
    ).toBeUndefined();
  });

  it("excludes the row being edited from its own overlap check", () => {
    const own = {
      id: "own",
      name: "2026-27",
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    };
    expect(validateSessionForm(form, [own], "own")).toEqual({});
  });

  it("reports which session the new range collides with", () => {
    const collision = {
      ...form,
      startDate: "2026-03-01",
      endDate: "2026-06-30",
    };
    const error = validateSessionForm(collision, existing).endDate;
    expect(error).toContain("2025-26");
  });
});

describe("session payload and helpers", () => {
  it("trims the name and keeps ISO dates untouched", () => {
    expect(
      sessionPayload({
        name: " 2026-27 ",
        startDate: "2026-04-01",
        endDate: "2027-03-31",
      }),
    ).toEqual({
      name: "2026-27",
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
  });

  it("marks a start year taken when a sibling starts that April", () => {
    expect(
      isStartYearTaken(
        2025,
        [
          {
            id: "a",
            name: "2025-26",
            startDate: "2025-04-01",
            endDate: "2026-03-31",
          },
        ],
      ),
    ).toBe(true);
    expect(isStartYearTaken(2027, [])).toBe(false);
  });

  it("ignores date-format-only differences while editing", () => {
    expect(
      isSessionFormDirty(
        { name: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
        { name: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
      ),
    ).toBe(false);
  });
});
