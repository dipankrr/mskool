import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing, touch } from "../../theme/tokens";
import {
  emptySectionForm,
  sectionFormFrom,
  sectionPayload,
  sectionUpdatePayload,
  validateSectionForm,
  type SectionForm,
  type SectionShift,
} from "./form-logic";

type SectionRow = inferRouterOutputs<AppRouter>["academic"]["section"]["list"][number];

const SHIFTS = ["morning", "day", "evening"] as const;

/**
 * Add or edit one section, in a sheet so the chip appears in place behind it.
 * The class is already known from the card that opened this. A section can't
 * move between classes or sessions (ADR-015), so edit names the class and says
 * why it's fixed. Stream and house stay available but folded away: most
 * sections never use them.
 */
export function SectionSheet({
  organizationId,
  schoolId,
  academicYearId,
  classId,
  className,
  row,
  suggestedName,
  suggestedShift,
  canWrite,
  canDelete,
  onClose,
  onSaved,
}: {
  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;
  classId: string;
  className: string;
  row: SectionRow | null;
  suggestedName: string;
  suggestedShift: SectionShift;
  canWrite: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(row);
  const [form, setForm] = useState<SectionForm>(() =>
    row
      ? sectionFormFrom(row)
      : { ...emptySectionForm(), classId, name: suggestedName, shift: suggestedShift },
  );
  const [moreOpen, setMoreOpen] = useState(Boolean(row?.stream || row?.house));
  const [touched, setTouched] = useState<Set<keyof SectionForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateSectionForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const utils = trpc.useUtils();
  const create = trpc.academic.section.create.useMutation();
  const update = trpc.academic.section.update.useMutation();
  const deactivate = trpc.academic.section.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivating;

  const set = <K extends keyof SectionForm>(field: K, value: SectionForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };
  const touch_ = (field: keyof SectionForm) =>
    setTouched((current) => new Set(current).add(field));
  const fieldError = (field: keyof SectionForm) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;
    try {
      if (row) {
        await update.mutateAsync({
          organizationId,
          id: row.id,
          data: sectionUpdatePayload(form),
        });
      } else {
        if (!academicYearId || !schoolId) {
          setSaveError(new Error(copy.academic.noSessionBody));
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: sectionPayload(form, academicYearId),
        });
      }
      await utils.academic.section.list.invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(copy.academic.classSection.sectionSaved);
    } catch (error) {
      setSaveError(error);
    }
  };

  const deactivateSection = async (id: string) => {
    setSaveError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.academic.section.list.invalidate();
      onSaved(copy.academic.retire.noticeTitle);
    } catch (error) {
      setSaveError(error);
    } finally {
      setDeactivating(false);
    }
  };

  const confirmDeactivate = () => {
    if (!row) return;
    Alert.alert(copy.academic.retire.confirmTitle, copy.academic.retire.confirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.academic.retire.confirm,
        style: "destructive",
        onPress: () => void deactivateSection(row.id),
      },
    ]);
  };

  return (
    <FormSheet
      title={editing ? copy.academic.sections.editTitle : copy.academic.sections.addTitle}
      onClose={onClose}
      testIDPrefix="section-sheet"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="section-save-error"
            />
          ) : submitted && hasErrors ? (
            <Notice tone="critical" message={copy.forms.invalidSummary} testID="section-invalid" />
          ) : null}
          {canWrite ? (
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.sections.add}
              icon="check"
              onPress={() => void submit()}
              loading={create.isPending || update.isPending}
              disabled={pending}
              testID="section-save"
            />
          ) : null}
        </>
      }
    >
      <ThemedText variant="meta">
        {editing
          ? `${className}. ${copy.academic.classSection.classFixed}`
          : className}
      </ThemedText>

      <FormField
        label={copy.academic.classSection.nameLabel}
        value={form.name}
        onChangeText={(name) => set("name", name)}
        onBlur={() => touch_("name")}
        error={fieldError("name")}
        autoCapitalize="characters"
        maxLength={50}
        editable={canWrite}
        testID="section-name"
      />

      {canWrite ? (
        <ChoicePills<SectionShift>
          label={copy.academic.sections.fields.shift}
          value={form.shift}
          options={SHIFTS.map((shift) => ({
            value: shift,
            label: copy.academic.sections.shifts[shift],
          }))}
          onChange={(shift) => set("shift", shift)}
          testIDPrefix="section-shift"
        />
      ) : null}

      <View style={styles.pair}>
        <View style={styles.half}>
          <FormField
            label={copy.academic.sections.fields.room}
            value={form.roomNumber}
            onChangeText={(roomNumber) => set("roomNumber", roomNumber)}
            placeholder={copy.academic.classSection.optional}
            autoCapitalize="characters"
            maxLength={20}
            editable={canWrite}
            testID="section-room"
          />
        </View>
        <View style={styles.half}>
          <FormField
            label={copy.academic.classSection.seatsLabel}
            value={form.maxStudents}
            onChangeText={(maxStudents) => set("maxStudents", maxStudents.replace(/\D/g, ""))}
            onBlur={() => touch_("maxStudents")}
            error={fieldError("maxStudents")}
            placeholder={copy.academic.classSection.optional}
            keyboardType="number-pad"
            maxLength={3}
            editable={canWrite}
            testID="section-capacity"
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        onPress={() => setMoreOpen((open) => !open)}
        style={styles.more}
        testID="section-more"
      >
        <ThemedText variant="bodyStrong" color={colors.muted}>
          {copy.academic.classSection.moreDetails}
        </ThemedText>
        <AppIcon name={moreOpen ? "chevronUp" : "chevronDown"} size={18} color={colors.muted} />
      </Pressable>
      {moreOpen ? (
        <>
          <FormField
            label={copy.academic.sections.fields.stream}
            value={form.stream}
            onChangeText={(stream) => set("stream", stream)}
            autoCapitalize="words"
            maxLength={50}
            editable={canWrite}
            testID="section-stream"
          />
          <FormField
            label={copy.academic.sections.fields.house}
            value={form.house}
            onChangeText={(house) => set("house", house)}
            autoCapitalize="words"
            maxLength={50}
            editable={canWrite}
            testID="section-house"
          />
        </>
      ) : null}

      {row && canDelete ? (
        <Notice
          tone="caution"
          title={`${copy.academic.retire.noticeTitle} — ${row.name}`}
          message={copy.academic.retire.noticeBody}
          style={styles.retire}
        >
          <CapsuleButton
            title={copy.academic.retire.action}
            variant="destructive"
            size="compact"
            onPress={confirmDeactivate}
            loading={deactivating}
            disabled={pending}
            testID="section-deactivate"
          />
        </Notice>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  pair: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  half: {
    flex: 1,
    minWidth: 0,
  },
  more: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  retire: {
    marginTop: spacing.lg,
  },
});
