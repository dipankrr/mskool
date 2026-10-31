import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { startingSubjectTypeId } from "../../lib/subject-types";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";

type SubjectType = inferRouterOutputs<AppRouter>["exam"]["subjectTypes"]["list"][number];

/**
 * Maps one subject onto many classes. "Every class" is on by default and covers
 * only the classes without the subject, so nothing is mapped twice. Tapping a
 * class chip turns it off and leaves that class out.
 *
 * One create per class, retrying only what failed, as "Add subjects" does: a
 * dropped connection partway leaves real rows and a clear way to finish.
 * Everything saves as a core subject; electives are per class, in the edit sheet.
 */
export function MapToClassesSheet({
  organizationId,
  schoolId,
  academicYearId,
  subject,
  classes,
  mappedClassIds,
  subjectTypes,
  canReadTypes,
  onClose,
  onSaved,
}: {
  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;
  subject: { id: string; name: string };
  classes: readonly { id: string; name: string }[];
  mappedClassIds: ReadonlySet<string>;
  subjectTypes: readonly SubjectType[];
  canReadTypes: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const text = copy.academic.subjectMapping;
  const missing = classes.filter((row) => !mappedClassIds.has(row.id));

  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const [pickedTypeId, setPickedTypeId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState(0);
  const [working, setWorking] = useState(false);

  const typeId = pickedTypeId ?? startingSubjectTypeId(subjectTypes);
  const typeOptions = subjectTypes.map((row) => ({ id: row.id, label: row.name }));

  const targets = missing.filter((row) => !leftOut.has(row.id));
  const every = leftOut.size === 0;

  const utils = trpc.useUtils();
  const create = trpc.assignment.subjectMapping.create.useMutation();

  const toggle = (id: string) => {
    void Haptics.selectionAsync();
    setLeftOut((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async (list: readonly { id: string }[]) => {
    if (!schoolId || !academicYearId || !typeId) return;
    setWorking(true);
    setDone(0);
    const failures = new Set<string>();
    let completed = 0;
    for (const row of list) {
      try {
        await create.mutateAsync({
          organizationId,
          schoolId,
          academicYearId,
          classId: row.id,
          subjectId: subject.id,
          data: {
            academicYearId,
            classId: row.id,
            subjectId: subject.id,
            isElective: false,
            subjectTypeId: typeId,
          },
        });
        completed += 1;
        setDone(completed);
      } catch {
        failures.add(row.id);
      }
    }
    await Promise.all([
      utils.assignment.subjectMapping.list.invalidate(),
      utils.assignment.subjectMapping.coverage.invalidate(),
    ]);
    setFailedIds(failures);
    setWorking(false);
    if (failures.size === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(text.mapped(subject.name, completed));
    }
  };

  const failed = targets.filter((row) => failedIds.has(row.id));

  return (
    <FormSheet
      title={text.mapSheetTitle(subject.name)}
      onClose={onClose}
      testIDPrefix="map-classes"
      footer={
        <>
          {failed.length > 0 ? (
            <CapsuleButton
              title={copy.bulkMapping.failed(failed.length)}
              icon="history"
              onPress={() => void run(failed)}
              disabled={working}
              testID="map-classes-retry"
            />
          ) : (
            <CapsuleButton
              title={working ? text.mapping(done, targets.length) : text.mapTo(targets.length)}
              icon="check"
              onPress={() => void run(targets)}
              loading={working}
              disabled={working || targets.length === 0 || !typeId}
              testID="map-classes-confirm"
            />
          )}
        </>
      }
    >
      <ThemedText variant="meta">
        {text.alreadyIn(mappedClassIds.size, classes.length)}
      </ThemedText>

      <SwitchRow
        label={text.everyClass}
        value={every}
        onChange={(next) =>
          setLeftOut(next ? new Set() : new Set(missing.map((row) => row.id)))
        }
        help={
          missing.length === classes.length
            ? text.everyClassHelp
            : text.everyMissingHelp(missing.length)
        }
        testID="map-classes-every"
      />

      <View style={styles.chips}>
        {missing.map((row) => {
          const on = !leftOut.has(row.id);
          return (
            <Pressable
              key={row.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={row.name}
              onPress={() => toggle(row.id)}
              style={[styles.chip, on ? styles.chipOn : null]}
              testID={`map-classes-${row.id}`}
            >
              {on ? <AppIcon name="check" size={14} color={colors.accentDeep} /> : null}
              <ThemedText variant="chip" color={on ? colors.accentDeep : colors.muted}>
                {row.name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {typeOptions.length > 0 ? (
        <SelectField
          label={copy.bulkMapping.typeLabel}
          valueLabel={typeOptions.find((option) => option.id === typeId)?.label ?? null}
          placeholder={copy.bulkMapping.typePlaceholder}
          options={typeOptions}
          currentId={typeId ?? ""}
          onSelect={setPickedTypeId}
          help={copy.bulkMapping.typeHelp}
          testID="map-classes-type"
        />
      ) : canReadTypes ? (
        <Notice
          tone="caution"
          message={copy.bulkMapping.noTypesBody}
          style={styles.notice}
          testID="map-classes-no-types"
        >
          <CapsuleButton
            title={copy.bulkMapping.noTypesAction}
            size="compact"
            onPress={() => {
              onClose();
              router.push("/exams/setup/subject-types");
            }}
            testID="map-classes-add-type"
          />
        </Notice>
      ) : (
        <Notice
          tone="caution"
          message={copy.bulkMapping.typesHiddenBody}
          style={styles.notice}
          testID="map-classes-types-hidden"
        />
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  chip: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  chipOn: {
    backgroundColor: colors.accentTint,
  },
  notice: {
    marginTop: spacing.sm,
  },
});
