import { daysUntil, nextDay, papersByDay, splitExams } from "./exams";

describe("family exam rules", () => {
  it("puts coming-up exams first, soonest first, and finished ones after, latest first", () => {
    const { current, past } = splitExams([
      { id: "a", state: "results_out", firstDate: "2026-07-01", lastDate: "2026-07-05" },
      { id: "b", state: "upcoming", firstDate: "2026-12-01", lastDate: "2026-12-05" },
      { id: "c", state: "ongoing", firstDate: "2026-11-02", lastDate: "2026-11-09" },
      { id: "d", state: "marks_being_checked", firstDate: "2026-09-01", lastDate: "2026-09-05" },
      { id: "e", state: "upcoming", firstDate: null, lastDate: null },
    ]);
    expect(current.map((e) => e.id)).toEqual(["c", "b", "e"]);
    expect(past.map((e) => e.id)).toEqual(["d", "a"]);
  });

  it("counts whole days across months", () => {
    expect(daysUntil("2026-11-07", "2026-11-07")).toBe(0);
    expect(daysUntil("2026-12-01", "2026-11-30")).toBe(1);
    expect(daysUntil("2026-11-02", "2026-11-07")).toBe(-5);
  });

  it("groups the date sheet by day, papers by start time", () => {
    const days = papersByDay([
      { examDate: "2026-11-03", startTime: "09:30", subjectName: "Maths" },
      { examDate: "2026-11-02", startTime: "13:00", subjectName: "Hindi" },
      { examDate: "2026-11-02", startTime: "09:30", subjectName: "English" },
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(days[0]!.papers.map((p) => p.subjectName)).toEqual(["English", "Hindi"]);
    expect(nextDay(days, "2026-11-03")).toBe("2026-11-03");
    expect(nextDay(days, "2026-11-04")).toBeNull();
  });
});
