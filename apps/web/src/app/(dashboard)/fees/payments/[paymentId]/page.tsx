"use client";

import { ArrowLeftIcon, BanIcon, RotateCcwIcon, CheckIcon, UndoIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PermissionGate } from "@/components/permission-gate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentStatusClass, moneyCellClass } from "@/features/fees/fee-styles";
import type { FeePaymentStatus } from "@/features/fees/fee-enums";
import { usePaymentDetail, usePaymentMutations } from "@/features/fees/use-fee-payments";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * PAYMENT DETAIL — the state machine made visible. The actions rendered
 * are EXACTLY the ones legal in the payment's status (the plan's table):
 * pending → Clear / Cancel; cleared → Bounce / Reverse / Refund; the
 * terminal statuses render the terminal note. Approve-tier actions sit
 * inside PermissionGate (an accountant physically cannot see Clear —
 * separation of duties, hidden not disabled); refund additionally needs
 * fee_refund:create.
 *
 * The reason field is required by the schema — the dialog is a small form,
 * not a bare confirm, because every transition is an audit event.
 */

type TransitionKind = "clear" | "cancel" | "bounce" | "reverse" | "refund";

/**
 * The state table the UI encodes — single source, next to the render.
 *
 * Mirrors the SERVICE's `transitionPayment` preconditions exactly:
 * clear/cancel from pending; bounce from pending OR cleared (a cheque
 * that bounced on first presentation never cleared — the classic
 * real-world case); reverse/refund from cleared; terminal → nothing.
 */
function availableTransitions(status: FeePaymentStatus): TransitionKind[] {
  switch (status) {
    case "pending":
      return ["clear", "cancel", "bounce"];
    case "cleared":
      return ["bounce", "reverse", "refund"];
    default:
      return []; // bounced / reversed / cancelled — terminal.
  }
}

const TRANSITION_COPY: Record<TransitionKind, {
  label: string;
  title: string;
  body: string;
  confirm: string;
  icon: typeof CheckIcon;
}> = {
  clear: {
    label: copy.fees.payments.clearAction,
    title: copy.fees.payments.clearTitle,
    body: copy.fees.payments.clearBody,
    confirm: copy.fees.payments.clearAction,
    icon: CheckIcon,
  },
  cancel: {
    label: copy.fees.payments.cancelAction,
    title: copy.fees.payments.cancelTitle,
    body: copy.fees.payments.cancelBody,
    confirm: copy.fees.payments.cancelAction,
    icon: BanIcon,
  },
  bounce: {
    label: copy.fees.payments.bounceAction,
    title: copy.fees.payments.bounceTitle,
    body: copy.fees.payments.bounceBody,
    confirm: copy.fees.payments.bounceAction,
    icon: BanIcon,
  },
  reverse: {
    label: copy.fees.payments.reverseAction,
    title: copy.fees.payments.reverseTitle,
    body: copy.fees.payments.reverseBody,
    confirm: copy.fees.payments.reverseAction,
    icon: RotateCcwIcon,
  },
  refund: {
    label: copy.fees.payments.refundAction,
    title: copy.fees.payments.refundTitle,
    body: copy.fees.payments.refundBody,
    confirm: copy.fees.payments.refundAction,
    icon: UndoIcon,
  },
};

const REFUND_MODES = ["cash", "upi", "cheque", "neft_rtgs", "dd"] as const;

export default function FeePaymentDetailPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = params.paymentId;
  const { schoolId, activeSession } = useActiveContext();

  const detail = usePaymentDetail(schoolId ?? undefined, paymentId);
  const students = useStudents();
  const mutations = usePaymentMutations();

  const [acting, setActing] = useState<TransitionKind | undefined>();
  const [reason, setReason] = useState("");
  // Refund-specific fields.
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMode, setRefundMode] = useState<(typeof REFUND_MODES)[number]>("upi");
  const [refundDate, setRefundDate] = useState(todayIso());
  const [refundRef, setRefundRef] = useState("");

  const payment = detail.data?.payment;
  const allocations = detail.data?.allocations ?? [];
  const student = students.data?.find((s) => s.id === payment?.studentId);

  const legal = payment ? availableTransitions(payment.paymentStatus) : [];

  const closeDialog = () => {
    setActing(undefined);
    setReason("");
    setRefundAmount("");
    setRefundRef("");
  };

  const runTransition = async (kind: TransitionKind) => {
    if (!payment || !schoolId) return;
    try {
      if (kind === "refund") {
        await mutations.refund.submit(schoolId, {
          originalPaymentId: payment.id,
          refundAmount,
          refundDate,
          refundMode,
          ...(refundRef ? { transactionReference: refundRef } : {}),
          reason,
        });
      } else {
        const mutation =
          kind === "clear"
            ? mutations.clear
            : kind === "cancel"
              ? mutations.cancel
              : kind === "bounce"
                ? mutations.bounce
                : mutations.reverse;
        await mutation.submit(schoolId, payment.id, reason);
      }
      closeDialog();
    } catch {
      // Refused (wrong status raced, refund ceiling, …): toast carries
      // the server's wording; the dialog stays for a corrected retry.
    }
  };

  if (detail.isLoading) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{copy.common.loading}</p>;
  }

  if (!payment) {
    return (
      <EmptyState
        title={copy.fees.payments.emptyTitle}
        description={copy.errors.notFound}
        action={
          <Link href="/fees/payments" className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeaderBlock receipt={payment.receiptNumber} />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>{copy.fees.payments.detailTitle}</span>
            <span className={paymentStatusClass(payment.paymentStatus)}>
              {copy.fees.paymentStatuses[payment.paymentStatus]}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label={copy.fees.payments.receipt} value={payment.receiptNumber} />
            <Detail
              label="Student"
              value={
                student
                  ? `${student.firstName} ${student.lastName} · ${student.admissionNumber}`
                  : copy.common.none
              }
            />
            <Detail
              label={copy.fees.counter.mode}
              value={
                copy.fees.paymentModes[
                  payment.paymentMode as keyof typeof copy.fees.paymentModes
                ] ?? copy.common.none
              }
            />
            <Detail label={copy.fees.counter.paymentDate} value={formatIsoDate(payment.paymentDate)} />
            <Detail label={copy.fees.amounts.total} value={formatMoney(payment.totalAmount)} />
            <Detail
              label={copy.fees.amounts.lateFee}
              value={
                payment.lateFeeAmount && payment.lateFeeAmount !== "0.00"
                  ? formatMoney(payment.lateFeeAmount)
                  : copy.common.none
              }
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">{copy.fees.payments.allocationsTitle}</h3>
            <div className="mt-2 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="px-3 py-2 font-medium">Instalment</th>
                    <th className="px-3 py-2 text-right font-medium">{copy.fees.counter.amount}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{a.installmentId.slice(0, 8)}…</td>
                      <td className={cn("px-3 py-2", moneyCellClass)}>
                        {formatMoney(a.amountAllocated)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {payment.statusReason ? (
            <div>
              <h3 className="text-sm font-semibold">{copy.fees.payments.statusTimelineTitle}</h3>
              <p className="text-muted-foreground text-sm">
                {copy.fees.paymentStatuses[payment.paymentStatus]} ·{" "}
                {payment.statusUpdatedAt ? formatIsoDate(payment.statusUpdatedAt.slice(0, 10)) : ""}{" "}
                — {copy.fees.payments.statusReason}: {payment.statusReason}
              </p>
            </div>
          ) : null}

          {legal.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
              {copy.fees.payments.terminalNote}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {legal.map((kind) => (
                <PermissionGate
                  key={kind}
                  permission={kind === "refund" ? "fee_refund:create" : "fee_payment:approve"}
                >
                  <Button variant="outline" size="sm" onClick={() => setActing(kind)}>
                    {(() => {
                      const Icon = TRANSITION_COPY[kind].icon;
                      return <Icon data-icon="inline-start" />;
                    })()}
                    {TRANSITION_COPY[kind].label}
                  </Button>
                </PermissionGate>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* The transition dialog: reason always; refund adds its money fields. */}
      {acting ? (
        acting === "refund" ? (
          <Card className="mx-auto w-full max-w-lg">
            <CardHeader>
              <CardTitle>{copy.fees.payments.refundTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-6">
              <p className="text-muted-foreground text-sm">{copy.fees.payments.refundBody}</p>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs font-medium">
                  {copy.fees.payments.refundFields.amount}
                </span>
                <Input
                  inputMode="decimal"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  placeholder={formatMoney(payment.amount)}
                  aria-label={copy.fees.payments.refundFields.amount}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground text-xs font-medium">
                    {copy.fees.payments.refundFields.date}
                  </span>
                  <Input
                    type="date"
                    value={refundDate}
                    onChange={(event) => setRefundDate(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground text-xs font-medium">
                    {copy.fees.payments.refundFields.mode}
                  </span>
                  <Select value={refundMode} onValueChange={(v) => setRefundMode(v as typeof refundMode)}>
                    <SelectTrigger>
                      <SelectValue>
                        {(value: string | null) =>
                          value
                            ? (copy.fees.paymentModes[value as keyof typeof copy.fees.paymentModes] ?? copy.common.none)
                            : copy.fees.payments.refundFields.mode}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {REFUND_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {copy.fees.paymentModes[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs font-medium">
                  {copy.fees.payments.refundFields.reference}
                </span>
                <Input
                  value={refundRef}
                  onChange={(event) => setRefundRef(event.target.value)}
                  placeholder={copy.common.optional}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs font-medium">
                  {copy.fees.payments.reasonLabel}
                </span>
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={copy.fees.payments.reasonHelp}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeDialog}>
                  {copy.common.cancel}
                </Button>
                <Button
                  onClick={() => void runTransition("refund")}
                  disabled={
                    mutations.refund.isPending || !reason || !refundAmount || !activeSession
                  }
                >
                  {mutations.refund.isPending ? copy.common.saving : copy.fees.payments.refundAction}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <TransitionReasonDialog
            kind={acting}
            reason={reason}
            setReason={setReason}
            pending={
              acting === "clear"
                ? mutations.clear.isPending
                : acting === "cancel"
                  ? mutations.cancel.isPending
                  : acting === "bounce"
                    ? mutations.bounce.isPending
                    : mutations.reverse.isPending
            }
            onCancel={closeDialog}
            onConfirm={() => void runTransition(acting)}
          />
        )
      ) : null}
    </>
  );
}

function TransitionReasonDialog({
  kind,
  reason,
  setReason,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: Exclude<TransitionKind, "refund">;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // ConfirmDialog owns the consequence text; the reason input rides in the
  // body slot via the children? The shared ConfirmDialog has no children
  // slot — so this is a small local dialog using the same primitives.
  const t = TRANSITION_COPY[kind];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background w-full max-w-md rounded-lg border p-4 shadow-lg">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.body}</p>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">
            {copy.fees.payments.reasonLabel}
          </span>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={copy.fees.payments.reasonHelp}
            autoFocus
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {copy.common.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending || !reason}>
            {pending ? copy.common.saving : t.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PageHeaderBlock({ receipt }: { receipt: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {copy.fees.payments.detailTitle} · {receipt}
        </h1>
      </div>
      <Link href="/fees/payments" className={cn(buttonVariants({ variant: "outline" }))}>
        <ArrowLeftIcon data-icon="inline-start" />
        {copy.common.back}
      </Link>
    </div>
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
