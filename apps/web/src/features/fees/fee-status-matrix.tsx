"use client";

import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  Clock3Icon,
  MinusIcon,
  TablePropertiesIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterField, FilterRow } from "@/features/fees/fee-filters";
import { FeeStatus } from "@/features/fees/fee-status";
import { moneyCellClass } from "@/features/fees/fee-styles";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import {
  collectionPercent,
  isCurrentMonth,
  isFutureMonth,
  matrixRowBalance,
  settlementPercent,
} from "@/features/fees/matrix-helpers";
import { useFeeMatrixCell, useFeeMatrixList } from "@/features/fees/use-fee-matrix";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { formatIsoDate, todayIso } from "@/lib/format";
import { addMoney, compareMoney, formatMoney } from "@/lib/money";
import type {
  Class,
  FeeMatrixCell,
  FeeMatrixCellInput,
  FeeMatrixList,
  FeeMatrixListInput,
  FeeMatrixMonth,
  FeeMatrixRow,
  Section,
} from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;
const ALL = "all";

type MatrixView = NonNullable<FeeMatrixListInput["view"]>;
type MatrixSort = NonNullable<FeeMatrixListInput["sort"]>;

type SelectedCell = {
  studentId: string;
  studentName: string;
  month: string;
  monthLabel: string;
};

type MatrixCellQuery = ReturnType<typeof useFeeMatrixCell>;

const VIEW_OPTIONS: ReadonlyArray<{ value: MatrixView; label: string }> = [
  { value: "all", label: copy.fees.matrix.filters.views.all },
  { value: "attention", label: copy.fees.matrix.filters.views.attention },
  { value: "unpaid", label: copy.fees.matrix.filters.views.unpaid },
  { value: "partial", label: copy.fees.matrix.filters.views.partial },
  { value: "overdue", label: copy.fees.matrix.filters.views.overdue },
  { value: "paid", label: copy.fees.matrix.filters.views.paid },
  { value: "notGenerated", label: copy.fees.matrix.filters.views.notGenerated },
];

const SORT_OPTIONS: ReadonlyArray<{ value: MatrixSort; label: string }> = [
  { value: "student", label: copy.fees.matrix.filters.sorts.student },
  { value: "balance", label: copy.fees.matrix.filters.sorts.balance },
  { value: "oldestDue", label: copy.fees.matrix.filters.sorts.oldestDue },
];

function MatrixPaymentIcon({ state }: { state: FeeMatrixCell["paymentState"] }) {
  if (state === "no_fee") return <MinusIcon aria-hidden="true" />;
  if (state === "unpaid") return <CircleAlertIcon aria-hidden="true" />;
  if (state === "partial") return <CircleDashedIcon aria-hidden="true" />;
  if (state === "conceded") return <BadgeCheckIcon aria-hidden="true" />;
  return <CheckCircle2Icon aria-hidden="true" />;
}

function matrixPaymentClass(state: FeeMatrixCell["paymentState"]): string {
  if (state === "unpaid") {
    return "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-100";
  }
  if (state === "partial") {
    return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100";
  }
  if (state === "paid") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100";
  }
  if (state === "conceded") {
    return "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-100";
  }
  return "border-border bg-muted/50 text-muted-foreground";
}

function MatrixPaymentBadge({
  state,
  className,
}: {
  state: FeeMatrixCell["paymentState"];
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("max-w-full gap-1 px-1.5 text-[10px]", matrixPaymentClass(state), className)}
    >
      <MatrixPaymentIcon state={state} />
      <span className="truncate">{copy.fees.matrix.paymentStates[state]}</span>
    </Badge>
  );
}

function MatrixTiming({ state }: { state: FeeMatrixCell["timingState"] }) {
  if (state === "none") return null;
  const Icon =
    state === "overdue"
      ? AlertTriangleIcon
      : state === "due"
        ? Clock3Icon
        : CalendarClockIcon;
  const className =
    state === "overdue"
      ? "text-destructive"
      : state === "due"
        ? "text-amber-700 dark:text-amber-300"
        : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", className)}>
      <Icon aria-hidden="true" />
      {copy.fees.matrix.timingStates[state]}
    </span>
  );
}

function MatrixGenerationBadge({ state }: { state: FeeMatrixRow["generationState"] }) {
  return (
    <Badge variant="outline" className="w-fit px-1.5 text-[10px] text-muted-foreground">
      {copy.fees.matrix.generationStates[state]}
    </Badge>
  );
}

function MatrixOpening({ row }: { row: FeeMatrixRow }) {
  if (row.openingBalance.status === "none") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <span aria-hidden="true">—</span>
        {copy.fees.matrix.openingStates.none}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className={cn("text-sm font-medium", moneyCellClass)}>
        {formatMoney(row.openingBalance.balance)}
      </span>
      <FeeStatus kind="openingBalance" status={row.openingBalance.status} />
    </span>
  );
}

function MatrixRowStatus({
  row,
  includeOpening = true,
}: {
  row: FeeMatrixRow;
  includeOpening?: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <span className="text-muted-foreground text-[10px] tabular-nums">
        {copy.fees.matrix.labels.sessionFees}: {formatMoney(row.totals.netAmount)}
      </span>
      <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
        <span className="text-muted-foreground text-[10px]">
          {copy.fees.matrix.labels.sessionStatus}
        </span>
        <MatrixPaymentBadge state={row.paymentState} />
      </div>
      <MatrixTiming state={row.timingState} />
      {includeOpening ? (
        <span className="text-muted-foreground text-[10px]">
          {copy.fees.matrix.labels.openingStatus}: {copy.fees.matrix.openingStates[row.openingBalance.status]}
        </span>
      ) : null}
    </div>
  );
}

function MatrixCellButton({
  studentName,
  month,
  cell,
  currentMonth,
  onOpen,
  compact = false,
}: {
  studentName: string;
  month: FeeMatrixMonth;
  cell: FeeMatrixCell;
  currentMonth: string;
  onOpen: () => void;
  compact?: boolean;
}) {
  const noFee = cell.paymentState === "no_fee";
  const current = isCurrentMonth(month.key, currentMonth);
  const future = isFutureMonth(month.key, currentMonth);
  const percent = settlementPercent(cell.netAmount, cell.paidAmount);
  const statusText = `${copy.fees.matrix.paymentStates[cell.paymentState]}${
    cell.timingState === "none"
      ? ""
      : ` · ${copy.fees.matrix.timingStates[cell.timingState]}`
  }`;
  const ariaLabel = `${studentName}, ${month.label}: ${statusText}. ${copy.fees.matrix.labels.net} ${formatMoney(
    cell.netAmount,
  )}; ${copy.fees.matrix.labels.paid} ${formatMoney(cell.paidAmount)}; ${copy.fees.matrix.labels.balance} ${formatMoney(
    cell.balanceAmount,
  )}.`;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onOpen}
      aria-label={ariaLabel}
      className={cn(
        "flex h-auto min-h-[88px] w-full min-w-0 shrink flex-col items-stretch justify-start gap-1 rounded-lg border border-transparent p-2 text-left whitespace-normal",
        "hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
        compact && "min-h-[76px]",
        current && "bg-primary/5 ring-1 ring-primary/20",
        future && "bg-muted/20",
        cell.timingState === "overdue" && "bg-rose-50/50 dark:bg-rose-950/20",
      )}
    >
      {compact ? (
        <span className="text-muted-foreground text-[10px] font-medium">
          {month.label}
          {current ? ` · ${copy.fees.matrix.labels.current}` : ""}
        </span>
      ) : null}
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          noFee ? "text-muted-foreground" : moneyCellClass,
        )}
      >
        {noFee ? <span aria-hidden="true">—</span> : formatMoney(cell.netAmount)}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {noFee ? (
          <span className="text-muted-foreground text-[10px] font-medium">
            {copy.fees.matrix.paymentStates.no_fee}
          </span>
        ) : (
          <MatrixPaymentBadge state={cell.paymentState} />
        )}
        <MatrixTiming state={cell.timingState} />
      </span>
      <span aria-hidden="true" className="mt-auto block h-[3px] w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            noFee ? "bg-muted-foreground/30" : "bg-primary",
          )}
          style={{ width: `${percent.toString()}%` }}
        />
      </span>
    </Button>
  );
}

function MatrixFilters({
  search,
  onSearchChange,
  classId,
  onClassChange,
  sectionId,
  onSectionChange,
  view,
  onViewChange,
  sort,
  onSortChange,
  classes,
  sections,
  sectionsLoading,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  classId: string | undefined;
  onClassChange: (value: string | null) => void;
  sectionId: string | undefined;
  onSectionChange: (value: string | null) => void;
  view: MatrixView;
  onViewChange: (value: MatrixView) => void;
  sort: MatrixSort;
  onSortChange: (value: MatrixSort) => void;
  classes: Class[];
  sections: Section[];
  sectionsLoading: boolean;
}) {
  const classNameById = useMemo(
    () => new Map(classes.map((item) => [item.id, item.name])),
    [classes],
  );
  const sectionNameById = useMemo(
    () => new Map(sections.map((item) => [item.id, item.name])),
    [sections],
  );

  return (
    <FilterRow className="mb-4">
      <FilterField label={copy.fees.matrix.filters.search} className="min-w-56 flex-1 sm:max-w-sm">
        <Input
          id="fee-matrix-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={copy.fees.matrix.filters.searchPlaceholder}
          aria-label={copy.fees.matrix.filters.search}
        />
      </FilterField>
      <FilterField label={copy.fees.matrix.filters.class}>
        <Select
          value={classId ?? ALL}
          onValueChange={onClassChange}
        >
          <SelectTrigger className="w-44" aria-label={copy.fees.matrix.filters.class}>
            <SelectValue>
              {(value: string | null) => {
                if (!value || value === ALL) return copy.fees.matrix.filters.allClasses;
                return classNameById.get(value) ?? copy.common.none;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>{copy.fees.matrix.filters.allClasses}</SelectItem>
              {classes.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label={copy.fees.matrix.filters.section}>
        <Select
          value={sectionId ?? ALL}
          onValueChange={onSectionChange}
          disabled={!classId}
        >
          <SelectTrigger className="w-40" aria-label={copy.fees.matrix.filters.section}>
            <SelectValue>
              {(value: string | null) => {
                if (!classId) return copy.fees.matrix.filters.selectClassFirst;
                if (sectionsLoading) return copy.common.loading;
                return !value || value === ALL
                  ? copy.fees.matrix.filters.allSections
                  : (sectionNameById.get(value) ?? copy.common.none);
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>{copy.fees.matrix.filters.allSections}</SelectItem>
              {sections.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label={copy.fees.matrix.filters.view}>
        <Select
          value={view}
          onValueChange={(value) => onViewChange((value ?? "all") as MatrixView)}
        >
          <SelectTrigger className="w-44" aria-label={copy.fees.matrix.filters.view}>
            <SelectValue>
              {(value: string | null) =>
                VIEW_OPTIONS.find((option) => option.value === value)?.label ??
                copy.fees.matrix.filters.allViews}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {VIEW_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label={copy.fees.matrix.filters.sort}>
        <Select
          value={sort}
          onValueChange={(value) => onSortChange((value ?? "student") as MatrixSort)}
        >
          <SelectTrigger className="w-40" aria-label={copy.fees.matrix.filters.sort}>
            <SelectValue>
              {(value: string | null) =>
                SORT_OPTIONS.find((option) => option.value === value)?.label ??
                copy.fees.matrix.filters.sorts.student}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>
    </FilterRow>
  );
}

function MatrixLoading() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true">
      <span className="sr-only">{copy.common.loading}</span>
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="rounded-xl border p-3">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="flex items-center gap-3" key={index}>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatrixPagination({
  pageInfo,
  onPageChange,
}: {
  pageInfo: FeeMatrixList["pageInfo"];
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        {copy.fees.matrix.labels.pageSummary(pageInfo.page, pageInfo.totalPages)}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!pageInfo.hasPreviousPage}
          onClick={() => onPageChange(pageInfo.page - 1)}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          {copy.fees.matrix.labels.previous}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!pageInfo.hasNextPage}
          onClick={() => onPageChange(pageInfo.page + 1)}
        >
          {copy.fees.matrix.labels.next}
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

function MatrixEmpty({
  hasEnrolledStudents,
  hasFilters,
  onClearFilters,
}: {
  hasEnrolledStudents: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  if (!hasEnrolledStudents && !hasFilters) {
    return (
      <EmptyState
        icon={TablePropertiesIcon}
        title={copy.fees.matrix.noStudentsTitle}
        description={copy.fees.matrix.noStudentsBody}
      />
    );
  }
  return (
    <EmptyState
      icon={TablePropertiesIcon}
      title={copy.fees.matrix.noMatchesTitle}
      description={copy.fees.matrix.noMatchesBody}
      action={
        hasFilters ? (
          <Button type="button" variant="outline" onClick={onClearFilters}>
            {copy.common.clear}
          </Button>
        ) : null
      }
    />
  );
}

function MatrixMobile({
  matrix,
  currentMonth,
  onOpen,
}: {
  matrix: FeeMatrixList;
  currentMonth: string;
  onOpen: (row: FeeMatrixRow, month: FeeMatrixMonth) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {matrix.rows.map((row) => {
        const cellsByMonth = new Map(row.cells.map((cell) => [cell.month, cell]));
        return (
          <article key={row.studentId} className="rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/students/${row.studentId}`}
                  className="font-medium hover:underline"
                >
                  {row.studentName}
                </Link>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.admissionNumber} · {row.className}
                  {row.sectionName ? ` · ${row.sectionName}` : ""}
                </p>
                <MatrixGenerationBadge state={row.generationState} />
              </div>
              <div className="shrink-0 text-right">
                <p className="text-muted-foreground text-[10px]">
                  {copy.fees.matrix.labels.balanceIncludingOpening}
                </p>
                <p className="text-base font-semibold tabular-nums">
                  {formatMoney(matrixRowBalance(row))}
                </p>
              </div>
            </div>
            <div className="mt-3 border-t pt-3">
              <MatrixRowStatus row={row} includeOpening={false} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <span className="text-muted-foreground text-xs">
                {copy.fees.matrix.labels.opening}
              </span>
              <MatrixOpening row={row} />
            </div>
            <div className="mt-3 border-t pt-3">
              <h3 className="mb-2 text-xs font-medium">{copy.fees.matrix.labels.month}</h3>
              <ul className="grid grid-cols-2 gap-2">
                {matrix.months.map((month) => {
                  const cell = cellsByMonth.get(month.key);
                  if (!cell) return null;
                  return (
                    <li key={month.key}>
                      <MatrixCellButton
                        compact
                        studentName={row.studentName}
                        month={month}
                        cell={cell}
                        currentMonth={currentMonth}
                        onOpen={() => onOpen(row, month)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MatrixDesktop({
  matrix,
  currentMonth,
  onOpen,
}: {
  matrix: FeeMatrixList;
  currentMonth: string;
  onOpen: (row: FeeMatrixRow, month: FeeMatrixMonth) => void;
}) {
  const summaryByMonth = useMemo(
    () => new Map(matrix.monthSummaries.map((summary) => [summary.month, summary])),
    [matrix.monthSummaries],
  );

  return (
    <div className="hidden md:block [&_[data-slot=table-container]]:max-h-[70vh] [&_[data-slot=table-container]]:overflow-auto">
      <div className="rounded-xl border">
        <Table className="min-w-[1500px]">
          <TableCaption className="sr-only">{copy.fees.matrix.title}</TableCaption>
          <TableHeader className="sticky top-0 z-30 bg-background">
            <TableRow>
              <TableHead
                scope="col"
                className="sticky left-0 z-40 w-56 min-w-56 bg-background"
              >
                {copy.fees.matrix.labels.student}
              </TableHead>
              <TableHead
                scope="col"
                className="sticky left-56 z-40 w-36 min-w-36 bg-background"
              >
                {copy.fees.matrix.labels.class}
              </TableHead>
              <TableHead scope="col" className="w-28 min-w-28 text-right">
                {copy.fees.matrix.labels.opening}
              </TableHead>
              {matrix.months.map((month) => {
                const summary = summaryByMonth.get(month.key);
                const percent = summary
                  ? collectionPercent(summary.paidAmount, summary.netAmount)
                  : null;
                const hasAssessed = summary
                  ? compareMoney(summary.assessedAmount, "0.00") > 0
                  : false;
                const current = isCurrentMonth(month.key, currentMonth);
                const future = isFutureMonth(month.key, currentMonth);
                return (
                  <TableHead
                    scope="col"
                    key={month.key}
                    className={cn(
                      "h-auto min-w-32 p-2 text-left",
                      current && "bg-primary/5 text-foreground",
                      future && "text-muted-foreground",
                    )}
                  >
                    <span className="block font-medium">{month.label}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[10px] font-normal">
                      {percent === null
                        ? hasAssessed
                          ? copy.fees.matrix.labels.fullyConceded
                          : copy.fees.matrix.labels.noCollection
                        : `${percent.toString()}% ${copy.fees.matrix.labels.collected}`}
                    </span>
                    {current ? (
                      <Badge variant="secondary" className="mt-1 px-1.5 text-[10px]">
                        {copy.fees.matrix.labels.current}
                      </Badge>
                    ) : null}
                  </TableHead>
                );
              })}
              <TableHead
                scope="col"
                className="sticky right-36 z-40 w-36 min-w-36 bg-background text-right"
              >
                {copy.fees.matrix.labels.balance}
              </TableHead>
              <TableHead
                scope="col"
                className="sticky right-0 z-40 w-36 min-w-36 bg-background"
              >
                {copy.fees.matrix.labels.status}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.rows.map((row) => {
              const cellsByMonth = new Map(row.cells.map((cell) => [cell.month, cell]));
              return (
                <TableRow key={row.studentId}>
                  <TableHead
                    scope="row"
                    className="sticky left-0 z-20 h-auto w-56 min-w-56 bg-background p-3 font-normal"
                  >
                    <Link
                      href={`/students/${row.studentId}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {row.studentName}
                    </Link>
                    <span className="text-muted-foreground mt-1 block truncate text-xs">
                      {row.admissionNumber}
                    </span>
                    <MatrixGenerationBadge state={row.generationState} />
                  </TableHead>
                  <TableCell className="sticky left-56 z-20 w-36 min-w-36 bg-background p-3">
                    <span className="block truncate font-medium">{row.className}</span>
                    <span className="text-muted-foreground mt-1 block truncate text-xs">
                      {row.sectionName ?? copy.common.none}
                    </span>
                  </TableCell>
                  <TableCell className="w-28 min-w-28 p-2 text-right">
                    <MatrixOpening row={row} />
                  </TableCell>
                  {matrix.months.map((month) => {
                    const cell = cellsByMonth.get(month.key);
                    if (!cell) return null;
                    return (
                      <TableCell key={month.key} className="w-32 min-w-32 p-1 align-top">
                        <MatrixCellButton
                          studentName={row.studentName}
                          month={month}
                          cell={cell}
                          currentMonth={currentMonth}
                          onOpen={() => onOpen(row, month)}
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="sticky right-36 z-20 w-36 min-w-36 bg-background p-3 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatMoney(matrixRowBalance(row))}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-[10px]">
                      {copy.fees.matrix.labels.balanceIncludingOpening}
                    </span>
                  </TableCell>
                  <TableCell className="sticky right-0 z-20 w-36 min-w-36 bg-background p-3">
                    <MatrixRowStatus row={row} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MatrixDetailSheet({
  selected,
  query,
  onClose,
}: {
  selected: SelectedCell | null;
  query: MatrixCellQuery;
  onClose: () => void;
}) {
  const cell = query.data;
  const hasBalance = Boolean(cell && compareMoney(cell.balanceAmount, "0.00") > 0);

  return (
    <Sheet
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl"
      >
        <SheetHeader className="border-b p-5">
          <SheetTitle>
            {selected ? `${selected.studentName} · ${selected.monthLabel}` : copy.fees.matrix.title}
          </SheetTitle>
          <SheetDescription>
            {selected
              ? copy.fees.matrix.detail.description(selected.monthLabel)
              : copy.fees.matrix.subtitle}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {query.isLoading ? (
                <div className="flex flex-col gap-3" role="status" aria-busy="true">
                  <span className="sr-only">{copy.fees.matrix.detail.loading}</span>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : query.error ? (
            <EmptyState
              title={copy.fees.matrix.detail.failedTitle}
              description={errorMessage(query.error)}
              action={
                <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                  {copy.common.retry}
                </Button>
              }
            />
          ) : !cell ? (
            <EmptyState
              title={copy.fees.matrix.detail.unavailableTitle}
              description={copy.fees.matrix.detail.unavailableBody}
            />
          ) : cell.paymentState === "no_fee" ? (
            <EmptyState
              title={copy.fees.matrix.detail.noFeeTitle}
              description={copy.fees.matrix.detail.noFeeBody}
            />
          ) : (
            <div className="flex flex-col gap-5">
              <section aria-labelledby="matrix-cell-totals">
                <h2 id="matrix-cell-totals" className="text-sm font-semibold">
                  {copy.fees.matrix.detail.aggregateTitle}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <MatrixPaymentBadge state={cell.paymentState} />
                  <MatrixTiming state={cell.timingState} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3 sm:grid-cols-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground text-xs">
                      {copy.fees.matrix.detail.assessed}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {formatMoney(cell.assessedAmount)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground text-xs">
                      {copy.fees.matrix.detail.concession}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {formatMoney(cell.concessionAmount)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground text-xs">
                      {copy.fees.matrix.detail.net}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {formatMoney(cell.netAmount)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground text-xs">
                      {copy.fees.matrix.detail.paid}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {formatMoney(cell.paidAmount)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground text-xs">
                      {copy.fees.matrix.detail.balance}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {formatMoney(cell.balanceAmount)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground text-xs">
                      {copy.fees.matrix.labels.feeHeads}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {cell.feeHeadCount}
                    </dd>
                  </div>
                </dl>
              </section>
              <section aria-labelledby="matrix-cell-installments">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="matrix-cell-installments" className="text-sm font-semibold">
                    {copy.fees.matrix.labels.installments}
                  </h2>
                  <span className="text-muted-foreground text-xs">
                    {cell.installments.length}
                  </span>
                </div>
                <div className="mt-2 overflow-hidden rounded-lg border sm:hidden">
                  {cell.installments.map((installment) => (
                    <div
                      key={installment.id}
                      className="flex flex-col gap-3 border-b p-3 last:border-b-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{installment.feeHeadName}</p>
                          <p className="text-muted-foreground text-xs">
                            {installment.description ?? copy.fees.matrix.labels.installments}
                          </p>
                        </div>
                        <FeeStatus kind="installment" status={installment.paymentStatus} />
                      </div>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {copy.fees.matrix.detail.dueDate}: {formatIsoDate(installment.dueDate)}
                        {" · "}
                        {copy.fees.matrix.detail.amount}: {formatMoney(installment.amount)}
                        {" · "}
                        {copy.fees.matrix.detail.concession}:{" "}
                        {formatMoney(installment.concessionAmount)}
                      </p>
                      <dl className="grid grid-cols-3 gap-3 border-t pt-3">
                        <div>
                          <dt className="text-muted-foreground text-[10px]">
                            {copy.fees.matrix.detail.net}
                          </dt>
                          <dd className="text-sm font-semibold tabular-nums">
                            {formatMoney(installment.netAmount)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground text-[10px]">
                            {copy.fees.matrix.detail.paidAmount}
                          </dt>
                          <dd className="text-sm font-semibold tabular-nums">
                            {formatMoney(installment.paidAmount)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground text-[10px]">
                            {copy.fees.matrix.detail.balanceAmount}
                          </dt>
                          <dd className="text-sm font-semibold tabular-nums">
                            {formatMoney(installment.balanceAmount)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
                <div className="mt-2 hidden overflow-x-auto rounded-lg border sm:block">
                  <Table className="min-w-[680px]">
                    <TableCaption className="sr-only">
                      {copy.fees.matrix.labels.installments}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{copy.fees.matrix.detail.feeHeads}</TableHead>
                        <TableHead className="text-right">{copy.fees.matrix.detail.net}</TableHead>
                        <TableHead className="text-right">
                          {copy.fees.matrix.detail.paidAmount}
                        </TableHead>
                        <TableHead className="text-right">
                          {copy.fees.matrix.detail.balanceAmount}
                        </TableHead>
                        <TableHead>{copy.fees.matrix.labels.status}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cell.installments.map((installment) => (
                        <TableRow key={installment.id}>
                          <TableCell>
                            <span className="block font-medium">{installment.feeHeadName}</span>
                            <span className="text-muted-foreground block text-xs">
                              {installment.description ?? copy.fees.matrix.labels.installments}
                            </span>
                            <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                              {copy.fees.matrix.detail.dueDate}: {formatIsoDate(installment.dueDate)}
                              {" · "}
                              {copy.fees.matrix.detail.amount}: {formatMoney(installment.amount)}
                              {" · "}
                              {copy.fees.matrix.detail.concession}:{" "}
                              {formatMoney(installment.concessionAmount)}
                            </span>
                          </TableCell>
                          <TableCell className={moneyCellClass}>
                            {formatMoney(installment.netAmount)}
                          </TableCell>
                          <TableCell className={moneyCellClass}>
                            {formatMoney(installment.paidAmount)}
                          </TableCell>
                          <TableCell className={cn("font-medium", moneyCellClass)}>
                            {formatMoney(installment.balanceAmount)}
                          </TableCell>
                          <TableCell>
                            <FeeStatus kind="installment" status={installment.paymentStatus} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
              {selected ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <PermissionGate permission="student:read">
                    <Link
                      href={`/students/${selected.studentId}`}
                      className={buttonVariants({ variant: "outline" })}
                    >
                      {copy.fees.matrix.labels.viewAccount}
                    </Link>
                  </PermissionGate>
                  {hasBalance ? (
                    <PermissionGate permission="fee_payment:create">
                      <Link
                        href={`/fees/collect?studentId=${selected.studentId}`}
                        className={buttonVariants()}
                      >
                        {copy.fees.matrix.labels.collect}
                      </Link>
                    </PermissionGate>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {copy.fees.matrix.labels.nothingToCollect}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function FeeStatusMatrix() {
  const { activeSession, sessionsLoading } = useActiveContext();
  const classes = useClasses();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [classId, setClassId] = useState<string | undefined>();
  const [sectionId, setSectionId] = useState<string | undefined>();
  const [view, setView] = useState<MatrixView>("all");
  const [sort, setSort] = useState<MatrixSort>("student");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const sections = useSections(classId, { enabled: Boolean(activeSession?.id && classId) });
  const currentMonth = todayIso().slice(0, 7);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [activeSession?.id, debouncedSearch, classId, sectionId, view, sort]);

  useEffect(() => {
    setSelected(null);
  }, [activeSession?.id]);

  const listInput: FeeMatrixListInput | undefined = activeSession
    ? {
        academicYearId: activeSession.id,
        page,
        pageSize: PAGE_SIZE,
        sort,
        view,
        ...(classId ? { classId } : {}),
        ...(sectionId ? { sectionId } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      }
    : undefined;
  const matrixQuery = useFeeMatrixList(listInput);

  const cellInput: FeeMatrixCellInput | undefined =
    activeSession && selected
      ? {
          academicYearId: activeSession.id,
          studentId: selected.studentId,
          month: selected.month,
        }
      : undefined;
  const cellQuery = useFeeMatrixCell(cellInput);
  const matrix = matrixQuery.data;

  const hasFilters = Boolean(debouncedSearch || classId || sectionId || view !== "all");
  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setClassId(undefined);
    setSectionId(undefined);
    setView("all");
    setSort("student");
    setPage(1);
  };

  const openCell = (row: FeeMatrixRow, month: FeeMatrixMonth) => {
    setSelected({
      studentId: row.studentId,
      studentName: row.studentName,
      month: month.key,
      monthLabel: month.label,
    });
  };

  if (sessionsLoading) return <MatrixLoading />;
  if (!activeSession) {
    return (
      <EmptyState
        icon={TablePropertiesIcon}
        title={copy.fees.matrix.noSessionTitle}
        description={copy.fees.matrix.noSessionBody}
      />
    );
  }

  return (
    <>
      <MatrixFilters
        search={search}
        onSearchChange={setSearch}
        classId={classId}
        onClassChange={(value) => {
          setClassId(value && value !== ALL ? value : undefined);
          setSectionId(undefined);
          setPage(1);
        }}
        sectionId={sectionId}
        onSectionChange={(value) => {
          setSectionId(value && value !== ALL ? value : undefined);
          setPage(1);
        }}
        view={view}
        onViewChange={(value) => {
          setView(value);
          setPage(1);
        }}
        sort={sort}
        onSortChange={(value) => {
          setSort(value);
          setPage(1);
        }}
        classes={classes.data ?? []}
        sections={sections.data ?? []}
        sectionsLoading={sections.isLoading}
      />
      {matrixQuery.isLoading ? (
        <MatrixLoading />
      ) : matrixQuery.error ? (
        <EmptyState
          icon={TablePropertiesIcon}
          title={copy.fees.matrix.listFailedTitle}
          description={errorMessage(matrixQuery.error)}
          action={
            <Button type="button" variant="outline" onClick={() => void matrixQuery.refetch()}>
              {copy.common.retry}
            </Button>
          }
        />
      ) : !matrix ? (
        <MatrixEmpty
          hasEnrolledStudents={false}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
        />
      ) : matrix.rows.length === 0 ? (
        <>
          <p className="text-muted-foreground mb-4 text-sm tabular-nums">
            {copy.fees.matrix.cohortSummary(
              matrix.cohortTotals.studentCount,
              formatMoney(matrix.cohortTotals.assessedAmount),
              formatMoney(matrix.cohortTotals.paidAmount),
              formatMoney(addMoney(matrix.cohortTotals.balanceAmount, matrix.cohortTotals.openingBalance.balance)),
              matrix.cohortTotals.notGeneratedCount,
            )}
          </p>
          <MatrixEmpty
            hasEnrolledStudents={matrix.cohortTotals.studentCount > 0}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
          />
        </>
      ) : (
        <>
          <p className="text-muted-foreground mb-4 text-sm tabular-nums">
            {copy.fees.matrix.cohortSummary(
              matrix.cohortTotals.studentCount,
              formatMoney(matrix.cohortTotals.assessedAmount),
              formatMoney(matrix.cohortTotals.paidAmount),
              formatMoney(addMoney(matrix.cohortTotals.balanceAmount, matrix.cohortTotals.openingBalance.balance)),
              matrix.cohortTotals.notGeneratedCount,
            )}
          </p>
          <MatrixDesktop matrix={matrix} currentMonth={currentMonth} onOpen={openCell} />
          <MatrixMobile matrix={matrix} currentMonth={currentMonth} onOpen={openCell} />
          <MatrixPagination pageInfo={matrix.pageInfo} onPageChange={setPage} />
        </>
      )}
      <MatrixDetailSheet selected={selected} query={cellQuery} onClose={() => setSelected(null)} />
    </>
  );
}
