"use client";

import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, PrinterIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecordPaymentInput } from "@repo/contracts";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { FeesTabs } from "@/features/fees/tabs";
import { FeeStatus } from "@/features/fees/fee-status";
import { moneyCellClass } from "@/features/fees/fee-styles";
import { useFeeDues } from "@/features/fees/use-fee-dues";
import { useCounterMutations } from "@/features/fees/use-fee-counter";
import { useStudent, useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";
import {
  addMoney,
  clampMoney,
  formatMoney,
  fromPaise,
  isMoneyString,
  toPaise,
} from "@/lib/money";
import type { FeeInstallment, FeePayment, Student } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * COLLECT — the desk workflow (spec §§4–12), designed before the rest:
 *
 *   search → account → amount → allocation → method → record → confirmation
 *
 * One obvious amount box; allocation is automatic (oldest first) with a
 * "Change allocation" disclosure for the unusual case; the submit names
 * its total; confirmation is a strong state with receipt + next action.
 *
 * Money rules are structural: the total is a read-only sum of allocation
 * rows (the wire has no `amount`); rows clamp to balances; late fee is
 * never computed here; one idempotency key per attempt; no optimistic
 * updates — refetch after every money mutation.
 */

const SEARCH_DEBOUNCE_MS = 300;

type AllocationRow = { installment: FeeInstallment; amount: string };

const MODES = ["cash", "upi", "cheque", "neft_rtgs", "card", "dd"] as const;
type CollectMode = (typeof MODES)[number];

export default function FeesCollectPage() {
  const { has, activeSession, schoolId, schools } = useActiveContext();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [paying, setPaying] = useState<Student | undefined>();
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  // The amount box's draft. null = empty box (never a prefilled zero).
  const [quickDraft, setQuickDraft] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [mode, setMode] = useState<CollectMode>("cash");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [transactionRef, setTransactionRef] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [clientReference, setClientReference] = useState("");
  const [receipt, setReceipt] = useState<FeePayment | undefined>();
  // Snapshots at submit — the confirmation renders what was collected.
  // Line descriptions ride along because the payment response carries
  // ids + amounts only (server join is the real fix — see
  // docs/FEES-BACKEND-NEEDS.md).
  const [receiptMeta, setReceiptMeta] = useState<
    | {
        studentName: string;
        admissionNumber: string;
        schoolName: string;
        lines: Array<{ id: string; description: string; amount: string }>;
      }
    | undefined
  >();

  const { record } = useCounterMutations();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!clientReference) setClientReference(crypto.randomUUID());
  }, [clientReference]);

  const students = useStudents(debouncedSearch || undefined);
  // No student picked yet → no dues query at all.
  const dues = useFeeDues({
    academicYearId: activeSession?.id,
    studentId: paying?.id,
    enabled: Boolean(paying?.id),
  });

  const openInstallments = useMemo(() => dues.data ?? [], [dues.data]);

  /** Oldest due first — the auto-split order. */
  const openByAge = useMemo(
    () => [...openInstallments].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [openInstallments],
  );

  const totalOutstanding = useMemo(
    () => openByAge.reduce((sum, row) => addMoney(sum, row.balanceAmount), "0.00"),
    [openByAge],
  );

  /** The derived total — the only total this screen has. */
  const total = useMemo(
    () => allocations.reduce((sum, row) => addMoney(sum, row.amount), "0.00"),
    [allocations],
  );

  const hasAmount = allocations.length > 0 && allocations.every((row) => isMoneyString(row.amount));
  const allocatedTotal = hasAmount ? total : "0.00";

  /** Split one amount across the oldest dues first. Valid wire input only. */
  const splitAmount = (raw: string): AllocationRow[] => {
    let remaining = toPaise(raw);
    const rows: AllocationRow[] = [];
    for (const installment of openByAge) {
      if (remaining <= 0n) break;
      const balance = installment.balanceAmount;
      if (!isMoneyString(balance)) continue;
      const take = remaining < toPaise(balance) ? remaining : toPaise(balance);
      if (take > 0n) rows.push({ installment, amount: fromPaise(take) });
      remaining -= take;
    }
    return rows;
  };

  const setQuick = (raw: string) => {
    setQuickDraft(raw);
    setAllocations(isMoneyString(raw) ? splitAmount(raw) : []);
  };

  const collectFull = () => {
    setQuickDraft(null);
    setAllocations(splitAmount(totalOutstanding));
  };

  const setAllocation = (installment: FeeInstallment, raw: string) => {
    setQuickDraft(null);
    setAllocations((rows) => {
      const without = rows.filter((r) => r.installment.id !== installment.id);
      if (!raw) return without;
      if (!isMoneyString(raw)) return [...without, { installment, amount: raw }];
      const cap = clampMoney(raw, "0.00", installment.balanceAmount ?? "0.00");
      return [...without, { installment, amount: cap }];
    });
  };

  const resetAll = () => {
    setPaying(undefined);
    setAllocations([]);
    setQuickDraft(null);
    setAdjustOpen(false);
    setReceipt(undefined);
    setReceiptMeta(undefined);
    setSearch("");
    setMode("cash");
    setTransactionRef("");
    setBankName("");
    setChequeDate("");
    setRemarks("");
    setPaymentDate(todayIso());
    setClientReference(crypto.randomUUID());
  };

  const chooseStudent = useCallback((student: Student) => {
    setPaying(student);
    setAllocations([]);
    setQuickDraft(null);
    setAdjustOpen(false);
    setReceipt(undefined);
    setReceiptMeta(undefined);
    setClientReference(crypto.randomUUID());
  }, []);

  // Deep link: Outstanding's Collect buttons land here with ?studentId=.
  // Read once from the URL (client-only — no prerender suspense needed).
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null);
  useEffect(() => {
    setDeepLinkId(new URLSearchParams(window.location.search).get("studentId"));
  }, []);
  const deepStudent = useStudent(deepLinkId ?? "");
  useEffect(() => {
    if (deepLinkId && deepStudent.data && !paying) {
      chooseStudent(deepStudent.data);
      setDeepLinkId(null);
    }
  }, [deepLinkId, deepStudent.data, paying, chooseStudent]);

  const submit = async () => {
    if (!paying || !hasAmount || !activeSession) return;
    const lines = allocations.map((row) => ({
      id: row.installment.id,
      description: row.installment.description ?? copy.common.none,
      amount: row.amount,
    }));
    const studentName = [paying.firstName, paying.middleName, paying.lastName]
      .filter(Boolean)
      .join(" ");
    const submittedSchoolId = schoolId;
    const input: RecordPaymentInput = {
      studentId: paying.id,
      academicYearId: activeSession.id,
      paymentDate,
      paymentMode: mode,
      allocations: allocations.map((row) => ({
        installmentId: row.installment.id,
        amount: row.amount,
      })),
      ...(transactionRef ? { transactionReference: transactionRef } : {}),
      ...(bankName ? { bankName } : {}),
      ...(chequeDate ? { chequeDate } : {}),
      ...(remarks ? { remarks } : {}),
      clientReference,
    };
    try {
      const payment = await record.submit(input);
      setReceipt(payment);
      setReceiptMeta({
        studentName,
        admissionNumber: paying.admissionNumber,
        schoolName: schools.find((s) => s.id === submittedSchoolId)?.name ?? copy.common.none,
        lines,
      });
      setClientReference(crypto.randomUUID());
      setAllocations([]);
      setQuickDraft(null);
      setTransactionRef("");
      setBankName("");
      setChequeDate("");
      setRemarks("");
      setMode("cash");
    } catch {
      // Refused: the toast carries the server's wording; the panel keeps
      // every value so the cashier corrects and retries with the SAME key.
    }
  };

  return (
    <>
      <PageHeader title={copy.fees.counter.title} description={copy.fees.counter.subtitle} />
      <div className="print:hidden">
        <FeesTabs has={has} />
      </div>

      {receipt ? (
        <Confirmation
          payment={receipt}
          meta={receiptMeta}
          onCollectAnother={resetAll}
        />
      ) : !paying ? (
        <>
          <div className="relative mb-1 max-w-md">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              type="search"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.fees.counter.searchPlaceholder}
              aria-label={copy.fees.counter.searchLabel}
              className="h-12 pl-9 text-base"
            />
          </div>
          <p className="text-muted-foreground mb-4 text-sm">{copy.fees.counter.searchHelp}</p>
          <StudentResults
            students={students.data ?? []}
            isLoading={students.isLoading}
            isSuccess={students.isSuccess}
            onChoose={chooseStudent}
          />
        </>
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          <AccountHeader
            student={paying}
            outstanding={totalOutstanding}
            openCount={openByAge.length}
            onBack={() => {
              setPaying(undefined);
              setAllocations([]);
              setQuickDraft(null);
            }}
          />

          {openInstallments.length === 0 && dues.isSuccess ? (
            <EmptyState
              title={copy.fees.counter.noOpenTitle}
              description={copy.fees.counter.noOpenBody}
            />
          ) : openInstallments.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">{copy.common.loading}</p>
          ) : (
            <>
              <InstallmentList rows={openByAge} />

              <section aria-labelledby="collect-amount">
                <h2 id="collect-amount" className="text-base font-semibold">
                  {copy.fees.counter.amountReceived}
                </h2>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    inputMode="decimal"
                    value={quickDraft ?? ""}
                    onChange={(event) => setQuick(event.target.value)}
                    onBlur={() => {
                      if (quickDraft !== null && !isMoneyString(quickDraft)) setQuickDraft(null);
                    }}
                    placeholder="0.00"
                    aria-label={copy.fees.counter.amountReceived}
                    aria-invalid={quickDraft !== null && !isMoneyString(quickDraft)}
                    className="h-12 flex-1 text-right text-lg"
                  />
                  <Button variant="outline" className="min-h-12" onClick={collectFull}>
                    {copy.fees.counter.collectFull(formatMoney(totalOutstanding))}
                  </Button>
                </div>
                {quickDraft !== null && !isMoneyString(quickDraft) ? (
                  <p className="text-destructive mt-1 text-xs" role="alert">
                    {copy.fees.counter.invalidAmount}
                  </p>
                ) : null}
              </section>

              <AutoAllocation
                lines={allocations.map((row) => ({
                  id: row.installment.id,
                  description: row.installment.description ?? copy.common.none,
                  amount: row.amount,
                }))}
                total={allocatedTotal}
                open={adjustOpen}
                onToggle={() => setAdjustOpen((v) => !v)}
                rows={openByAge}
                allocations={allocations}
                onChange={setAllocation}
              />

              <MethodSelector mode={mode} onChange={setMode} />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-sm font-medium">{copy.fees.counter.paymentDate}</span>
                  <Input
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                  />
                </label>
                {(mode === "cheque" || mode === "dd" || mode === "upi" || mode === "neft_rtgs" || mode === "card") && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-sm font-medium">{copy.fees.counter.transactionRef}</span>
                    <Input
                      value={transactionRef}
                      onChange={(event) => setTransactionRef(event.target.value)}
                      placeholder={
                        mode === "cheque"
                          ? copy.fees.counter.transactionRefCheque
                          : mode === "dd"
                            ? copy.fees.counter.transactionRefDd
                            : copy.fees.counter.transactionRefElectronic
                      }
                      aria-describedby="collect-ref-help"
                    />
                    <span id="collect-ref-help" className="text-muted-foreground text-xs">
                      {copy.fees.counter.transactionRefHelp}
                    </span>
                  </label>
                )}
                {(mode === "cheque" || mode === "dd") && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-sm font-medium">{copy.fees.counter.bankName}</span>
                    <Input
                      value={bankName}
                      onChange={(event) => setBankName(event.target.value)}
                    />
                  </label>
                )}
                {mode === "cheque" && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-sm font-medium">{copy.fees.counter.chequeDate}</span>
                    <Input
                      type="date"
                      value={chequeDate}
                      onChange={(event) => setChequeDate(event.target.value)}
                      aria-describedby="collect-cheque-help"
                    />
                    <span id="collect-cheque-help" className="text-muted-foreground text-xs">
                      {copy.fees.counter.chequeDateHelp}
                    </span>
                  </label>
                )}
              </div>

              <label className="flex max-w-md flex-col gap-1 text-sm">
                <span className="text-sm font-medium">{copy.fees.counter.remarks}</span>
                <Input
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  placeholder={copy.common.optional}
                />
              </label>

              <div className="bg-background/95 sticky bottom-4 z-10 flex flex-col gap-2 rounded-lg border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-xs" aria-live="polite">
                  {mode === "cash" ? copy.fees.counter.modeHelp : copy.fees.counter.pendingNote}
                </p>
                <Button
                  onClick={submit}
                  className="min-h-12 w-full text-base sm:w-auto"
                  disabled={record.isPending || !hasAmount || !record.canSubmit}
                  title={!hasAmount ? copy.fees.counter.enterAmount : undefined}
                >
                  <CheckIcon data-icon="inline-start" />
                  {record.isPending
                    ? copy.fees.counter.submitting
                    : hasAmount
                      ? copy.fees.counter.submitAmount(formatMoney(allocatedTotal))
                      : copy.fees.counter.submit}
                </Button>
              </div>
              {!hasAmount && !record.isPending ? (
                <p className="text-muted-foreground -mt-3 text-xs">
                  {copy.fees.counter.enterAmount}
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Search results: identification only — name + admission number. */
function StudentResults({
  students,
  isLoading,
  isSuccess,
  onChoose,
}: {
  students: Student[];
  isLoading: boolean;
  isSuccess: boolean;
  onChoose: (student: Student) => void;
}) {
  if (isLoading) {
    return <p className="text-muted-foreground py-8 text-sm">{copy.common.loading}</p>;
  }
  if (students.length === 0 && isSuccess) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={copy.fees.counter.noResultsTitle}
        description={copy.fees.counter.noResultsBody}
      />
    );
  }
  if (students.length === 0) return null;
  return (
    <ul className="flex max-w-2xl flex-col gap-2">
      {students.map((student) => (
        <li key={student.id}>
          <button
            type="button"
            onClick={() => onChoose(student)}
            className="hover:bg-accent flex w-full items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base font-medium">
                {student.firstName} {student.middleName} {student.lastName}
              </span>
              <span className="text-muted-foreground text-sm">{student.admissionNumber}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The account header: name first, outstanding biggest. */
function AccountHeader({
  student,
  outstanding,
  openCount,
  onBack,
}: {
  student: Student;
  outstanding: string;
  openCount: number;
  onBack: () => void;
}) {
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
        <ArrowLeftIcon data-icon="inline-start" />
        {copy.common.back}
      </Button>
      <h2 className="text-xl font-semibold tracking-tight">
        {student.firstName} {student.middleName} {student.lastName}
      </h2>
      <p className="text-muted-foreground text-sm">{student.admissionNumber}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-sm">{copy.fees.dues.grandTotal}</p>
          <p className="text-4xl font-bold tracking-tight tabular-nums">
            {formatMoney(outstanding)}
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          {copy.fees.counter.openCount(openCount)}
        </p>
      </div>
    </div>
  );
}

/** Compact installment list — dividers, not nested cards. */
function InstallmentList({ rows }: { rows: FeeInstallment[] }) {
  return (
    <section aria-label={copy.fees.profile.installmentsTitle}>
      <ul className="divide-y rounded-lg border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {row.description ?? copy.common.none}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatIsoDate(row.dueDate)} · {copy.fees.installmentStatuses[row.paymentStatus]}
              </p>
            </div>
            <div className="flex items-baseline gap-3">
              <p className="text-muted-foreground text-xs tabular-nums">
                {copy.fees.amounts.paid} {formatMoney(row.paidAmount)}
              </p>
              <p className="text-sm font-semibold tabular-nums">{formatMoney(row.balanceAmount)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The auto-split preview + the Change-allocation disclosure. The preview is
 * read-only output; manual rows appear only inside the disclosure.
 */
function AutoAllocation({
  lines,
  total,
  open,
  onToggle,
  rows,
  allocations,
  onChange,
}: {
  lines: Array<{ id: string; description: string; amount: string }>;
  total: string;
  open: boolean;
  onToggle: () => void;
  rows: FeeInstallment[];
  allocations: AllocationRow[];
  onChange: (installment: FeeInstallment, raw: string) => void;
}) {
  const allocationOf = (id: string) => allocations.find((r) => r.installment.id === id)?.amount ?? "";
  return (
    <section aria-labelledby="collect-applied">
      <h2 id="collect-applied" className="text-base font-semibold">
        {copy.fees.counter.autoAppliedTitle}
      </h2>
      <p className="text-muted-foreground text-xs">{copy.fees.counter.autoAppliedHelp}</p>
      {lines.length > 0 ? (
        <ul className="mt-2 divide-y rounded-lg border">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{line.description}</span>
              <span className={cn("font-medium tabular-nums", moneyCellClass)}>
                {formatMoney(line.amount)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 bg-accent/40 px-3 py-2 text-sm font-bold">
            <span>{copy.fees.amounts.total}</span>
            <span className={cn("tabular-nums", moneyCellClass)}>{formatMoney(total)}</span>
          </li>
        </ul>
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">{copy.fees.counter.enterAmount}</p>
      )}
      <Button variant="outline" size="sm" className="mt-2" aria-expanded={open} onClick={onToggle}>
        {open ? copy.fees.counter.hideAllocation : copy.fees.counter.changeAllocation}
        <ChevronDownIcon
          data-icon="inline-end"
          className={cn("transition-transform", open && "rotate-180")}
        />
      </Button>
      {open ? (
        <ul className="mt-2 divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {row.description ?? copy.common.none}
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {copy.fees.amounts.balance} {formatMoney(row.balanceAmount)}
                </p>
              </div>
              <Input
                inputMode="decimal"
                value={allocationOf(row.id)}
                onChange={(event) => onChange(row, event.target.value)}
                placeholder="0.00"
                aria-label={`${copy.fees.counter.amount} — ${row.description ?? ""}`}
                className="h-11 w-full text-right sm:w-36"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Payment method as a segmented control — one tap, no dropdown. */
function MethodSelector({
  mode,
  onChange,
}: {
  mode: CollectMode;
  onChange: (mode: CollectMode) => void;
}) {
  return (
    <section aria-labelledby="collect-method">
      <h2 id="collect-method" className="text-base font-semibold">
        {copy.fees.counter.mode}
      </h2>
      <div role="radiogroup" aria-label={copy.fees.counter.mode} className="mt-2 flex flex-wrap gap-2">
        {MODES.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(m)}
              className={cn(
                "min-h-11 rounded-lg border px-4 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent",
              )}
            >
              {copy.fees.paymentModes[m]}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The strong confirmation state (spec §12): amount biggest, then facts. */
function Confirmation({
  payment,
  meta,
  onCollectAnother,
}: {
  payment: FeePayment;
  meta:
    | {
        studentName: string;
        admissionNumber: string;
        schoolName: string;
        lines: Array<{ id: string; description: string; amount: string }>;
      }
    | undefined;
  onCollectAnother: () => void;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-4" data-testid="receipt-card">
      <div>
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
          <CheckIcon data-icon="inline-start" />
          {copy.fees.counter.confirmationTitle}
          <FeeStatus kind="payment" status={payment.paymentStatus} />
        </p>
        <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums">
          {formatMoney(payment.totalAmount)}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {meta ? `${meta.studentName} · ${meta.admissionNumber}` : ""}
        </p>
      </div>

      <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs font-medium">{copy.fees.payments.receipt}</dt>
          <dd className="font-mono text-sm font-medium">{payment.receiptNumber}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs font-medium">{copy.fees.counter.mode}</dt>
          <dd className="text-sm font-medium">
            {copy.fees.paymentModes[payment.paymentMode as CollectMode] ?? copy.common.none}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs font-medium">{copy.fees.counter.paymentDate}</dt>
          <dd className="text-sm font-medium">{formatIsoDate(payment.paymentDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs font-medium">{copy.fees.counter.receiptBranch}</dt>
          <dd className="text-sm font-medium">{meta?.schoolName ?? copy.common.none}</dd>
        </div>
      </dl>

      {meta && meta.lines.length > 0 ? (
        <section aria-label={copy.fees.payments.allocationsTitle}>
          <h2 className="text-base font-semibold">{copy.fees.payments.allocationsTitle}</h2>
          <ul className="mt-2 divide-y rounded-lg border">
            {meta.lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{line.description}</span>
                <span className={cn("font-medium tabular-nums", moneyCellClass)}>
                  {formatMoney(line.amount)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{copy.fees.amounts.lateFee}</span>
              <span className={cn("tabular-nums", moneyCellClass)}>
                {formatMoney(payment.lateFeeAmount)}
              </span>
            </li>
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" onClick={() => window.print()} className="min-h-11">
          <PrinterIcon data-icon="inline-start" />
          {copy.fees.counter.print}
        </Button>
        <Link
          href={`/fees/payments/${payment.id}`}
          className="text-primary inline-flex min-h-11 items-center text-sm font-medium hover:underline"
        >
          {copy.fees.counter.viewReceipt}
        </Link>
        <Button onClick={onCollectAnother} className="min-h-11">
          {copy.fees.counter.collectAnother}
        </Button>
      </div>
    </div>
  );
}
