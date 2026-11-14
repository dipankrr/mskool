import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import "../../i18n";
import { useFormat } from "../../i18n/format";
import type { MonthDay } from "../../lib/attendance";
import { addDays, bookieSays, isoOf, lookAhead, todayAttendance, todayStory, tonightPlan } from "../../lib/home";
import type { TonightRow } from "../../lib/home";
import type { PortalItem } from "../../lib/homework";
import { FamilyThemeProvider } from "../../theme";
import { FHeader, FScreen, FSegment } from "../../ui";
import { BookieLine } from "./bookie-line";
import { Today } from "./today";
import { Tomorrow } from "./tomorrow";
import { Bag, Tonight } from "./tonight";
import type { Home, Paper } from "./use-home";

/**
 * Dev-only: Home's sections on sample data, one kind of evening at a time, so
 * every state can be looked at without arranging it in a database. The rules
 * are the real ones (`lib/home.ts`); only the data is made up. Ticks work;
 * rows that open a homework page lead nowhere here.
 */
export function FamilyHomePreview() {
  return (
    <FamilyThemeProvider>
      <Preview />
    </FamilyThemeProvider>
  );
}

const DAYS = ["busy", "done", "exam", "absent", "holiday"] as const;
type Day = (typeof DAYS)[number];

function at(base: Date, addDay: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDay, hour, 0);
}

// Dates travel as strings on the wire; the rules take either, and Dates keep the samples readable.
type Over = { [K in keyof PortalItem]?: PortalItem[K] | Date };

function sample(now: Date, id: string, over: Over): PortalItem {
  return {
    studentAssignmentId: id,
    kind: "homework",
    comesBack: "sent",
    gradingMode: "none",
    maxMarks: null,
    title: id,
    book: null,
    subjectName: "Mathematics",
    teacherName: "Mrs. Rao",
    estimatedMinutes: null,
    givenAt: at(now, -2, 11),
    dueAt: at(now, 1, 8),
    closeAt: at(now, 1, 8),
    word: "to_do",
    checkStatus: null,
    marks: null,
    grade: null,
    remark: null,
    hasNote: false,
    isNew: false,
    newReplies: 0,
    canUntick: true,
    ...over,
  } as unknown as PortalItem;
}

function sampleItems(day: Day, now: Date): PortalItem[] {
  const worksheet = sample(now, "worksheet", { title: "Fractions worksheet", estimatedMinutes: 20, givenAt: at(now, 0, 11) });
  const chapter = sample(now, "chapter", { title: "Read chapter 4", kind: "reading", comesBack: "tick", subjectName: "English", estimatedMinutes: 15 });
  const poem = sample(now, "poem", { title: "Learn the poem", comesBack: "none", subjectName: "Hindi", estimatedMinutes: 10 });
  const chart = sample(now, "chart", { title: "Plant chart", kind: "project", comesBack: "brought", subjectName: "Science" });
  const drawing = sample(now, "drawing", { title: "Drawing book", comesBack: "brought", subjectName: "Art" });
  const checked = sample(now, "checked", {
    title: "Parts of a flower",
    subjectName: "Science",
    word: "checked",
    gradingMode: "marks",
    marks: "9.00",
    maxMarks: "10.00",
    hasNote: true,
    isNew: true,
    dueAt: at(now, -1, 8),
    closeAt: at(now, -1, 8),
  });
  switch (day) {
    case "busy":
      return [worksheet, chapter, poem, chart, drawing, checked];
    case "done":
      return [{ ...worksheet, word: "sent" }, { ...chapter, word: "sent" }, { ...poem, word: "sent" }, chart, drawing];
    case "exam":
      return [
        sample(now, "revise", { title: "Revise chapters 4 and 5", comesBack: "none", estimatedMinutes: 40 }),
        sample(now, "practice", { title: "Practice paper 2", kind: "quiz", comesBack: "questions", estimatedMinutes: 30 }),
      ];
    case "absent":
      return [
        worksheet,
        sample(now, "notes", { title: "Copy today's notes", comesBack: "tick", subjectName: "Science", givenAt: at(now, 0, 12) }),
        sample(now, "redo", { title: "Map of India", subjectName: "Social Science", word: "redo", hasNote: true, isNew: true }),
      ];
    case "holiday":
      return [{ ...checked, marks: null, gradingMode: "remark", remark: "excellent", hasNote: false }];
  }
}

function sampleDays(day: Day, today: string): MonthDay[] {
  const tomorrow = addDays(today, 1);
  const school = (date: string, over: Partial<MonthDay> = {}): MonthDay => ({
    date,
    dayType: "working",
    label: null,
    enrolled: true,
    status: "present",
    ...over,
  });
  return [
    school(today, { status: day === "absent" ? "absent" : "present" }),
    school(tomorrow, {
      status: null,
      dayType: day === "holiday" ? "holiday" : day === "exam" ? "exam_day" : "working",
      label: day === "holiday" ? "Founder's Day" : null,
    }),
    school(addDays(today, 2), { status: null }),
  ];
}

const settled = <T,>(data: T | undefined) => ({ data, isPending: false, isError: false, refetch: () => undefined });

function Preview() {
  const { t } = useTranslation("kit");
  const format = useFormat();
  const [day, setDay] = useState<Day>("busy");
  /** Rows toggled by hand in this preview, per day. */
  const [flips, setFlips] = useState<Record<string, boolean>>({});
  const now = useMemo(() => new Date(), []);
  const today = isoOf(now);

  const home = useMemo<Home>(() => {
    const base = sampleItems(day, now);
    const localTicks = new Set<string>();
    const items = base.map((item) => {
      const flipped = flips[`${day}:${item.studentAssignmentId}`];
      if (flipped === undefined) return item;
      if (item.comesBack === "brought" || item.comesBack === "none") {
        if (flipped) localTicks.add(item.studentAssignmentId);
        return item;
      }
      return { ...item, word: flipped ? ("sent" as const) : ("to_do" as const) };
    });
    // On the finished day the bag starts packed.
    if (day === "done") {
      for (const item of items) {
        if (item.comesBack === "brought" && flips[`${day}:${item.studentAssignmentId}`] !== false) {
          localTicks.add(item.studentAssignmentId);
        }
      }
    }
    const days = sampleDays(day, today);
    const ahead = lookAhead(days, today);
    const until = ahead.next?.date ?? addDays(today, 1);
    const plan = tonightPlan(items, now, until, localTicks);
    const attendanceToday = todayAttendance(days, today);
    const papers: Paper[] =
      day === "exam"
        ? [
            {
              subjectName: "Mathematics",
              subjectCode: null,
              examDate: until,
              startTime: "10:00",
              durationMinutes: 120,
              venue: "Room 12",
              parts: [],
              maxMarks: null,
            },
          ]
        : [];
    const exam: Home["exam"] =
      day === "exam"
        ? { id: "exam", name: "Half-yearly", examType: "regular", term: null, firstDate: until, lastDate: until, state: "upcoming", paperCount: 6 }
        : undefined;
    return {
      now,
      today,
      ahead,
      plan,
      story: todayStory(items, now),
      attendanceToday,
      exam,
      papers,
      papersPending: false,
      says: bookieSays({
        plan: { ...plan, bagTotal: plan.bag.length },
        ahead,
        examSubject: papers[0]?.subjectName ?? null,
        exam: { on: false, inDays: null },
        absentToday: attendanceToday.kind === "status" && attendanceToday.status === "absent",
      }),
      saysReady: true,
      toggleRow: (row: TonightRow) =>
        setFlips((current) => ({ ...current, [`${day}:${row.item.studentAssignmentId}`]: !row.done })),
      tickFailed: false,
      homework: settled(items),
      overview: settled(undefined),
      fees: settled(undefined),
      exams: settled(exam ? [exam] : []),
      thisMonth: { isPending: false },
    };
  }, [day, flips, now, today]);

  return (
    <FScreen testID="family-home-preview" header={<FHeader title={format.date(today, "weekdayDayMonth")} />}>
      <FSegment
        testID="preview-day"
        options={DAYS.map((value) => ({ key: value, label: t(`home.${value}`) }))}
        value={day}
        onChange={setDay}
      />
      <BookieLine home={home} />
      <Tonight home={home} />
      <Bag home={home} />
      <Tomorrow home={home} />
      <Today home={home} />
    </FScreen>
  );
}
