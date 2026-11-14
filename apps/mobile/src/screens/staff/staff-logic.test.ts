import { looksLikeTeacher, splitName, todayIst } from "./staff-logic";

describe("staff logic (ADR-068)", () => {
  it("splits a full name on the last word", () => {
    expect(splitName("Kavita Iyer")).toEqual({ firstName: "Kavita", lastName: "Iyer" });
    expect(splitName("  Mohan  Lal Gupta ")).toEqual({ firstName: "Mohan Lal", lastName: "Gupta" });
    expect(splitName("Kavita")).toEqual({ firstName: "Kavita", lastName: "" });
  });

  it("spots teacher titles", () => {
    expect(looksLikeTeacher("TGT Science")).toBe(true);
    expect(looksLikeTeacher("pgt")).toBe(true);
    expect(looksLikeTeacher("Music Teacher")).toBe(true);
    expect(looksLikeTeacher("Accountant")).toBe(false);
    expect(looksLikeTeacher("TGTX")).toBe(false);
  });

  it("dates today in India", () => {
    expect(todayIst(new Date("2026-11-14T20:00:00.000Z"))).toBe("2026-11-15");
  });
});
