import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { SelectField } from "../../components/select-field";
import { ThemedText } from "../../components/themed-text";
import { feesCopy } from "../../lib/fees-copy";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { PrintSheet } from "./print-sheet";

const words = feesCopy.print;

type Kind = "notices" | "defaulters" | "dayBook" | "chequeList";

/**
 * The Fees screen's printing: lists and notices for a class or the whole school.
 * Each choice asks only what its document needs.
 */
export function FeesPrintSheet({
  organizationId,
  schoolId,
  academicYearId,
  sessionStart,
  sessionEnd,
  classes,
  sections,
  canReadPayments,
  onClose,
}: {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  sessionStart: string;
  sessionEnd: string;
  classes: { id: string; name: string }[];
  sections: { id: string; name: string; classId: string }[];
  canReadPayments: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<Kind>("notices");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [perPage, setPerPage] = useState<"1" | "2" | "4">("2");
  const today = todayIso();
  const [date, setDate] = useState(today > sessionEnd ? sessionEnd : today);

  const classSections = sections.filter((row) => row.classId === classId);
  const chosenClass = classes.find((row) => row.id === classId);
  const chosenSection = classSections.find((row) => row.id === sectionId);
  const byClass = kind === "notices" || kind === "defaulters";
  const base = { organizationId, schoolId };
  const filter = {
    academicYearId,
    classId: classId || undefined,
    sectionId: sectionId || undefined,
  };

  const load = () => {
    switch (kind) {
      case "notices":
        return utils.fees.document.notices.fetch(
          { ...base, data: { ...filter, perPage: Number(perPage) as 1 | 2 | 4 } },
          { staleTime: 0 },
        );
      case "defaulters":
        return utils.fees.document.defaulters.fetch({ ...base, data: filter }, { staleTime: 0 });
      case "dayBook":
        return utils.fees.document.dayBook.fetch(
          { ...base, data: { academicYearId, date } },
          { staleTime: 0 },
        );
      case "chequeList":
        return utils.fees.document.chequeList.fetch({ ...base, academicYearId }, { staleTime: 0 });
    }
  };

  const kinds: { value: Kind; label: string }[] = [
    { value: "notices", label: words.kinds.notices },
    { value: "defaulters", label: words.kinds.defaulters },
    { value: "dayBook", label: words.kinds.dayBook },
    ...(canReadPayments ? [{ value: "chequeList" as const, label: words.kinds.chequeList }] : []),
  ];

  return (
    <PrintSheet title={words.listsTitle} load={load} onClose={onClose} testIDPrefix="fees-print-sheet">
      <ChoicePills
        label={words.whatLabel}
        value={kind}
        options={kinds}
        onChange={setKind}
        testIDPrefix="fees-print-kind"
      />
      <ThemedText variant="meta">{words.kindHelp[kind]}</ThemedText>

      {byClass ? (
        <View style={styles.block}>
          <SelectField
            label={words.classLabel}
            valueLabel={chosenClass?.name ?? words.allClasses}
            placeholder={words.allClasses}
            options={[
              { id: "", label: words.allClasses },
              ...classes.map((row) => ({ id: row.id, label: row.name })),
            ]}
            currentId={classId}
            onSelect={(id) => {
              setClassId(id);
              setSectionId("");
            }}
            help={kind === "notices" && !classId ? words.oneClassHelp : undefined}
            testID="fees-print-class"
          />
          {classSections.length > 0 ? (
            <SelectField
              label={words.sectionLabel}
              valueLabel={chosenSection?.name ?? words.allSections}
              placeholder={words.allSections}
              options={[
                { id: "", label: words.allSections },
                ...classSections.map((row) => ({ id: row.id, label: row.name })),
              ]}
              currentId={sectionId}
              onSelect={setSectionId}
              testID="fees-print-section"
            />
          ) : null}
        </View>
      ) : null}

      {kind === "notices" ? (
        <ChoicePills
          label={words.perPageLabel}
          value={perPage}
          options={[
            { value: "1" as const, label: words.perPage(1) },
            { value: "2" as const, label: words.perPage(2) },
            { value: "4" as const, label: words.perPage(4) },
          ]}
          onChange={setPerPage}
          testIDPrefix="fees-print-per-page"
        />
      ) : null}

      {kind === "dayBook" ? (
        <DateField
          label={words.dateLabel}
          value={date}
          onChange={setDate}
          minimumDate={sessionStart}
          maximumDate={today < sessionEnd ? today : sessionEnd}
          testID="fees-print-date"
        />
      ) : null}
    </PrintSheet>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
  },
});
