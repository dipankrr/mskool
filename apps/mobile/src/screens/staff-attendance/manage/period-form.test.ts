import { copy } from "../../../lib/copy";
import {
  initialPeriodForm,
  nextSequence,
  toHHMM,
  toPeriodPayload,
  validatePeriodForm,
} from "./period-form";
import type { PeriodForm } from "./period-form";

function form(patch: Partial<PeriodForm> = {}): PeriodForm {
  return {
    name: "Period 2",
    sequence: "2",
    start: "08:00",
    end: "08:45",
    isHomeroom: false,
    ...patch,
  };
}

describe("toHHMM", () => {
  it("trims Postgres time strings to HH:MM and rejects nonsense", () => {
    expect(toHHMM("08:00:00")).toBe("08:00");
    expect(toHHMM("23:59:59")).toBe("23:59");
    expect(toHHMM(null)).toBeNull();
    expect(toHHMM("8:00")).toBeNull();
    expect(toHHMM("24:00:00")).toBeNull();
  });
});

describe("nextSequence", () => {
  it("is one past the highest, capped at 30", () => {
    expect(nextSequence([])).toBe(1);
    expect(nextSequence([1, 2, 3])).toBe(4);
    expect(nextSequence([3, 30])).toBe(30);
  });
});

describe("initialPeriodForm", () => {
  it("starts a new period at the next slot, no times, not homeroom", () => {
    expect(initialPeriodForm(null, 3)).toEqual({
      name: "Period 3",
      sequence: "3",
      start: null,
      end: null,
      isHomeroom: false,
    });
  });

  it("maps a stored row back, slicing the seconds off its times", () => {
    expect(
      initialPeriodForm(
        {
          name: "Assembly",
          sequenceNumber: 1,
          startTime: "08:00:00",
          endTime: "08:20:00",
          isHomeroom: true,
        },
        1,
      ),
    ).toEqual({
      name: "Assembly",
      sequence: "1",
      start: "08:00",
      end: "08:20",
      isHomeroom: true,
    });
  });
});

describe("validatePeriodForm", () => {
  it("requires a name within the contract's bounds", () => {
    expect(validatePeriodForm(form({ name: "  " })).name).toBe(
      copy.attendance.manage.periods.errors.name,
    );
    expect(
      validatePeriodForm(form({ name: "x".repeat(51) })).name,
    ).toBeTruthy();
    expect(validatePeriodForm(form({ name: "Period 2" })).name).toBeUndefined();
  });

  it("requires a sequence between 1 and 30", () => {
    expect(validatePeriodForm(form({ sequence: "0" })).sequence).toBe(
      copy.attendance.manage.periods.errors.sequence,
    );
    expect(
      validatePeriodForm(form({ sequence: "31" })).sequence,
    ).toBeTruthy();
    expect(validatePeriodForm(form({ sequence: "2.5" })).sequence).toBeTruthy();
    expect(validatePeriodForm(form({ sequence: "30" })).sequence).toBeUndefined();
  });

  it("refuses an end before the start, and allows either side alone", () => {
    expect(validatePeriodForm(form({ start: "09:00", end: "08:00" })).timeOrder).toBe(
      copy.attendance.manage.periods.errors.timeOrder,
    );
    expect(
      validatePeriodForm(form({ start: "09:00", end: "09:00" })).timeOrder,
    ).toBeTruthy();
    expect(
      validatePeriodForm(form({ start: "08:00", end: null })).timeOrder,
    ).toBeUndefined();
    expect(
      validatePeriodForm(form({ start: null, end: "08:00" })).timeOrder,
    ).toBeUndefined();
  });
});

describe("toPeriodPayload", () => {
  it("trims the name and converts the sequence", () => {
    expect(toPeriodPayload(form({ name: "  Period 2 ", sequence: "7" }))).toEqual(
      {
        name: "Period 2",
        sequenceNumber: 7,
        startTime: "08:00",
        endTime: "08:45",
        isHomeroom: false,
      },
    );
  });
});
