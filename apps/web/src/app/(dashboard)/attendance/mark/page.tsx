"use client";

import { CalendarOffIcon, CheckCheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

/**
 * THE MARKING SCREEN — one section, one date, the roster with a status per
 * student.
 *
 * **The calendar gate is rendered, not just enforced.** The selected date's
 * day type comes from the same month fetch the calendar screen uses, and the
 * three refusals (holiday, weekend, no row) render as non-editable
 * explanations with the translateErrors wording — the server refuses anyway;
 * this is the UX, never the authority.
 *
 * **The day pre-fills from the authoritative layer** (`attendance.status`):
 * a re-mark starts from what was marked, not from blank. Past-date edits ask
 * for an optional correction reason (ADR-030's frontend convention) which is
 * attached to the entries whose status CHANGED; same-day marking never asks.
 *
 * **Period-wise schools get a period picker** (the mode comes from the
 * policy; a daily school never sees it). Callers without
 * `attendance:create` get the read-only day view — the same screen, controls
 * absent, which is the subject-teacher's read cell from the smoke matrix.
 */
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

  // Pre-fill from the authoritative layer when the day or section changes:
  // an already-marked day starts from its statuses, not from blank.
  useEffect(() => {
    const next = new Map<string, Status>();
    for (const pair of enrollments.data ?? []) {
      if (pair.enrollment.sectionId !== sectionId) continue;
      const marked = dayStatuses.data?.find((s) => s.studentId === pair.student.id);
      next.set(pair.student.id, (marked?.status as Status) ?? "absent");
    }
    setEntries(next);
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStatuses.data, sectionId, date]);

  const rosterRows = useMemo(
    () =>
      (enrollments.data ?? []).filter(
        (pair) => pair.enrollment.sectionId === sectionId,
      ),
    [enrollments.data, sectionId],
  );

  const dayType = calendarDay?.dayType;
  const holidayRefusal =
    dayType === "holiday"
      ? copy.attendance.marking.holidayNote
      : dayType === "weekend"
        ? copy.attendance.marking.weekendNote
        : !calendarDay
          ? copy.attendance.marking.noCalendarNote
          : undefined;

  const setStatus = (studentId: string, status: Status) =>
    setEntries((current) => new Map(current).set(studentId, status));

  const markAll = (status: Status) =>
    setEntries(new Map(rosterRows.map((pair) => [pair.student.id, status as Status])));

  const submit = async () => {
    // The correction reason rides only on entries whose status CHANGED from
    // what the authoritative layer holds — an unchanged row has no edit to
    // explain.
    const existing = new Set(
      (dayStatuses.data ?? []).map((s) => `${s.studentId}:${s.status}`),
    );
    try {
      await mark.submit({
        sectionId,
        date,
        ...(periodWise && periodId ? { periodId } : {}),
        entries: rosterRows.map((pair) => {
          const status = entries.get(pair.student.id) ?? "absent";
          const changed = !existing.has(`${pair.student.id}:${status}`);
          return {
            studentId: pair.student.id,
            status,
            ...(date < todayIso() && changed && reason.trim()
              ? { correctionReason: reason.trim() }
              : {}),
          };
        }),
      });
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

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <Field className="min-w-48">
            <FieldLabel htmlFor="mark-section">{copy.attendance.marking.section}</FieldLabel>
            <Select value={sectionId || undefined} onValueChange={(v) => setSectionId(v ?? "")}>
              <SelectTrigger id="mark-section">
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

          <Field className="min-w-40">
            <FieldLabel htmlFor="mark-date">{copy.attendance.marking.date}</FieldLabel>
            <Input
              id="mark-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>

          {periodWise ? (
            <Field className="min-w-44">
              <FieldLabel htmlFor="mark-period">{copy.attendance.marking.period}</FieldLabel>
              <Select
                value={periodId || undefined}
                onValueChange={(v) => setPeriodId(v ?? "")}
                disabled={!sectionId}
              >
                <SelectTrigger id="mark-period" disabled={!sectionId}>
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
              <FieldDescription>{copy.attendance.marking.periodHelp}</FieldDescription>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      {!sectionId ? (
        <div className="text-muted-foreground mt-6 text-sm">{copy.common.required}</div>
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
        <Card className="mt-4">
          <CardContent className="pt-6">
            {(dayStatuses.data ?? []).length > 0 ? (
              <p className="text-muted-foreground mb-3 text-xs">
                {copy.attendance.marking.alreadyMarked}
              </p>
            ) : null}

            {canMark ? (
              <div className="mb-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => markAll("present")}>
                  <CheckCheckIcon data-icon="inline-start" />
                  {copy.attendance.marking.markAllPresent}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => markAll("absent")}>
                  <XIcon data-icon="inline-start" />
                  {copy.attendance.marking.markAllAbsent}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground mb-3 text-sm">
                {copy.attendance.marking.readOnlyNote}
              </p>
            )}

            <div className="divide-y">
              {rosterRows.map((pair) => {
                const status = entries.get(pair.student.id) ?? "absent";
                return (
                  <div
                    key={pair.student.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {[
                          pair.student.firstName,
                          pair.student.middleName,
                          pair.student.lastName,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {pair.student.admissionNumber}
                      </span>
                    </div>
                    {canMark ? (
                      <Select
                        value={status}
                        onValueChange={(v) => setStatus(pair.student.id, v as Status)}
                      >
                        <SelectTrigger
                          className="w-36"
                          aria-label={pair.student.admissionNumber}
                        >
                          <SelectValue>{(v: string | null) => v ?? ""}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {copy.attendance.marking.statuses[s]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">
                        {copy.attendance.marking.statuses[status]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {canMark && date < todayIso() ? (
              <div className="mt-4 max-w-md">
                <Field>
                  <FieldLabel htmlFor="mark-reason">
                    {copy.attendance.marking.correctionReason}
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
              <div className="mt-4">
                <Button
                  onClick={() => void submit()}
                  disabled={mark.isPending || (periodWise && !periodId)}
                >
                  {mark.isPending ? copy.common.saving : copy.attendance.marking.title}
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
