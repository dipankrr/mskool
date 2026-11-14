import { addDays, bookieSays, dayKind, lookAhead, subjectsDue, todayAttendance, todayStory, tonightPlan } from "./home";
import type { MonthDay } from "./attendance";
import type { PortalItem } from "./homework";

const NOW = new Date(2026, 10, 16, 18, 40); // Mon 16 Nov 2026, 6:40 pm
const TODAY = "2026-11-16";

type Over = { [K in keyof PortalItem]?: PortalItem[K] | Date } & { id: string };

function item(over: Over): PortalItem {
  const { id, ...rest } = over;
  return {
    studentAssignmentId: id,
    kind: "homework",
    comesBack: "sent",
    gradingMode: "none",
    maxMarks: null,
    title: id,
    book: null,
    subjectName: "Maths",
    teacherName: "Mrs. Rao",
    estimatedMinutes: null,
    givenAt: new Date(2026, 10, 14),
    dueAt: new Date(2026, 10, 17, 8, 0),
    closeAt: new Date(2026, 10, 17, 8, 0),
    word: "to_do",
    checkStatus: null,
    marks: null,
    grade: null,
    remark: null,
    hasNote: false,
    canUntick: false,
    isNew: false,
    newReplies: 0,
    ...rest,
  } as unknown as PortalItem;
}

function day(date: string, over: Partial<MonthDay> = {}): MonthDay {
  return { date, dayType: "working", label: null, enrolled: true, status: null, ...over };
}

describe("days", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("takes a day the school has not filled in as school, except Sunday", () => {
    expect(dayKind(undefined, "2026-11-17")).toBe("school");
    expect(dayKind(undefined, "2026-11-22")).toBe("weekend");
    expect(dayKind({ dayType: "working" }, "2026-11-22")).toBe("school");
  });

  it("finds the next school day past a holiday and a Sunday", () => {
    const sat = "2026-11-21";
    const ahead = lookAhead([day("2026-11-22", { dayType: "weekend" }), day("2026-11-23", { dayType: "holiday", label: "Founder's Day" })], sat);
    expect(ahead.tomorrow).toEqual({ date: "2026-11-22", kind: "weekend", label: null });
    expect(ahead.next).toEqual({ date: "2026-11-24", kind: "school", daysAway: 3 });
  });

  it("keeps the holiday's name for tomorrow", () => {
    const ahead = lookAhead([day("2026-11-17", { dayType: "holiday", label: "Founder's Day" })], TODAY);
    expect(ahead.tomorrow.label).toBe("Founder's Day");
    expect(ahead.next?.daysAway).toBe(2);
  });

  it("has no next school day in a long break", () => {
    const days = Array.from({ length: 12 }, (_, i) => day(addDays(TODAY, i + 1), { dayType: "holiday" }));
    expect(lookAhead(days, TODAY).next).toBeNull();
  });
});

describe("tonightPlan", () => {
  const until = "2026-11-17";

  it("lists work due by the next school day and leaves later work out", () => {
    const plan = tonightPlan(
      [item({ id: "tomorrow" }), item({ id: "friday", dueAt: new Date(2026, 10, 20, 8) })],
      NOW,
      until,
      new Set(),
    );
    expect(plan.work.map((r) => r.item.studentAssignmentId)).toEqual(["tomorrow"]);
    expect(plan).toMatchObject({ total: 1, left: 1 });
  });

  it("keeps work finished for those days as done, and drops older finished work", () => {
    const plan = tonightPlan(
      [
        item({ id: "open" }),
        item({ id: "sent", word: "sent" }),
        item({ id: "old", word: "checked", dueAt: new Date(2026, 10, 13, 8) }),
      ],
      NOW,
      until,
      new Set(),
    );
    expect(plan.work.map((r) => [r.item.studentAssignmentId, r.done])).toEqual([
      ["open", false],
      ["sent", true],
    ]);
    expect(plan).toMatchObject({ total: 2, left: 1 });
  });

  it("still shows open work that is past due", () => {
    const plan = tonightPlan([item({ id: "late", dueAt: new Date(2026, 10, 15, 8) })], NOW, until, new Set());
    expect(plan.left).toBe(1);
  });

  it("puts bring-to-class work in the bag, ticked only on the phone", () => {
    const items = [item({ id: "chart", comesBack: "brought" }), item({ id: "sum" })];
    const before = tonightPlan(items, NOW, until, new Set());
    expect(before.work.map((r) => r.item.studentAssignmentId)).toEqual(["sum"]);
    expect(before.bag.map((r) => [r.item.studentAssignmentId, r.done, r.action])).toEqual([["chart", false, "local"]]);
    expect(tonightPlan(items, NOW, until, new Set(["chart"])).bagLeft).toBe(0);
  });

  it("uses a phone tick for homework that sends nothing back", () => {
    const items = [item({ id: "practice", comesBack: "none" })];
    expect(tonightPlan(items, NOW, until, new Set()).left).toBe(1);
    expect(tonightPlan(items, NOW, until, new Set(["practice"])).left).toBe(0);
  });

  it("picks the action from what comes back", () => {
    const plan = tonightPlan(
      [item({ id: "a", comesBack: "tick" }), item({ id: "b", kind: "quiz" }), item({ id: "c" })],
      NOW,
      until,
      new Set(),
    );
    expect(Object.fromEntries(plan.work.map((r) => [r.item.studentAssignmentId, r.action]))).toEqual({
      a: "tick",
      b: "quiz",
      c: "send",
    });
  });

  it("keeps a finished row in its place", () => {
    const plan = tonightPlan(
      [item({ id: "first", word: "sent" }), item({ id: "second", dueAt: new Date(2026, 10, 17, 9) })],
      NOW,
      until,
      new Set(),
    );
    expect(plan.work.map((r) => r.item.studentAssignmentId)).toEqual(["first", "second"]);
  });

  it("puts a redo first and adds up the minutes left", () => {
    const plan = tonightPlan(
      [
        item({ id: "a", estimatedMinutes: 20 }),
        item({ id: "redo", word: "redo", estimatedMinutes: 10, dueAt: new Date(2026, 10, 17, 9) }),
        item({ id: "sent", word: "sent", estimatedMinutes: 30 }),
      ],
      NOW,
      until,
      new Set(),
    );
    expect(plan.work[0]?.item.studentAssignmentId).toBe("redo");
    expect(plan.minutes).toBe(30);
    expect(plan.hasRedo).toBe(true);
  });

  it("skips missed and over work", () => {
    expect(tonightPlan([item({ id: "m", word: "missed" }), item({ id: "o", word: "over" })], NOW, until, new Set()).total).toBe(0);
  });
});

describe("subjectsDue", () => {
  it("names each subject once, in due order", () => {
    const items = [
      item({ id: "a", subjectName: "English", dueAt: new Date(2026, 10, 17, 10) }),
      item({ id: "b", subjectName: "Maths", dueAt: new Date(2026, 10, 17, 8) }),
      item({ id: "c", subjectName: "Maths", dueAt: new Date(2026, 10, 17, 9) }),
      item({ id: "d", subjectName: "Hindi", dueAt: new Date(2026, 10, 18, 9) }),
    ];
    expect(subjectsDue(items, "2026-11-17")).toEqual(["Maths", "English"]);
  });
});

describe("today", () => {
  it("reads today's mark, a day off, or nothing yet", () => {
    expect(todayAttendance([day(TODAY, { status: "present" })], TODAY)).toEqual({ kind: "status", status: "present" });
    expect(todayAttendance([day(TODAY, { dayType: "holiday", label: "Diwali" })], TODAY)).toEqual({
      kind: "off",
      day: "holiday",
      label: "Diwali",
    });
    expect(todayAttendance([day(TODAY)], TODAY)).toEqual({ kind: "none" });
    expect(todayAttendance([], TODAY)).toEqual({ kind: "none" });
  });

  it("tells given today, came back, and replies apart", () => {
    const story = todayStory(
      [
        item({ id: "given", givenAt: new Date(2026, 10, 16, 11) }),
        item({ id: "back", word: "checked", isNew: true, newReplies: 1 }),
        item({ id: "reply", newReplies: 2 }),
        item({ id: "quiet" }),
      ],
      NOW,
    );
    expect(story.given.map((i) => i.studentAssignmentId)).toEqual(["given"]);
    expect(story.back.map((i) => i.studentAssignmentId)).toEqual(["back"]);
    expect(story.replies.map((i) => i.studentAssignmentId)).toEqual(["reply"]);
  });
});

describe("bookieSays", () => {
  const tomorrowSchool = lookAhead([], TODAY);
  const base = {
    ahead: tomorrowSchool,
    examSubject: null,
    exam: { on: false, inDays: null },
    absentToday: false,
  };
  const plan = (over: Partial<Parameters<typeof bookieSays>[0]["plan"]>) => ({
    total: 3,
    left: 3,
    bagLeft: 0,
    bagTotal: 0,
    hasRedo: false,
    ...over,
  });

  it("counts down as the work gets done", () => {
    expect(bookieSays({ ...base, plan: plan({}) })).toEqual({ mood: "calm", line: "things", count: 3 });
    expect(bookieSays({ ...base, plan: plan({ left: 2 }) })).toEqual({ mood: "calm", line: "goodStart", count: 2 });
    expect(bookieSays({ ...base, plan: plan({ left: 1 }) })).toEqual({ mood: "happy", line: "oneMore" });
  });

  it("asks for the bag, then cheers when both are done", () => {
    expect(bookieSays({ ...base, plan: plan({ left: 0, bagLeft: 2, bagTotal: 2 }) })).toEqual({
      mood: "happy",
      line: "bagNext",
      count: 2,
    });
    expect(bookieSays({ ...base, plan: plan({ left: 0, bagTotal: 2 }) })).toEqual({ mood: "cheer", line: "allSetTomorrow" });
  });

  it("puts an exam on the next school day first while work is left", () => {
    expect(bookieSays({ ...base, examSubject: "Maths", plan: plan({}) })).toEqual({
      mood: "focus",
      line: "examTomorrow",
      subject: "Maths",
    });
    expect(bookieSays({ ...base, examSubject: "Maths", plan: plan({ left: 0 }) }).mood).toBe("cheer");
  });

  it("worries about a redo and about a missed day", () => {
    expect(bookieSays({ ...base, plan: plan({ hasRedo: true }) }).line).toBe("redo");
    expect(bookieSays({ ...base, absentToday: true, plan: plan({}) }).line).toBe("missedToday");
  });

  it("on a quiet night talks about exams, a day off, or nothing", () => {
    const quiet = plan({ total: 0, left: 0 });
    expect(bookieSays({ ...base, plan: quiet })).toEqual({ mood: "happy", line: "nothing" });
    expect(bookieSays({ ...base, plan: quiet, exam: { on: false, inDays: 4 } })).toEqual({
      mood: "focus",
      line: "examsSoon",
      count: 4,
    });
    const holiday = lookAhead([day("2026-11-17", { dayType: "holiday" })], TODAY);
    expect(bookieSays({ ...base, ahead: holiday, plan: quiet })).toEqual({ mood: "sleepy", line: "noSchool" });
  });
});
