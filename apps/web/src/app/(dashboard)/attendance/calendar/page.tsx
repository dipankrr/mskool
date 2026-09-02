"use client";

import { CalendarPlusIcon, ChevronLeftIcon, ChevronRightIcon, Link2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import {
  DayOverrideDialog,
} from "@/features/attendance/day-override-dialog";
import {
  GenerateCalendarDialog,
} from "@/features/attendance/generate-calendar-dialog";
import {
  useCalendar,
  useCalendarMutations,
} from "@/features/attendance/use-attendance";
import { AttendanceTabs } from "@/features/attendance/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { buildMonthGrid, GRID_WEEKDAYS, sessionMonths } from "@/lib/calendar-grid";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";
import type { CalendarDay } from "@/lib/trpc/types";

/**
 * THE MARKING GATE, MADE VISIBLE. The academic calendar is what makes
 * "working days" honest and attendance marking possible at all — this
 * screen is where a school creates it (generate once per session, then
 * carve out holidays) and where anyone can see why a date refuses marking.
 *
 * Two views over one dataset: MONTH walks with the chevrons and costs one
 * month of rows per fetch; FULL YEAR lays out every month of the session at
 * once — the term-planner's answer to "when are the holidays, end to end" —
 * by omitting the month filter, which the API reads as "whole year". Both
 * render the same day cells; clicking a day (when the caller holds
 * `attendance:update`) opens the override dialog — including setting a
 * holiday ON a generated working day, which is the calendar's whole editing
 * model.
 */

const WEEKDAY_INDEX_TO_KEY = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * A calendar month is mostly working days, so the eye needs the EXCEPTIONS
 * to pop, not the baseline: working days stay near-neutral, and the four
 * exception types get distinct hue families — green (working), red
 * (holiday), amber (half day), muted-grey (weekend), blue (exam) — at tint
 * strength, never solid fills a whole month grid would turn into noise.
 * Every entry carries both a light and a dark pair, and each holds a
 * distinctive ring/border tone the compact year view's smaller cells can
 * still tell apart at a glance.
 */
const DAY_TYPE_STYLES: Record<CalendarDay["dayType"], string> = {
  working:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  holiday:
    "border-red-300 bg-red-100 text-red-950 dark:border-red-800 dark:bg-red-950/70 dark:text-red-100",
  half_day:
    "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100",
  weekend:
    "border-transparent bg-muted/60 text-muted-foreground dark:bg-muted/30",
  exam_day:
    "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-800 dark:bg-sky-950/70 dark:text-sky-100",
};

function initialMonthFromSession(
  session: { startDate: string; endDate: string } | undefined,
): { year: number; month: number } | null {
  if (!session) return null;
  const today = todayIso();
  // The real current month if the session covers it; the session's opening
  // month otherwise. A session the calendar does not reach yet still opens
  // on a sensible month.
  const iso =
    today >= session.startDate && today <= session.endDate ? today : session.startDate;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return { year, month };
}

function monthLabel(year: number, month: number, style: "long" | "short"): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One month's grid — the weekday header, then the day cells. `compact` is
 * the full-year view's miniature: same cells, no type labels (the colour
 * and the indicator dot carry the day type), smaller bodies. Both sizes
 * read the same `dayByDate` map, so an override made anywhere shows
 * everywhere.
 *
 * Every cell carries an indicator dot in the day type's own colour — the
 * month view's labels are readable, but the compact grid's pattern
 * recognition happens at dot level, and the shared dot is what makes the
 * two views read as the same calendar.
 */
function CalendarGrid({
  year,
  month,
  dayByDate,
  canConfigure,
  compact,
  onPick,
}: {
  year: number;
  month: number;
  dayByDate: Map<string, CalendarDay>;
  canConfigure: boolean;
  compact: boolean;
  onPick: (date: string) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const today = todayIso();

  // A one-line census under the month's name: the planner's glance question
  // is "how many working days are left", and counting by eye is the UX this
  // replaces. Only rendered outside compact (the year view keeps the
  // header lean); only counting types that actually occur.
  const census = useMemo(() => {
    const counts = new Map<CalendarDay["dayType"], number>();
    for (const week of weeks) {
      for (const iso of week) {
        if (iso === null) continue;
        const day = dayByDate.get(iso);
        if (day) counts.set(day.dayType, (counts.get(day.dayType) ?? 0) + 1);
      }
    }
    return counts;
  }, [weeks, dayByDate]);

  return (
    <div className="flex flex-col gap-1">
      {!compact ? (
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-tight">
          {(Object.keys(copy.attendance.dayTypes) as CalendarDay["dayType"][])
            .filter((type) => (census.get(type) ?? 0) > 0)
            .map((type) => (
              <span key={type}>
                {census.get(type)} {copy.attendance.dayTypes[type]}
              </span>
            ))}
          {census.size === 0 ? <span>No calendar rows yet</span> : null}
        </div>
      ) : null}
      <div className={`grid grid-cols-7 ${compact ? "gap-1" : "gap-1.5"}`}>
        {GRID_WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className={`text-muted-foreground py-1 text-center font-medium ${
              compact ? "text-[10px]" : "text-xs"
            }`}
          >
            {copy.attendance.weekdays[WEEKDAY_INDEX_TO_KEY[weekday]]}
          </div>
        ))}
        {weeks.flat().map((iso, index) => {
          if (iso === null) return <div key={`blank-${index}`} aria-hidden />;
          const day = dayByDate.get(iso);
          const isToday = iso === today;
          const cell = (
            <button
              key={iso}
              type="button"
              onClick={canConfigure ? () => onPick(iso) : undefined}
              disabled={!canConfigure}
              title={
                day
                  ? [
                      `${formatIsoDate(iso)} — ${copy.attendance.dayTypes[day.dayType]}`,
                      day.reason ?? undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : `${formatIsoDate(iso)} — no calendar row`
              }
              className={`flex flex-col items-center justify-center gap-0.5 border p-1 transition-colors ${
                compact ? "h-8 rounded-md text-xs" : "h-16 rounded-lg text-sm"
              } ${
                day
                  ? DAY_TYPE_STYLES[day.dayType]
                  : "border-dashed text-muted-foreground"
              } ${canConfigure ? "hover:border-primary/50" : ""} ${
                isToday ? "ring-2 ring-primary/50" : ""
              }`}
            >
              <span className="font-medium">{Number(iso.slice(8, 10))}</span>
              {!compact && day && day.dayType !== "working" ? (
                <span className="truncate text-[10px] leading-none">
                  {copy.attendance.dayTypes[day.dayType]}
                  {day.reason ? ` · ${day.reason}` : ""}
                </span>
              ) : null}
              {day && day.dayType !== "working" && day.dayType !== "weekend" ? (
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    day.dayType === "holiday"
                      ? "bg-red-500"
                      : day.dayType === "half_day"
                        ? "bg-amber-500"
                        : "bg-sky-500"
                  }`}
                />
              ) : null}
            </button>
          );
          return canConfigure ? (
            cell
          ) : (
            <div key={iso} className="contents">
              {cell}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayTypeLegend() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
      {(Object.keys(copy.attendance.dayTypes) as CalendarDay["dayType"][]).map(
        (type) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className={`inline-block size-2.5 rounded-sm border ${DAY_TYPE_STYLES[type]}`}
            />
            {copy.attendance.dayTypes[type]}
          </span>
        ),
      )}
    </div>
  );
}

export default function AttendanceCalendarPage() {
  const { has, activeSession } = useActiveContext();
  const { generate, upsertDay } = useCalendarMutations();

  const [mode, setMode] = useState<"month" | "year">("month");
  const [view, setView] = useState<{ year: number; month: number } | null>(null);
  useEffect(() => {
    if (view === null) setView(initialMonthFromSession(activeSession));
  }, [view, activeSession]);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);

  const canConfigure = has("attendance:update");

  const yearId = activeSession?.id ?? "";
  // Month view fetches one month; full year omits the filter (the whole
  // year). Distinct query keys, so switching is cache-warm in both directions.
  const calendar = useCalendar(
    yearId,
    mode === "month" ? (view?.month ?? 1) : undefined,
  );

  const dayByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of calendar.data ?? []) map.set(day.date, day);
    return map;
  }, [calendar.data]);

  const overrideDay = overrideDate ? dayByDate.get(overrideDate) : undefined;

  // The header action is CONTEXTUAL, not constant: before generation the
  // calendar is empty and the button is the primary "Generate calendar";
  // after it, generation is done and the same dialog only fills MISSING
  // dates (a mid-session date-range extension, an ungenerated transfer
  // year), so the button relabels to say exactly that. An ever-present
  // "Generate" after generation reads as "this will edit my calendar" —
  // which it won't, and the wording is the only thing that says so.
  const hasCalendarRows = (calendar.data?.length ?? 0) > 0;

  const shiftMonth = (delta: number) => {
    setView((current) => {
      if (!current) return current;
      const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
  };

  const months = useMemo(
    () => (activeSession ? sessionMonths(activeSession) : []),
    [activeSession],
  );

  // The chevrons walk the SESSION, not the calendar in general: there is no
  // April 2026 to see for a 2025-26 year, and a view showing empty months
  // beyond the session reads as a bug ("where is the data?"), not as a
  // boundary. First and last session month disable the respective arrow.
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const atFirst = !view || !firstMonth || (view.year === firstMonth.year && view.month === firstMonth.month);
  const atLast = !view || !lastMonth || (view.year === lastMonth.year && view.month === lastMonth.month);

  if (!activeSession) {
    return (
      <>
        <PageHeader title={copy.attendance.title} description={copy.attendance.subtitle} />
        <EmptyState
          icon={CalendarPlusIcon}
          title={copy.attendance.title}
          description={copy.attendance.noSession}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={copy.attendance.title}
        description={copy.attendance.subtitle}
        actions={
          <div className="flex items-center gap-2">
          <Link
            href="/attendance/policy"
            className={buttonVariants({ variant: "outline" })}
          >
            <Link2Icon data-icon="inline-start" />
            {copy.attendance.policyLink}
          </Link>
          <PermissionGate permission="attendance:update">
            <Button
              variant={hasCalendarRows ? "outline" : "default"}
              onClick={() => setGenerateOpen(true)}
            >
              <CalendarPlusIcon data-icon="inline-start" />
              {hasCalendarRows ? copy.attendance.fillGaps : copy.attendance.generate}
            </Button>
          </PermissionGate>
          </div>
        }
      />

      <AttendanceTabs />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-16 items-center gap-1">
              {mode === "month" ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous month"
                    disabled={atFirst}
                    onClick={() => shiftMonth(-1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next month"
                    disabled={atLast}
                    onClick={() => shiftMonth(1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </>
              ) : null}
            </div>
            <div className="text-center">
              <div className="font-medium">
                {mode === "month" && view ? monthLabel(view.year, view.month, "long") : activeSession.name}
              </div>
              {mode === "month" ? (
                <div className="text-muted-foreground text-xs">{activeSession.name}</div>
              ) : null}
            </div>
            <div className="flex min-w-16 items-center justify-end gap-1">
              <Button
                variant={mode === "month" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={mode === "month"}
                onClick={() => setMode("month")}
              >
                {copy.attendance.viewMonth}
              </Button>
              <Button
                variant={mode === "year" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={mode === "year"}
                onClick={() => setMode("year")}
              >
                {copy.attendance.viewYear}
              </Button>
            </div>
          </div>

          {calendar.isLoading ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              {copy.common.loading}
            </div>
          ) : (calendar.data ?? []).length === 0 ? (
            <EmptyState
              icon={CalendarPlusIcon}
              title={copy.attendance.noCalendarTitle}
              description={copy.attendance.noCalendarBody}
              action={
                <PermissionGate permission="attendance:update">
                  <Button onClick={() => setGenerateOpen(true)}>
                    {copy.attendance.generate}
                  </Button>
                </PermissionGate>
              }
            />
          ) : mode === "month" && view ? (
            <>
              <CalendarGrid
                year={view.year}
                month={view.month}
                dayByDate={dayByDate}
                canConfigure={canConfigure}
                compact={false}
                onPick={setOverrideDate}
              />
              <DayTypeLegend />
            </>
          ) : (
            <>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {months.map(({ year, month }) => (
                  <div key={`${year}-${month}`} className="flex flex-col gap-1.5">
                    <div className="text-sm font-medium">
                      {monthLabel(year, month, "short")}
                    </div>
                    <CalendarGrid
                      year={year}
                      month={month}
                      dayByDate={dayByDate}
                      canConfigure={canConfigure}
                      compact
                      onPick={setOverrideDate}
                    />
                  </div>
                ))}
              </div>
              <DayTypeLegend />
            </>
          )}
        </CardContent>
      </Card>

      <GenerateCalendarDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        pending={generate.isPending}
        onSubmit={(workingWeekdays, halfDayWeekdays) => {
          generate.submit(yearId, workingWeekdays, halfDayWeekdays);
          setGenerateOpen(false);
        }}
      />

      <DayOverrideDialog
        open={overrideDate !== null}
        onOpenChange={(open) => {
          if (!open) setOverrideDate(null);
        }}
        day={overrideDay}
        date={overrideDate ?? ""}
        pending={upsertDay.isPending}
        onSubmit={(input) => {
          upsertDay.submit({ academicYearId: yearId, ...input });
          setOverrideDate(null);
        }}
      />
    </>
  );
}
