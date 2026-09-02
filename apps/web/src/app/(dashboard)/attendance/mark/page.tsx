"use client";

import { CheckCircle2Icon, CalendarOffIcon, XIcon, CheckCheckIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClasses } from "@/features/classes/use-classes";
import { AttendanceTabs } from "@/features/attendance/tabs";
import {
  useCalendar,
  useDayStatuses,
  useMarkAttendance,
  usePeriods,
  usePolicy,
} from "@/features/attendance/use-attendance";
import { useSections } from "@/features/sections/use-sections";
import { useStudentEnrollments } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";

const STATUSES = ["present", "absent", "late", "half_day", "on_leave"] as const;
type Status = (typeof STATUSES)[number];

/** Tap cycles through the statuses a marker actually uses, in this order. */
const CYCLE: Status[] = ["present", "absent", "late", "on_leave", "half_day"];

/**
 * The chip colours — the calendar's hue families (emerald present, red
 * absent, amber late, sky on leave, orange half day), declared ONCE here so
 * the roster chips and the colour-key legend can never drift apart.
 */
const CHIP_STYLES: Record<Status, string> = {
  present:
    "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800",
  absent:
    "bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-100 dark:border-red-800",
  late: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
  half_day:
    "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-100 dark:border-orange-800",
  on_leave:
    "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-100 dark:border-sky-800",
};

/**
 * THE MARKING SCREEN — one section, one date, the roster with a status per
 * student. Mobile-first: this is the screen a teacher fills standing in a
 * corridor, one thumb on the phone, so every repeated action is a TAP on a
 * big row — no dropdowns, no scrolling dialogs. The status control is a
 * colour-coded chip that cycles on tap: present → absent → late → on leave
 * → half day. A marker's thumb learns the cycle in a day.
 *
 * **The calendar gate is rendered, not just enforced.** The selected date's
 * day type comes from the same month fetch the calendar screen uses, and
 * the three refusals (holiday, weekend, no row) render as non-editable
 * explanations with the translateErrors wording — the server refuses anyway;
 * this is the UX, never the authority.
 *
 * **The day pre-fills from the authoritative layer** (`attendance.status`):
 * a re-mark starts from what was marked, not from blank, and the screen
 * says DONE above the roster until something changes again.
 *
 * **Past-date corrections ask for a reason only when it is needed**: the
 * reason box appears only on a PAST date AND only when at least one
 * student's status is changing from what was marked — the box names how
 * many are changing, and the reason rides only on the CHANGED entries
 * (same-day marking never asks).
 *
 * **Period-wise schools get a period picker** (the mode comes from the
 * policy; a daily school never sees it). Callers without
 * `attendance:create` get the read-only day view — the same screen, controls
 * absent, which is the principal's read cell from the smoke matrix.
 */

/** One status chip: colour-coded, tap-to-cycle, sized for a thumb. */
function StatusChip({
  status,
  onCycle,
  disabled,
}: {
  status: Status;
  onCycle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onCycle}
      disabled={disabled}
      aria-label={`Change status — currently ${copy.attendance.marking.statusCycle[status]}`}
      className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-semibold transition-transform ${
        disabled ? "opacity-100" : "hover:scale-105 active:scale-95"
      } ${CHIP_STYLES[status]}`}
    >
      {copy.attendance.marking.statusShort[status]}
    </button>
  );
}

export default function MarkAttendancePage() {
  const { has, activeSession } = useActiveContext();
  const sections = useSections();
  const classes = useClasses();
  const enrollments = useStudentEnrollments();
  const { mark } = useMarkAttendance();

  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [periodId, setPeriodId] = useState("");
  const [entries, setEntries] = useState<Map<string, Status>>(new Map());
  const [reason, setReason] = useState("");

  const canMark = has("attendance:create");

  const policy = usePolicy(activeSession?.schoolId ?? "");
  const periodWise = (policy.data?.markingMode ?? "daily") === "period_wise";

  const periods = usePeriods(sectionId);
  const dayStatuses = useDayStatuses(sectionId, date);

  // The month of the selected date, from the fetch the screen shares with
  // the calendar view — one query answers "may this date be marked at all".
  const month = Number(date.slice(5, 7)) || 1;
  const calendar = useCalendar(activeSession?.id ?? "", month);
  const calendarDay = useMemo(
    () => (calendar.data ?? []).find((d) => d.date === date),
    [calendar.data, date],
  );

  const sectionById = useMemo(
    () => new Map((sections.data ?? []).map((s) => [s.id, s])),
    [sections.data],
  );
  const classNameById = useMemo(
    () => new Map((classes.data ?? []).map((c) => [c.id, c.name])),
    [classes.data],
  );
  const sectionLabel = (id: string): string => {
    const section = sectionById.get(id);
    if (!section) return id;
    const className = classNameById.get(section.classId);
    return className ? `${className} · ${section.name}` : section.name;
  };

  /**
   * The roster, in roll order. The service list is already ordered by
   * rollNumber — but a sectioned roster can contain un-numbered admissions
   * (nulls), and ORDER BY puts them FIRST in Postgres, ahead of Roll 1.
   * The re-sort below keeps the numbered rolls 1..n intact and moves the
   * un-numbered to the end, where a marker reaches them deliberately.
   */
  const rosterRows = useMemo(
    () =>
      (enrollments.data ?? [])
        .filter((pair) => pair.enrollment.sectionId === sectionId)
        .slice()
        .sort((a, b) => {
          const ra = a.enrollment.rollNumber;
          const rb = b.enrollment.rollNumber;
          if (ra === null && rb === null)
            return a.student.firstName.localeCompare(b.student.firstName);
          if (ra === null) return 1;
          if (rb === null) return -1;
          return ra.localeCompare(rb, undefined, { numeric: true });
        }),
    [enrollments.data, sectionId],
  );

  /**
   * Pre-fill from the authoritative layer whenever fresh day statuses arrive
   * for a day the teacher has not yet edited. The naive version (prefill on
   * every `dayStatuses.data` change) had two bugs, in opposite directions:
   * a background refetch could silently erase in-progress taps (no
   * protection for edits), and gating on the day key alone made the FIRST
   * load stick with blank defaults when the statuses resolved a tick later
   * (the prefill had "already run" for that key). The `edited` flag is the
   * honest discriminator between the two: once the teacher taps anything,
   * their entries are the truth and no refetch may touch them; before that,
   * every data arrival is a better answer than the blank-day defaults.
   * Submitting clears the flag — the stored marks just became the truth.
   */
  const editedRef = useRef(false);
  const prefillKeyRef = useRef("");
  useEffect(() => {
    const key = `${sectionId}:${date}`;
    if (prefillKeyRef.current !== key) {
      prefillKeyRef.current = key;
      editedRef.current = false;
    }
    if (editedRef.current) return;

    const next = new Map<string, Status>();
    for (const pair of enrollments.data ?? []) {
      if (pair.enrollment.sectionId !== sectionId) continue;
      const marked = dayStatuses.data?.find((s) => s.studentId === pair.student.id);
      next.set(pair.student.id, (marked?.status as Status) ?? "absent");
    }
    setEntries(next);
    setReason("");
  }, [sectionId, date, dayStatuses.data, enrollments.data]);

  const dayType = calendarDay?.dayType;
  const holidayRefusal =
    dayType === "holiday"
      ? copy.attendance.marking.holidayNote
      : dayType === "weekend"
        ? copy.attendance.marking.weekendNote
        : !calendarDay
          ? copy.attendance.marking.noCalendarNote
          : undefined;

  /** Any manual mark makes the teacher's entries the truth; no refetch may
   *  overwrite them until the day changes or a submit resets the flag. */
  const setStatus = (studentId: string, status: Status) => {
    editedRef.current = true;
    setEntries((current) => new Map(current).set(studentId, status));
  };

  const markAll = (status: Status) => {
    editedRef.current = true;
    setEntries(new Map(rosterRows.map((pair) => [pair.student.id, status])));
  };

  /**
   * The statuses the authoritative layer already holds, as a lookup — the
   * baseline for BOTH the live tally (only un-marked statuses count as
   * pending) and the changed-set (a correction reason applies only to
   * entries whose status actually differs).
   */
  const storedByStudent = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of dayStatuses.data ?? []) map.set(row.studentId, row.status);
    return map;
  }, [dayStatuses.data]);

  const dayIsMarked = (dayStatuses.data ?? []).length > 0;
  const isPastDate = date < todayIso();

  /**
   * Who is actually CHANGING relative to the stored marks — the reason's scope
   * AND the DONE derivation. A roster student with no stored row compares as
   * the prefill's own default (absent): a missing row and a stored "absent"
   * are the same answer, so a never-marked student whose chip still reads
   * absent is NOT a pending change — the previous comparison (`undefined !==
   * "absent"`) made every unmarked student permanently "changing", which
   * could never show DONE on a partially-marked day.
   */
  const changingStudents = useMemo(
    () =>
      rosterRows.filter((pair) => {
        const next = entries.get(pair.student.id) ?? "absent";
        const stored = storedByStudent.get(pair.student.id) ?? "absent";
        return stored !== next;
      }),
    [rosterRows, entries, storedByStudent],
  );
  const showReason = canMark && isPastDate && dayIsMarked && changingStudents.length > 0;

  /**
   * DONE, derived — never remembered. The day is done when the authoritative
   * layer holds marks AND nothing on screen differs from them. That is a
   * fact about the DATABASE, so it survives a reload, a revisit tomorrow,
   * and another teacher's browser identically: the "Attendance done" a
   * user sees after a save is the same "Attendance done" anyone sees
   * opening the day fresh. Any edit (chip tap, mark-all) makes a status
   * differ, done goes false, and the screen visibly flips back to editing.
   */
  const dayIsClean = dayIsMarked && changingStudents.length === 0;

  /** The live tally: present / absent / other, counted as the marks stand NOW. */
  const tally = useMemo(() => {
    let present = 0;
    let absent = 0;
    let other = 0;
    for (const pair of rosterRows) {
      const status = entries.get(pair.student.id) ?? "absent";
      if (status === "present") present++;
      else if (status === "absent") absent++;
      else other++;
    }
    return { present, absent, other };
  }, [rosterRows, entries]);

  const submit = async () => {
    // The correction reason rides only on entries whose status CHANGED from
    // what the authoritative layer holds — an unchanged row has no edit to
    // explain, and "which student?" was exactly the old box's problem.
    try {
      await mark.submit({
        sectionId,
        date,
        ...(periodWise && periodId ? { periodId } : {}),
        entries: rosterRows.map((pair) => {
          const status = entries.get(pair.student.id) ?? "absent";
          // Same default as changingStudents: a missing row is an absent.
          const stored = storedByStudent.get(pair.student.id) ?? "absent";
          const changed = stored !== status;
          return {
            studentId: pair.student.id,
            status,
            ...(changed && isPastDate && reason.trim()
              ? { correctionReason: reason.trim() }
              : {}),
          };
        }),
      });
      // The stored marks just became the truth; a refetch confirming them
      // may prefill again (it will match), and the done state derives from
      // the comparison anyway.
      editedRef.current = false;
    } catch {
      // The error toast is shown by the hook.
    }
  };

  if (!activeSession) {
    return (
      <>
        <MarkingHeader />
        <EmptyState
          icon={CalendarOffIcon}
          title={copy.attendance.marking.title}
          description={copy.attendance.noSession}
        />
      </>
    );
  }

  return (
    <>
      <MarkingHeader />

      {/* One compact bar, not a card of full-size fields: the selectors are
          pick-once-per-session controls, not the thing the teacher is here
          to do. Inline fields, horizontal scroll when narrow. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field className="min-w-40 flex-1 sm:flex-none sm:w-48">
          <FieldLabel htmlFor="mark-section" className="text-xs">
            {copy.attendance.marking.section}
          </FieldLabel>
          <Select value={sectionId || undefined} onValueChange={(v) => setSectionId(v ?? "")}>
            <SelectTrigger id="mark-section" className="h-8 text-sm">
              <SelectValue>
                {(value: string | null) =>
                  value ? sectionLabel(value) : copy.common.required
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(sections.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {sectionLabel(section.id)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

          <Field className="w-44">
            <FieldLabel htmlFor="mark-date" className="text-xs">
              {copy.attendance.marking.date}
            </FieldLabel>
            {/* The native input shows the raw ISO date (a browser limit on
                type="date"), so a "Today" pill beside it is what says the
                obvious thing: you are where you almost always are. */}
            <div className="flex items-center gap-2">
              <Input
                id="mark-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-8 w-[7.5rem] text-sm"
              />
              {date === todayIso() ? (
                <Badge variant="secondary" className="shrink-0">
                  {copy.attendance.marking.today}
                </Badge>
              ) : null}
            </div>
          </Field>

        {periodWise ? (
          <Field className="min-w-36 flex-1 sm:flex-none sm:w-44">
            <FieldLabel htmlFor="mark-period" className="text-xs">
              {copy.attendance.marking.period}
            </FieldLabel>
            <Select
              value={periodId || undefined}
              onValueChange={(v) => setPeriodId(v ?? "")}
              disabled={!sectionId}
            >
              <SelectTrigger id="mark-period" className="h-8 text-sm" disabled={!sectionId}>
                <SelectValue>
                  {(value: string | null) =>
                    value
                      ? (periods.data ?? []).find((p) => p.id === value)?.name ??
                        copy.common.none
                      : copy.common.required
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(periods.data ?? []).map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </div>

      {!sectionId ? (
        <div className="text-muted-foreground mt-2 text-sm">{copy.common.required}</div>
      ) : holidayRefusal ? (
        <EmptyState
          icon={CalendarOffIcon}
          title={`${formatIsoDate(date)} ${holidayRefusal}`}
          description={copy.attendance.noCalendarBody}
          action={
            <Link href="/attendance/calendar" className={buttonVariants({ variant: "outline" })}>
              {copy.attendance.title}
            </Link>
          }
        />
      ) : rosterRows.length === 0 ? (
        <EmptyState
          icon={CalendarOffIcon}
          title={copy.attendance.marking.roster}
          description={copy.attendance.marking.notEnrolledInRoster}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            {/* The day's state at a glance: DONE when the stored marks match
                what's on screen, the live tally as the marks stand, the
                colour key for the chips, and the two bulk actions.
                Everything above the roster answers "where am I" without
                reading a single row. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {dayIsClean ? (
                  <Badge className="gap-1 border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
                    <CheckCircle2Icon data-icon="inline-start" />
                    {copy.attendance.marking.doneTitle}
                  </Badge>
                ) : null}
                <span className="text-muted-foreground text-xs font-medium">
                  {copy.attendance.marking.liveCount(tally.present, tally.absent, tally.other)}
                </span>
              </div>
              {canMark ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => markAll("present")}>
                    <CheckCheckIcon data-icon="inline-start" />
                    {copy.attendance.marking.markAllPresent}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => markAll("absent")}>
                    <XIcon data-icon="inline-start" />
                    {copy.attendance.marking.markAllAbsent}
                  </Button>
                </div>
              ) : null}
            </div>

            {/* The chips' colour key — the same hue families the calendar
                legend uses, so one lesson covers both screens. */}
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {CYCLE.map((status) => (
                <span key={status} className="flex items-center gap-1">
                  <span className={`inline-flex size-4 items-center justify-center rounded-sm border text-[9px] font-semibold ${CHIP_STYLES[status]}`}>
                    {copy.attendance.marking.statusShort[status]}
                  </span>
                  {copy.attendance.marking.statusCycle[status]}
                </span>
              ))}
            </div>

            {dayIsClean ? (
              <p className="text-muted-foreground text-xs">
                {copy.attendance.marking.doneHelp}
              </p>
            ) : null}

            {canMark ? null : (
              <p className="text-muted-foreground text-sm">
                {copy.attendance.marking.readOnlyNote}
              </p>
            )}

            {/* The roster: one big tap row per student — roll number, name,
                status chip. Rows stay compact vertically so a class of 40
                fits a phone's thumb-scroll. */}
            <div className="divide-y">
              {rosterRows.map((pair) => {
                const status = entries.get(pair.student.id) ?? "absent";
                const roll = pair.enrollment.rollNumber;
                const fullName = [
                  pair.student.firstName,
                  pair.student.middleName,
                  pair.student.lastName,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div key={pair.student.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-8 shrink-0 text-right text-xs font-medium text-muted-foreground tabular-nums">
                      {roll ?? "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {fullName}
                    </span>
                    {canMark ? (
                      <StatusChip
                        status={status}
                        disabled={false}
                        onCycle={() =>
                          setStatus(
                            pair.student.id,
                            CYCLE[(CYCLE.indexOf(status) + 1) % CYCLE.length]!,
                          )
                        }
                      />
                    ) : (
                      <Badge variant="outline">
                        {copy.attendance.marking.statusCycle[status]}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>

            {showReason ? (
              <div className="mt-1 max-w-md">
                <Field>
                  <FieldLabel htmlFor="mark-reason">
                    {copy.attendance.marking.changedCount(changingStudents.length)}
                  </FieldLabel>
                  <Input
                    id="mark-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                  />
                  <FieldDescription>
                    {copy.attendance.marking.correctionReasonHelp}
                  </FieldDescription>
                </Field>
              </div>
            ) : null}

            {canMark ? (
              <div className="sticky bottom-3 z-10 mt-2">
                {/* The label names the STATE, and the done state disables
                    the button — there is nothing left to save until an edit
                    flips the day back to "not clean". A disabled "Attendance
                    done" is the unambiguous answer to "did I do this?". */}
                <Button
                  className="w-full shadow-lg sm:w-auto sm:min-w-48"
                  size="lg"
                  variant={dayIsClean ? "secondary" : "default"}
                  disabled={
                    mark.isPending || dayIsClean || (periodWise && !periodId)
                  }
                  onClick={() => void submit()}
                >
                  {mark.isPending
                    ? copy.common.saving
                    : dayIsClean
                      ? copy.attendance.marking.doneTitle
                      : copy.attendance.marking.title}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function MarkingHeader() {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {copy.attendance.marking.title}
          </h1>
          <p className="text-muted-foreground text-sm">{copy.attendance.marking.subtitle}</p>
        </div>
        <Link href="/attendance/calendar" className={buttonVariants({ variant: "outline" })}>
          {copy.attendance.title}
        </Link>
      </div>
      <AttendanceTabs />
    </>
  );
}
