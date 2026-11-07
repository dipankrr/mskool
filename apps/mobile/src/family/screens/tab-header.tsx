import { useTranslation } from "react-i18next";

import { useFamilyChild } from "../child-context";
import { childClass } from "../child-context";
import { FChildSwitcher, FHeader } from "../ui";

/** A family tab's header: the child switcher line, then the tab's title. */
export function FamilyTabHeader({ title }: { title: string }) {
  const { t } = useTranslation("family");
  const { children, child, select, line } = useFamilyChild();
  return (
    <FHeader
      title={title}
      context={
        child ? (
          <FChildSwitcher
            testID="family-child"
            items={children.map((c) => ({ id: c.studentId, name: c.name, detail: childClass(t, c) }))}
            selectedId={child.studentId}
            onSelect={select}
            line={line}
            sheetTitle={t("switcher.title")}
            switchHint={t("switcher.hint")}
          />
        ) : null
      }
    />
  );
}
