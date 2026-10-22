import {
  buildGenerateInput,
  cycleWeekdayState,
  defaultWeekdayRows,
  hasAnyWorkingDay,
  WEEKDAY_ORDER,
} from "./template";

describe("defaultWeekdayRows", () => {
  it("runs Monday-first with Mon–Fri in session", () => {
    const rows = defaultWeekdayRows();
    expect(rows.map((row) => row.jsDay)).toEqual(WEEKDAY_ORDER);
    expect(rows.map((row) => row.state)).toEqual([
      "working",
      "working",
      "working",
      "working",
      "working",
      "off",
      "off",
    ]);
  });
});

describe("cycleWeekdayState", () => {
  it("cycles working → half day → off → working", () => {
    expect(cycleWeekdayState("working")).toBe("half_day");
    expect(cycleWeekdayState("half_day")).toBe("off");
    expect(cycleWeekdayState("off")).toBe("working");
  });
});

describe("hasAnyWorkingDay", () => {
  it("is false only when every day is off", () => {
    expect(hasAnyWorkingDay(defaultWeekdayRows())).toBe(true);
    expect(
      hasAnyWorkingDay([
        { jsDay: 1, state: "off" },
        { jsDay: 2, state: "off" },
      ]),
    ).toBe(false);
  });
});

describe("buildGenerateInput", () => {
  it("splits working and half-day sets, Monday-first order kept", () => {
    const rows = defaultWeekdayRows().map((row) => {
      if (row.jsDay === 6) return { ...row, state: "half_day" as const };
      if (row.jsDay === 5) return { ...row, state: "off" as const };
      return row;
    });
    expect(buildGenerateInput(rows)).toEqual({
      workingWeekdays: [1, 2, 3, 4, 6],
      halfDayWeekdays: [6],
    });
  });

  it("keeps the half-day set a subset of the working set by construction", () => {
    const rows = defaultWeekdayRows().map((row) => ({
      ...row,
      state: row.jsDay === 1 ? ("half_day" as const) : ("off" as const),
    }));
    const input = buildGenerateInput(rows);
    expect(input.workingWeekdays).toEqual([1]);
    expect(input.halfDayWeekdays).toEqual([1]);
    expect(
      input.halfDayWeekdays.every((day) =>
        input.workingWeekdays.includes(day),
      ),
    ).toBe(true);
  });

  it("sends an empty half-day set when every working day is full", () => {
    const input = buildGenerateInput(defaultWeekdayRows());
    expect(input.halfDayWeekdays).toEqual([]);
  });
});
