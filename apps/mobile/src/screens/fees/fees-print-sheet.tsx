import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { DateField } from "../../components/date-field";
import { SelectField } from "../../components/select-field";
import { ThemedText } from "../../components/themed-text";
import { feesCopy } from "../../lib/fees-copy";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { PrintSheet } from "./print-sheet";

const words = feesCopy.print;

type Kind = "notices" | "defaulters" | "dayBook" | "chequeList";
type PerPage = "1" | "2" | "4";

const KIND_ICON: Record<Kind, AppIconName> = {
  notices: "worksheet",
  defaulters: "person",
  dayBook: "homework",
  chequeList: "modeBank",
};

/**
 * The Fees screen's printing: lists and notices for a class or the whole school.
 * It opens on the class and section the list is already filtered to, each kind
 * asks only what its document needs, and notices say how many sheets will print.
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
  initialClassId,
  initialSectionId,
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
  initialClassId?: string | null;
  initialSectionId?: string | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<Kind>("notices");
  const [classId, setClassId] = useState(initialClassId ?? "");
  const [sectionId, setSectionId] = useState(initialSectionId ?? "");
  const [perPage, setPerPage] = useState<PerPage>("2");
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

  // How many students owe here, so a notice run says how many sheets it takes.
  const owing = trpc.fees.dashboard.list.useQuery(
    {
      organizationId,
      academicYearId,
      classId: classId || undefined,
      sectionId: sectionId || undefined,
      show: "owes",
      page: 1,
      pageSize: 1,
    },
    { enabled: kind === "notices" },
  );
  const owingCount = owing.data?.total ?? null;

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

  const kinds: Kind[] = [
    "notices",
    "defaulters",
    "dayBook",
    ...(canReadPayments ? (["chequeList"] as const) : []),
  ];
  const where =
    [chosenClass?.name, chosenSection?.name].filter(Boolean).join(" ") || words.wholeSchool;

  return (
    <PrintSheet
      title={words.listsTitle}
      load={load}
      canSubmit={kind !== "notices" || owingCount !== 0}
      onClose={onClose}
      testIDPrefix="fees-print-sheet"
    >
      <View style={styles.form}>
        <View style={styles.group}>
          <ThemedText variant="bodyStrong">{words.whatLabel}</ThemedText>
          <View style={styles.kinds}>
            {kinds.map((value) => {
              const on = kind === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setKind(value)}
                  style={[styles.kind, on ? styles.kindOn : null]}
                  testID={`fees-print-kind-${value}`}
                >
                  <AppIcon
                    name={KIND_ICON[value]}
                    size={20}
                    color={on ? colors.accentDeep : colors.tone.neutral.fg}
                  />
                  <ThemedText
                    variant="bodyStrong"
                    color={on ? colors.accentDeep : colors.tone.neutral.fg}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.2}
                  >
                    {words.kinds[value]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText variant="meta">{words.kindHelp[kind]}</ThemedText>
        </View>

        {byClass ? (
          <View style={styles.pair}>
            <View style={styles.half}>
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
                testID="fees-print-class"
              />
            </View>
            {classSections.length > 0 ? (
              <View style={styles.half}>
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
              </View>
            ) : null}
          </View>
        ) : null}
        {kind === "notices" && !classId ? (
          <ThemedText variant="meta">{words.oneClassHelp}</ThemedText>
        ) : null}

        {kind === "notices" ? (
          <View style={styles.group}>
            <ThemedText variant="bodyStrong">{words.perPageLabel}</ThemedText>
            <View style={styles.segment}>
              {(["1", "2", "4"] as const).map((value) => {
                const on = perPage === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setPerPage(value)}
                    style={[styles.segmentItem, on ? styles.segmentOn : null]}
                    testID={`fees-print-per-page-${value}`}
                  >
                    <ThemedText variant="bodyStrong" color={on ? colors.accentDeep : colors.muted}>
                      {words.perPage(Number(value))}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {owingCount !== null ? (
              <ThemedText variant="meta" testID="fees-print-count">
                {words.sheetCount(owingCount, where, Math.ceil(owingCount / Number(perPage)))}
              </ThemedText>
            ) : null}
          </View>
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
      </View>
    </PrintSheet>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.lg,
    paddingTop: spacing.md,
  },
  group: {
    gap: spacing.sm,
  },
  kinds: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  kind: {
    width: "48.5%",
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
  },
  kindOn: {
    backgroundColor: colors.accentTint,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  pair: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  half: {
    flex: 1,
    minWidth: 0,
  },
  segment: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  segmentOn: {
    backgroundColor: colors.surface,
  },
});
