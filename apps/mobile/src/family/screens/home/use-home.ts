import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { trpc } from "../../../lib/trpc";
import { monthKeyOf, shiftMonth } from "../../lib/attendance";
import { daysUntil } from "../../lib/exams";
import { addDays, bookieSays, isoOf, lookAhead, todayAttendance, todayStory, tonightPlan } from "../../lib/home";
import type { TonightRow } from "../../lib/home";
import { useLocalTicks } from "../../lib/use-local-ticks";
import { useNow } from "../homework/parts";

type Outputs = inferRouterOutputs<AppRouter>;
export type Exam = Outputs["portalExam"]["schedule"]["list"][number];
export type Paper = Outputs["portalExam"]["schedule"]["detail"]["papers"][number];

/** The exam that is on now, or the soonest one coming. */
export function nextExam(exams: readonly Exam[] | undefined): Exam | undefined {
  return (exams ?? [])
    .filter((exam) => exam.state === "upcoming" || exam.state === "ongoing")
    .sort((a, b) => (a.firstDate ?? "9999").localeCompare(b.firstDate ?? "9999"))[0];
}

/** Days to the next exam: 0 while one is on, null when none is coming. */
export function examDays(exam: Exam | undefined, today: string): number | null {
  if (!exam) return null;
  if (exam.state === "ongoing") return 0;
  return exam.firstDate ? Math.max(0, daysUntil(exam.firstDate, today)) : null;
}

/**
 * Everything Home reads, and what it works out from it. The reads are the
 * same ones the tabs use, so opening a tab from Home is instant.
 */
export function useHome(studentId: string) {
  const enabled = studentId.length > 0;
  const now = useNow();
  const today = isoOf(now);
  const month = monthKeyOf(today);
  // The next school day can sit in next month (the 30th, a Sunday, a holiday).
  const crossesMonth = monthKeyOf(addDays(today, 10)) !== month;

  const homework = trpc.portalHomework.list.useQuery({ studentId, filter: "all" }, { enabled });
  const overview = trpc.portalAttendance.overview.useQuery({ studentId }, { enabled });
  const fees = trpc.portalFees.summary.useQuery({ studentId }, { enabled });
  const exams = trpc.portalExam.schedule.list.useQuery({ studentId }, { enabled });
  const thisMonth = trpc.portalAttendance.month.useQuery({ studentId, month }, { enabled });
  const following = trpc.portalAttendance.month.useQuery(
    { studentId, month: shiftMonth(month, 1) },
    { enabled: enabled && crossesMonth, retry: false },
  );

  const days = useMemo(
    () => [...(thisMonth.data?.days ?? []), ...(following.data?.days ?? [])],
    [thisMonth.data, following.data],
  );
  const ahead = useMemo(() => lookAhead(days, today), [days, today]);
  const until = ahead.next?.date ?? addDays(today, 1);

  const { ticks, toggle } = useLocalTicks(studentId);
  const items = homework.data;
  const plan = useMemo(() => tonightPlan(items ?? [], now, until, ticks), [items, now, until, ticks]);
  const story = useMemo(() => todayStory(items ?? [], now), [items, now]);
  const attendanceToday = useMemo(() => todayAttendance(days, today), [days, today]);

  // The exam with a paper on the next school day, if one covers that date.
  const nextDate = ahead.next?.date ?? null;
  const examThen =
    nextDate === null
      ? undefined
      : (exams.data ?? []).find(
          (exam) =>
            (exam.state === "upcoming" || exam.state === "ongoing") &&
            exam.firstDate !== null &&
            exam.lastDate !== null &&
            exam.firstDate <= nextDate &&
            nextDate <= exam.lastDate,
        );
  const examDetail = trpc.portalExam.schedule.detail.useQuery(
    { studentId, examId: examThen?.id ?? "" },
    { enabled: enabled && examThen !== undefined },
  );
  const papers = useMemo(
    () =>
      (examDetail.data?.papers ?? [])
        .filter((paper) => paper.examDate === nextDate)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [examDetail.data, nextDate],
  );

  const upcoming = nextExam(exams.data);
  const inDays = examDays(upcoming, today);
  const says = bookieSays({
    plan: { ...plan, bagTotal: plan.bag.length },
    ahead,
    examSubject: papers[0]?.subjectName ?? null,
    exam: { on: upcoming?.state === "ongoing", inDays: upcoming?.state === "ongoing" ? null : inDays },
    absentToday: attendanceToday.kind === "status" && attendanceToday.status === "absent",
  });

  // A server tick shows at once; a refusal puts the row back and says so.
  const utils = trpc.useUtils();
  const listInput = { studentId, filter: "all" as const };
  const [tickFailed, setTickFailed] = useState(false);
  const tick = trpc.portalHomework.tick.useMutation({
    onMutate: async (vars) => {
      setTickFailed(false);
      await utils.portalHomework.list.cancel(listInput);
      const before = utils.portalHomework.list.getData(listInput);
      utils.portalHomework.list.setData(listInput, (old) =>
        old?.map((item) =>
          item.studentAssignmentId === vars.studentAssignmentId
            ? { ...item, word: vars.ticked ? ("sent" as const) : ("to_do" as const), canUntick: true }
            : item,
        ),
      );
      return { before };
    },
    onError: (_error, _vars, context) => {
      if (context?.before) utils.portalHomework.list.setData(listInput, context.before);
      setTickFailed(true);
    },
    onSettled: (_data, _error, vars) => {
      void utils.portalHomework.list.invalidate();
      void utils.portalHomework.get.invalidate({ studentId, studentAssignmentId: vars.studentAssignmentId });
    },
  });
  /** Tick or untick a row from Home: on the server for tick homework, on the phone for the rest. */
  const toggleRow = (row: TonightRow) => {
    const id = row.item.studentAssignmentId;
    if (row.action === "local") toggle(id);
    else if (row.action === "tick") tick.mutate({ studentId, studentAssignmentId: id, ticked: !row.done });
  };

  const queries = [homework, overview, fees, exams, thisMonth];
  return {
    now,
    today,
    homework,
    overview,
    fees,
    exams,
    thisMonth,
    ahead,
    plan,
    story,
    attendanceToday,
    exam: examThen,
    papers,
    /** True while the exam covering the next school day is still loading its papers. */
    papersPending: examThen !== undefined && examDetail.isPending,
    says,
    /** Bookie waits for these so the line doesn't flip as reads land. */
    saysReady: !homework.isPending && !thisMonth.isPending && !(examThen !== undefined && examDetail.isPending),
    toggleRow,
    tickFailed,
    refreshing: queries.some((q) => q.isRefetching),
    offline: queries.some((q) => q.isError && q.data !== undefined),
    refetch: () => {
      for (const q of queries) void q.refetch();
      if (crossesMonth) void following.refetch();
      if (examThen) void examDetail.refetch();
    },
  };
}

/** A read as the sections need it. */
type Part<T> = { data: T | undefined; isPending: boolean; isError: boolean; refetch: () => unknown };
type Live = ReturnType<typeof useHome>;

/**
 * What the Home sections draw from. The live screen fills it from the server
 * (`useHome`); the dev preview fills it from sample data.
 */
export type Home = Pick<
  Live,
  | "now"
  | "today"
  | "ahead"
  | "plan"
  | "story"
  | "attendanceToday"
  | "exam"
  | "papers"
  | "papersPending"
  | "says"
  | "saysReady"
  | "toggleRow"
  | "tickFailed"
> & {
  homework: Part<Outputs["portalHomework"]["list"]>;
  overview: Part<Outputs["portalAttendance"]["overview"]>;
  fees: Part<Outputs["portalFees"]["summary"]>;
  exams: Part<Outputs["portalExam"]["schedule"]["list"]>;
  thisMonth: { isPending: boolean };
};
