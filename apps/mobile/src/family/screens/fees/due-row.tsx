import { useTranslation } from "react-i18next";

import { useFormat } from "../../i18n/format";
import { isOpen, isOverdue } from "../../lib/fees";
import type { FeeSummary } from "../../lib/fees";
import { FRow } from "../../ui";
import { useDueLabel } from "./use-due-label";

/** One due: its name, where it stands (due, late, part paid, paid) and what is left. */
export function DueRow({ due, today }: { due: FeeSummary["dues"][number]; today: string }) {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const dueLabel = useDueLabel();
  const open = isOpen(due);
  const overdue = isOverdue(due, today);
  return (
    <FRow
      testID={`fees-due-${due.id}`}
      title={dueLabel(due)}
      subtitle={
        !open
          ? t("paidOn")
          : due.status === "partial"
            ? t("partPaid", { paid: format.money(due.paidAmount), net: format.money(due.netAmount) })
            : overdue
              ? t("overdueSince", { date: format.date(due.dueDate) })
              : t("dueOn", { date: format.date(due.dueDate) })
      }
      subtitleTone={!open ? "positive" : overdue ? "critical" : undefined}
      value={format.money(open ? due.balance : due.netAmount)}
      valueVariant="heading"
    />
  );
}
