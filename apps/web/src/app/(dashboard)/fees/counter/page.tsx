"use client";

import { CheckIcon, PrinterIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { RecordPaymentInput } from "@repo/contracts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeesTabs } from "@/features/fees/tabs";
import { installmentStatusClass, moneyCellClass } from "@/features/fees/fee-styles";
import { useFeeDues } from "@/features/fees/use-fee-dues";
import { useCounterMutations } from "@/features/fees/use-fee-counter";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { todayIso } from "@/lib/format";
import { addMoney, clampMoney, compareMoney, formatMoney } from "@/lib/money";
import type { FeeInstallment, FeePayment, Student } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * THE COUNTER — one screen, one flow: find the student → their open
 * instalments → allocate → collect. The money rules that make this UI
 * trustworthy are structural, not advisory:
 *
 * - The TOTAL is a read-only sum of the allocation rows (the wire has
 *   no `amount`; the cashier cannot type a total).
 * - Each row's input is clamped to that instalment's balance
 *   (clampMoney); the server re-checks under row locks regardless.
 * - Late fee is NEVER computed here — the honesty line says the
 *   server adds it per the school's rules, the receipt shows the
 *   frozen amount.
 * - The idempotency key is one UUID per ATTEMPT, regenerated after
 *   success only.
 * - After success: the receipt panel (server's answer, verbatim) +
 *   full invalidation — the next student's balances come from the
 *   server, never local arithmetic.
 */

const SEARCH_DEBOUNCE_MS = 300;

type AllocationRow = { installment: FeeInstallment; amount: string };

const MODES = ["cash", "upi", "cheque", "neft_rtgs", "card", "dd"] as const;
type CounterMode = (typeof MODES)[number];

export default function FeesCounterPage() {
  const { has, activeSession, schoolId } = useActiveContext();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [paying, setPaying] = useState<Student | undefined>();
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [mode, setMode] = useState<CounterMode>("cash");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [transactionRef, setTransactionRef] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [clientReference, setClientReference] = useState("");
  const [receipt, setReceipt] = useState<FeePayment | undefined>();

  const { record } = useCounterMutations();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A fresh attempt key when the panel opens or after a success.
  useEffect(() => {
    if (!clientReference) setClientReference(crypto.randomUUID());
  }, [clientReference]);

  const students = useStudents(debouncedSearch || undefined);
  const dues = useFeeDues({ academicYearId: activeSession?.id, studentId: paying?.id });

  const openInstallments = dues.data ?? [];

  /** The derived total — the only total this screen has. */
  const total = useMemo(
    () => allocations.reduce((sum, row) => addMoney(sum, row.amount), "0.00"),
    [allocations],
  );

  const setAllocation = (installment: FeeInstallment, raw: string) => {
    setAllocations((rows) => {
      const without = rows.filter((r) => r.installment.id !== installment.id);
      if (!raw) return without;
      // balanceAmount's wire type is nullable (generated column); the
      // server guarantees a value for an open row — ?? "0.00" only
      // satisfies the type. The clamp caps at the balance.
      const cap = clampMoney(raw, "0.00", installment.balanceAmount ?? "0.00");
      return [...without, { installment, amount: cap }];
    });
  };

  const allocationOf = (installmentId: string) =>
    allocations.find((r) => r.installment.id === installmentId)?.amount ?? "";

  const payFull = (installment: FeeInstallment) =>
    setAllocation(installment, installment.balanceAmount ?? "0.00");

  const chooseStudent = (student: Student) => {
    setPaying(student);
    setAllocations([]);
    setReceipt(undefined);
    setClientReference(crypto.randomUUID());
  };

  const submit = async () => {
    if (!paying || allocations.length === 0 || !activeSession) return;
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
      // One key per attempt — regenerated only after success, so a retry
      // of the SAME submission returns the original receipt.
      clientReference,
    };
    try {
      const payment = await record.submit(input);
      setReceipt(payment);
      // New key for the NEXT attempt; the panel's amounts reset.
      setClientReference(crypto.randomUUID());
      setAllocations([]);
      setTransactionRef("");
      setBankName("");
      setChequeDate("");
      setRemarks("");
      setMode("cash");
    } catch {
      // Refused (over-allocation, closed school, …): the toast carries
      // the server's wording; the panel keeps every value so the
      // cashier can correct and re-submit — the SAME clientReference.
    }
  };

  return (
    <>
      <PageHeaderArea />
      <FeesTabs has={has} />

      <div className="relative mb-4 max-w-md">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={copy.fees.counter.searchPlaceholder}
          aria-label={copy.fees.counter.searchLabel}
          className="pl-9"
        />
      </div>

      {!paying ? (
        <StudentPicker students={students.data ?? []} onChoose={chooseStudent} />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {copy.fees.counter.selected}:{" "}
                  <span className="text-primary">
                    {paying.firstName} {paying.lastName}
                  </span>{" "}
                  <span className="text-muted-foreground text-sm font-normal">
                    {paying.admissionNumber}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPaying(undefined);
                    setAllocations([]);
                    setReceipt(undefined);
                  }}
                >
                  {copy.common.back}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-6">
              {openInstallments.length === 0 ? (
                <EmptyState
                  title={copy.fees.counter.noOpenTitle}
                  description={copy.fees.counter.noOpenBody}
                />
              ) : (
                <>
                  <div>
                    <h3 className="text-sm font-semibold">{copy.fees.counter.allocationsTitle}</h3>
                    <p className="text-muted-foreground text-xs">
                      {copy.fees.counter.allocationsHelp}
                    </p>
                  </div>

                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-xs">
                          <th className="px-3 py-2 font-medium">Due</th>
                          <th className="px-3 py-2 font-medium">Instalment</th>
                          <th className="px-3 py-2 text-right font-medium">
                            {copy.fees.amounts.balance}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {copy.fees.counter.amount}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {openInstallments.map((row) => {
                          const allocated = allocationOf(row.id);
                          const balance = row.balanceAmount ?? "0.00";
                          const capped =
                            allocated !== "" && compareMoney(allocated, balance) >= 0;
                          return (
                            <tr key={row.id} className="border-b last:border-b-0">
                              <td className="px-3 py-2">{formatIsoDateOf(row.dueDate)}</td>
                              <td className="px-3 py-2">
                                {row.description ?? copy.common.none}
                                <span
                                  className={cn("ml-2 align-middle", installmentStatusClass(row.paymentStatus))}
                                >
                                  {copy.fees.installmentStatuses[row.paymentStatus]}
                                </span>
                              </td>
                              <td className={cn("px-3 py-2", moneyCellClass)}>
                                {formatMoney(balance)}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-2">
                                  {capped ? null : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => payFull(row)}
                                      aria-label={copy.fees.counter.payFull}
                                    >
                                      {copy.fees.counter.payFull}
                                    </Button>
                                  )}
                                  <Input
                                    inputMode="decimal"
                                    value={allocated}
                                    onChange={(event) => setAllocation(row, event.target.value)}
                                    placeholder="0.00"
                                    aria-label={`${copy.fees.counter.amount} — ${row.description ?? ""}`}
                                    className="w-28 text-right"
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="flex flex-col gap-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{copy.fees.counter.total}</p>
                    <p className="text-muted-foreground text-xs">
                      {copy.fees.counter.lateFeeNote}
                    </p>
                  </div>
                  <p className={cn("text-lg font-bold", moneyCellClass)}>
                    {formatMoney(total)}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground text-xs font-medium">
                      {copy.fees.counter.mode}
                    </span>
                    <Select value={mode} onValueChange={(v) => setMode(v as CounterMode)}>
                      <SelectTrigger aria-label={copy.fees.counter.mode}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {copy.fees.paymentModes[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground text-xs">
                      {copy.fees.counter.modeHelp}
                    </span>
                  </label>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground text-xs font-medium">
                      {copy.fees.counter.paymentDate}
                    </span>
                    <Input
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                    />
                  </label>

                  {mode === "cheque" || mode === "dd" ? (
                    <>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-muted-foreground text-xs font-medium">
                          {copy.fees.counter.transactionRef}
                        </span>
                        <Input
                          value={transactionRef}
                          onChange={(event) => setTransactionRef(event.target.value)}
                          placeholder={mode === "cheque" ? "Cheque no." : "DD no."}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-muted-foreground text-xs font-medium">
                          {copy.fees.counter.bankName}
                        </span>
                        <Input
                          value={bankName}
                          onChange={(event) => setBankName(event.target.value)}
                        />
                      </label>
                    </>
                  ) : mode === "upi" || mode === "neft_rtgs" || mode === "card" ? (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground text-xs font-medium">
                        {copy.fees.counter.transactionRef}
                      </span>
                      <Input
                        value={transactionRef}
                        onChange={(event) => setTransactionRef(event.target.value)}
                        placeholder="UPI ref / UTR"
                      />
                    </label>
                  ) : null}

                  {mode === "cheque" ? (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground text-xs font-medium">
                        {copy.fees.counter.chequeDate}
                      </span>
                      <Input
                        type="date"
                        value={chequeDate}
                        onChange={(event) => setChequeDate(event.target.value)}
                      />
                    </label>
                  ) : null}

                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-muted-foreground text-xs font-medium">
                      {copy.fees.counter.remarks}
                    </span>
                    <Input
                      value={remarks}
                      onChange={(event) => setRemarks(event.target.value)}
                      placeholder={copy.common.optional}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-xs">
                    {mode === "cash"
                      ? copy.fees.counter.modeHelp
                      : copy.fees.counter.pendingNote}
                  </p>
                  <Button
                    onClick={submit}
                    disabled={record.isPending || allocations.length === 0 || !record.canSubmit}
                  >
                    <CheckIcon data-icon="inline-start" />
                    {record.isPending ? copy.fees.counter.submitting : copy.fees.counter.submit}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {receipt ? <ReceiptPanel payment={receipt} /> : null}
        </div>
      )}
    </>
  );
}

function PageHeaderArea() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {copy.fees.counter.title}
        </h1>
        <p className="text-muted-foreground text-sm">{copy.fees.counter.subtitle}</p>
      </div>
    </div>
  );
}

function StudentPicker({
  students,
  onChoose,
}: {
  students: Student[];
  onChoose: (student: Student) => void;
}) {
  if (students.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={copy.students.noResultsTitle}
        description={copy.students.noResultsBody}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {students.map((student) => (
        <button
          key={student.id}
          type="button"
          onClick={() => onChoose(student)}
          className="flex items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              {student.firstName} {student.middleName} {student.lastName}
            </span>
            <span className="text-muted-foreground text-xs">{student.admissionNumber}</span>
          </span>
          <span className="text-muted-foreground text-xs">
            {copy.students.enrolledIn}: {copy.common.none}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The server's answer, verbatim — never a local prediction. */
function ReceiptPanel({ payment }: { payment: FeePayment }) {
  return (
    <Card className="print:border-2">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {copy.fees.counter.receiptTitle}
          <span className="text-muted-foreground font-mono text-sm">
            {payment.receiptNumber}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label={copy.fees.payments.receipt} value={payment.receiptNumber} />
          <Detail
            label={copy.fees.counter.mode}
            // A receipt can only carry counter modes here, but the wire type
            // includes the webhook-only online_portal — the label map
            // degrades it to a dash rather than crashing the receipt.
            value={
              copy.fees.paymentModes[payment.paymentMode as CounterMode] ?? copy.common.none
            }
          />
          <Detail label={copy.fees.amounts.total} value={formatMoney(payment.totalAmount)} />
          <Detail
            label={copy.fees.amounts.lateFee}
            value={formatMoney(payment.lateFeeAmount)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className={installmentStatusClass(payment.paymentStatus === "cleared" ? "paid" : "partial")}>
            {copy.fees.paymentStatuses[payment.paymentStatus]}
          </span>
          <div className="flex gap-2 print:hidden">
            <Link
              href={`/fees/payments/${payment.id}`}
              className="text-primary text-sm hover:underline"
            >
              {copy.fees.payments.detailTitle}
            </Link>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <PrinterIcon data-icon="inline-start" />
              {copy.fees.counter.print}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function formatIsoDateOf(iso: string): string {
  // Local alias to keep the row markup readable; same rule as formatIsoDate.
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
