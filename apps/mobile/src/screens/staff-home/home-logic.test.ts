import type { HomePaper, HomeSectionDay, MyTeaching } from "@repo/contracts";

import {
  attendanceList,
  attendanceMode,
  byClass,
  bySubject,
  firstName,
  greetingFor,
  ownSections,
  pageOrder,
  pairState,
  paperProgress,
  percent,
  shortMoney,
  showWaitingTags,
  sortWaiting,
  teachingPairs,
} from "./home-logic";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const day = (n: number, marked: number): HomeSectionDay => ({
  sectionId: uuid(n),
  sectionName: "A",
  classId: uuid(100 + n),
  className: `Class ${n}`,
  students: 30,
  marked,
  present: marked,
  markedBy: marked ? { userId: "u", name: "Meena", at: "2026-11-18T03:00:00.000Z" } : null,
});

const mineRow = (n: number, subject: string | null, role: "class_teacher" | "subject_teacher" = "subject_teacher"): MyTeaching[number] => ({
  assignmentId: uuid(500 + n),
  role,
  effectiveTo: null,
  sectionId: uuid(n),
  sectionName: "A",
  classId: uuid(100 + n),
  className: `Class ${n}`,
  subjectId: subject ? uuid(900 + subject.length) : null,
  subjectName: subject,
});

const paper = (n: number, subject: string, entered: number, students = 30, examDate = "2026-11-10"): HomePaper => ({
  examId: uuid(700),
  examName: "Half-yearly",
  scheduleId: uuid(800 + n),
  sectionId: uuid(n),
  sectionName: "A",
  className: `Class ${n}`,
  subjectId: uuid(900 + subject.length),
  subjectName: subject,
  examDate,
  students,
  entered,
});

describe("your attendance", () => {
  it("keeps only the caller's sections, in the branch's order", () => {
    const own = ownSections([mineRow(2, "Maths"), mineRow(1, "Maths")], [day(1, 0), day(2, 0), day(3, 0)]);
    expect(own.map((d) => d.sectionId)).toEqual([uuid(1), uuid(2)]);
  });

  it("one section is the big card, several a list, all marked one line", () => {
    expect(attendanceMode([], null)).toBe("none");
    expect(attendanceMode([day(1, 0)], "working")).toBe("single");
    expect(attendanceMode([day(1, 0), day(2, 30)], null)).toBe("list");
    expect(attendanceMode([day(1, 30), day(2, 30)], null)).toBe("done");
    expect(attendanceMode([day(1, 30)], null)).toBe("done");
  });

  it("a holiday or weekend replaces the card with the day card", () => {
    expect(attendanceMode([day(1, 0)], "holiday")).toBe("dayOff");
    expect(attendanceMode([day(1, 0)], "weekend")).toBe("dayOff");
    expect(attendanceMode([day(1, 0)], "exam_day")).toBe("single");
  });

  it("folds the marked sections from six on", () => {
    const five = attendanceList([day(1, 0), day(2, 30), day(3, 30), day(4, 30), day(5, 30)]);
    expect(five.waiting).toHaveLength(1);
    expect(five.marked).toHaveLength(4);
    expect(five.folded).toBe(0);

    const seven = attendanceList([day(1, 0), day(2, 0), day(3, 30), day(4, 30), day(5, 30), day(6, 30), day(7, 30)]);
    expect(seven.waiting).toHaveLength(2);
    expect(seven.marked).toHaveLength(0);
    expect(seven.folded).toBe(5);
  });
});

describe("you teach", () => {
  const mine = [mineRow(6, "Maths"), mineRow(7, "Science"), mineRow(6, null, "class_teacher"), mineRow(8, "Maths")];

  it("pairs leave out the class-teacher row and label sections short", () => {
    const pairs = teachingPairs(mine);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]?.label).toBe("6-A");
  });

  it("groups by subject and by class", () => {
    const pairs = teachingPairs(mine);
    expect(bySubject(pairs).map((g) => [g.subjectName, g.pairs.length])).toEqual([
      ["Maths", 2],
      ["Science", 1],
    ]);
    const grid = byClass(pairs);
    expect(grid.subjects.map((s) => s.subjectName)).toEqual(["Maths", "Science"]);
    expect(grid.rows.map((r) => r.label)).toEqual(["6-A", "7-A", "8-A"]);
    expect(grid.rows[1]?.cells.has(grid.subjects[0]!.subjectId)).toBe(false);
  });

  it("states a pair's marks in one word", () => {
    const [maths6] = teachingPairs(mine);
    expect(pairState(maths6!, [], "2026-11-18")).toEqual({ kind: "none", text: null });
    expect(pairState(maths6!, [paper(6, "Maths", 30)], "2026-11-18").kind).toBe("done");
    expect(pairState(maths6!, [paper(6, "Maths", 12)], "2026-11-18")).toEqual({ kind: "due", text: "12/30" });
    expect(pairState(maths6!, [paper(6, "Maths", 0, 30, "2026-12-02")], "2026-11-18").kind).toBe("notYet");
  });

  it("counts papers done and lists the rest by date", () => {
    const p = paperProgress([paper(6, "Maths", 30), paper(7, "Science", 3, 30, "2026-11-12"), paper(8, "Maths", 0, 30, "2026-11-09")], "2026-11-18");
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.left.map((x) => x.examDate)).toEqual(["2026-11-09", "2026-11-12"]);
  });
});

describe("waiting on you", () => {
  it("sorts by urgency, then the caller's own work first", () => {
    const sorted = sortWaiting([
      { key: "gaps", kind: "admin", urgency: 2 },
      { key: "marks", kind: "teaching", urgency: 2 },
      { key: "cheque", kind: "admin", urgency: 0 },
    ] as const);
    expect(sorted.map((i) => i.key)).toEqual(["cheque", "marks", "gaps"]);
  });

  it("shows tags only when there are both kinds", () => {
    expect(showWaitingTags([{ key: "a", kind: "teaching", urgency: 1 }])).toBe(false);
    expect(
      showWaitingTags([
        { key: "a", kind: "teaching", urgency: 1 },
        { key: "b", kind: "admin", urgency: 1 },
      ]),
    ).toBe(true);
  });
});

describe("page order", () => {
  it("teaching sits above the school until the caller's sections are marked", () => {
    const before = pageOrder(false);
    const after = pageOrder(true);
    expect(before.indexOf("youTeach")).toBeLessThan(before.indexOf("schoolToday"));
    expect(after.indexOf("youTeach")).toBeGreaterThan(after.indexOf("schoolToday"));
    expect(before[0]).toBe("dayCard");
    expect(after.at(-1)).toBe("comingUp");
  });
});

describe("formatting", () => {
  it("greets by the hour", () => {
    expect(greetingFor(8)).toBe("Good morning");
    expect(greetingFor(14)).toBe("Good afternoon");
    expect(greetingFor(19)).toBe("Good evening");
  });

  it("uses the first name", () => {
    expect(firstName(" Anita  Das ")).toBe("Anita");
    expect(firstName(null)).toBe("");
  });

  it("shortens money the Indian way", () => {
    expect(shortMoney("850.00")).toBe("₹850");
    expect(shortMoney("48250.00")).toBe("₹48.3k");
    expect(shortMoney("112000")).toBe("₹1.12L");
    expect(shortMoney("23000000")).toBe("₹2.3Cr");
  });

  it("refuses to divide by nothing", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(394, 448)).toBe(88);
  });
});
