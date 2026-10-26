/**
 * Installment labels, remembered per installment for the life of the process.
 *
 * `payment.detail` returns allocations with an `installmentId` and an amount,
 * but no fee-head label (documented backend gap). Screens that already hold
 * installment rows (collect, the student desk) leave each row's name here so a
 * receipt or payment detail can label its lines. A line whose installment was
 * never seen in this session falls back to a short installment id rather than
 * inventing a label.
 *
 * Labels only, never amounts: every amount on a receipt comes from the
 * server's allocations, so an idempotent replay that returns an earlier
 * payment can never be printed with this attempt's split.
 */
const labels = new Map<string, string>();

export function rememberInstallmentLabels(
  entries: { id: string; label: string }[],
): void {
  for (const entry of entries) labels.set(entry.id, entry.label);
}

export function recallInstallmentLabel(installmentId: string): string | null {
  return labels.get(installmentId) ?? null;
}
