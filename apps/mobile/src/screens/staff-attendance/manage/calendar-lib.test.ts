import {
  DEFAULT_PATTERN,
  countSession,
  groupEntries,
  nationalHolidays,
  parseDate,
  parseImport,
} from "./calendar-lib";

describe("calendar-lib", () => {
  it("groups a break across its weekend into one entry", () => {
    const entries = groupEntries([
      { date: "2026-11-06", dayType: "holiday", reason: "Diwali break" },
      { date: "2026-11-07", dayType: "weekend", reason: null },
      { date: "2026-11-08", dayType: "weekend", reason: null },
      { date: "2026-11-09", dayType: "holiday", reason: "Diwali break" },
      { date: "2026-11-10", dayType: "holiday", reason: "Diwali break" },
      { date: "2026-11-14", dayType: "half_day", reason: null },
      { date: "2026-11-24", dayType: "holiday", reason: "Guru Nanak Jayanti" },
    ]);
    expect(entries.map((e) => [e.from, e.to, e.reason])).toEqual([
      ["2026-11-06", "2026-11-10", "Diwali break"],
      ["2026-11-24", "2026-11-24", "Guru Nanak Jayanti"],
    ]);
  });

  it("counts a session from the week plus overrides", () => {
    const counts = countSession(DEFAULT_PATTERN, "2026-11-16", "2026-11-22", new Map([["2026-11-17", "holiday"]]));
    expect(counts).toMatchObject({ working: 4, holiday: 1, half_day: 1, weekend: 1, school: 5 });
  });

  it("lists national holidays inside a session, festivals flagged", () => {
    const list = nationalHolidays("2027-04-01", "2028-03-31");
    expect(list.find((e) => e.reason === "Republic Day")?.from).toBe("2028-01-26");
    expect(list.find((e) => e.reason === "Diwali")?.check).toBe(true);
    expect(list.find((e) => e.reason === "Independence Day")?.check).toBeUndefined();
  });

  it("reads common date spellings", () => {
    expect(parseDate("26/01/2027")).toBe("2027-01-26");
    expect(parseDate("26 Jan 2027")).toBe("2027-01-26");
    expect(parseDate("Jan 26, 2027")).toBe("2027-01-26");
    expect(parseDate("2027-1-26")).toBe("2027-01-26");
    expect(parseDate("31/02/2027")).toBeNull();
  });

  it("imports pasted cells and csv lines", () => {
    const result = parseImport(
      "Date\tName\n26/01/2027\tRepublic Day\n28/10/2027\t1/11/2027\tDiwali break\n15 Sep 2027, Half-yearly exams, exam\nnot a row",
    );
    expect(result.entries.map((e) => [e.from, e.to, e.reason, e.dayType])).toEqual([
      ["2027-01-26", "2027-01-26", "Republic Day", "holiday"],
      ["2027-10-28", "2027-11-01", "Diwali break", "holiday"],
      ["2027-09-15", "2027-09-15", "Half-yearly exams", "exam_day"],
    ]);
    expect(result.skipped).toEqual(["Date\tName", "not a row"]);
  });

  it("imports a calendar file's all-day events", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20271028",
      "DTEND;VALUE=DATE:20271102",
      "SUMMARY:Diwali break",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    expect(parseImport(ics).entries[0]).toMatchObject({ from: "2027-10-28", to: "2027-11-01", reason: "Diwali break" });
  });
});
