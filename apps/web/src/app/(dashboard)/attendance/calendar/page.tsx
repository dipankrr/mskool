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
import { buildMonthGrid, GRID_WEEKDAYS } from "@/lib/calendar-grid";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";
import type { CalendarDay } from "@/lib/trpc/types";

/**
 * THE MARKING GATE, MADE VISIBLE. The calendar is what makes "working days"
 * honest and attendance marking possible at all — this screen is where a
 * school creates it (generate once per session, then carve out holidays)
 * and where anyone can see why a date refuses marking.
 *
 * The month comes from the grid helper (unit-tested, UTC-only, Monday-first);
 * the rows come from `attendance.calendar.list` filtered to the same month.
 * Clicking a day (when the caller holds `attendance:update`) opens the
 * override dialog — including setting a holiday ON a generated working day,
 * which is the calendar's whole editing model.
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

const DAY_TYPE_STYLES: Record<CalendarDay["dayType"], string> = {
  working: "border-transparent bg-primary/5",
  holiday: "border-red-200 bg-red-50 text-red-900 dark:border-red-950 dark:bg-red-950 dark:text-red-200",
  half_day:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-950 dark:bg-amber-950 dark:text-amber-200",
  weekend: "text-muted-foreground bg-muted/50 border-transparent",
  exam_day:
    "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-950 dark:bg-blue-950 dark:text-blue-200",
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

export default function AttendanceCalendarPage() {
  const { has, activeSession } = useActiveContext();
  const { generate, upsertDay } = useCalendarMutations();

  const [view, setView] = useState<{ year: number; month: number } | null>(null);
  useEffect(() => {
    if (view === null) setView(initialMonthFromSession(activeSession));
  }, [view, activeSession]);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);

  const canConfigure = has("attendance:update");

  const yearId = activeSession?.id ?? "";
  const calendar = useCalendar(yearId, view?.month ?? 1);

  const weeks = useMemo(
    () => (view ? buildMonthGrid(view.year, view.month) : []),
    [view],
  );

  const dayByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of calendar.data ?? []) map.set(day.date, day);
    return map;
  }, [calendar.data]);

  const overrideDay = overrideDate ? dayByDate.get(overrideDate) : undefined;

  const shiftMonth = (delta: number) => {
    setView((current) => {
      if (!current) return current;
      const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
  };

  const monthLabel = view
    ? new Date(Date.UTC(view.year, view.month - 1, 1)).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

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
            <Button onClick={() => setGenerateOpen(true)}>
              <CalendarPlusIcon data-icon="inline-start" />
              {copy.attendance.generate}
            </Button>
          </PermissionGate>
          </div>
        }
      />

      <AttendanceTabs />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <div className="text-center">
              <div className="font-medium">{monthLabel}</div>
              {activeSession ? (
                <div className="text-muted-foreground text-xs">{activeSession.name}</div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRightIcon />
            </Button>
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
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1.5">
                {GRID_WEEKDAYS.map((weekday) => (
                  <div
                    key={weekday}
                    className="text-muted-foreground py-1 text-center text-xs font-medium"
                  >
                    {copy.attendance.weekdays[WEEKDAY_INDEX_TO_KEY[weekday]]}
                  </div>
                ))}
                {weeks.flat().map((iso, index) => {
                  if (iso === null) return <div key={`blank-${index}`} aria-hidden />;
                  const day = dayByDate.get(iso);
                  const isToday = iso === todayIso();
                  const cell = (
                    <button
                      type="button"
                      onClick={canConfigure ? () => setOverrideDate(iso) : undefined}
                      disabled={!canConfigure}
                      title={
                        day
                          ? [
                              copy.attendance.dayTypes[day.dayType],
                              day.reason ?? undefined,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : undefined
                      }
                      className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-sm transition-colors ${
                        day
                          ? DAY_TYPE_STYLES[day.dayType]
                          : "border-dashed text-muted-foreground"
                      } ${canConfigure ? "hover:border-primary/50" : ""} ${
                        isToday ? "ring-2 ring-primary/40" : ""
                      }`}
                    >
                      <span className="font-medium">{Number(iso.slice(8, 10))}</span>
                      {day && day.dayType !== "working" ? (
                        <span className="truncate text-[10px] leading-none">
                          {copy.attendance.dayTypes[day.dayType]}
                          {day.reason ? ` · ${day.reason}` : ""}
                        </span>
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
            </>
          )}
        </CardContent>
      </Card>

      <GenerateCalendarDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        pending={generate.isPending}
        onSubmit={(workingWeekdays) => {
          generate.submit(yearId, workingWeekdays);
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
