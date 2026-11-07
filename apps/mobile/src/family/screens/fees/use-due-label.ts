import { useTranslation } from "react-i18next";

import { useFormat } from "../../i18n/format";
import { dueName } from "../../lib/fees";

/** The display name of a due, in the current language. */
export function useDueLabel() {
  const { t } = useTranslation("fees");
  const format = useFormat();
  return (due: { feeHeadName: string; description: string | null; periodKey: string }) => {
    const name = dueName(due);
    return name.kind === "monthly"
      ? t("dueTitle", { head: name.head, month: format.month(name.month, "short") })
      : name.name;
  };
}
