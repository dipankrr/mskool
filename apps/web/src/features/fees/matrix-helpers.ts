import { addMoney, toPaise } from "@/lib/money";
import type { FeeMatrixRow } from "@/lib/trpc/types";

export function settlementPercent(netAmount: string, paidAmount: string): bigint {
  const net = toPaise(netAmount);
  const paid = toPaise(paidAmount);
  if (net <= 0n || paid <= 0n) return 0n;
  if (paid >= net) return 100n;
  return (paid * 100n) / net;
}

export function collectionPercent(paidAmount: string, netAmount: string): bigint | null {
  const net = toPaise(netAmount);
  if (net <= 0n) return null;
  const paid = toPaise(paidAmount);
  if (paid <= 0n) return 0n;
  if (paid >= net) return 100n;
  return (paid * 100n) / net;
}

export function matrixRowBalance(
  row: {
    totals: Pick<FeeMatrixRow["totals"], "balanceAmount">;
    openingBalance: Pick<FeeMatrixRow["openingBalance"], "balance">;
  },
): string {
  return addMoney(row.totals.balanceAmount, row.openingBalance.balance);
}

export function isCurrentMonth(month: string, currentMonth: string): boolean {
  return month === currentMonth;
}

export function isFutureMonth(month: string, currentMonth: string): boolean {
  return month > currentMonth;
}
