"use client";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type {
  FeeInstallmentStatus,
  FeePaymentStatus,
  FeeSubscriptionStatus,
  OpeningBalanceStatus,
} from "./fee-enums";
import {
  installmentStatusClass,
  openingBalanceStatusTint,
  paymentStatusClass,
  subscriptionStatusClass,
} from "./fee-styles";

/**
 * One consistent status badge for the whole fees area (spec §29): badge +
 * text, never color alone. Every status string comes from `copy.fees`; every
 * tint from `fee-styles.ts`. Callers name the KIND of status they hold so a
 * payment "cancelled" can never render with an instalment tint.
 */

type StatusKind =
  | { kind: "installment"; status: FeeInstallmentStatus }
  | { kind: "payment"; status: FeePaymentStatus }
  | { kind: "subscription"; status: FeeSubscriptionStatus }
  | { kind: "openingBalance"; status: OpeningBalanceStatus };

export function FeeStatus(props: StatusKind & { className?: string }) {
  if (props.kind === "installment") {
    return (
      <span className={cn(installmentStatusClass(props.status), props.className)}>
        {copy.fees.installmentStatuses[props.status]}
      </span>
    );
  }
  if (props.kind === "payment") {
    return (
      <span className={cn(paymentStatusClass(props.status), props.className)}>
        {copy.fees.paymentStatuses[props.status]}
      </span>
    );
  }
  if (props.kind === "subscription") {
    return (
      <span className={cn(subscriptionStatusClass(props.status), props.className)}>
        {copy.fees.subscriptionStatuses[props.status]}
      </span>
    );
  }
  return (
    <span className={cn(openingBalanceStatusTint(props.status), props.className)}>
      {copy.fees.openingBalanceStatuses[props.status]}
    </span>
  );
}

/** The overdue flag: text first, red tint second — never color alone. */
export function OverdueFlag({ className }: { className?: string }) {
  return (
    <span className={cn("text-destructive text-xs font-medium", className)}>
      {copy.fees.dues.overdue}
    </span>
  );
}
