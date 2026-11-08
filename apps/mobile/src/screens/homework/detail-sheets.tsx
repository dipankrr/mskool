import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { DateField } from "../../components/date-field";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { localDateToIso } from "../../lib/format";
import { dueInstant, duePresets, formatDue, sectionLabel, type GiveKind } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

type Detail = inferRouterOutputs<AppRouter>["homework"]["byId"];
const text = copy.homework.detail;
const give = copy.homework.give;

function useBase(hw: Detail) {
  const { organizationId } = useActiveContext();
  return {
    organizationId: organizationId ?? "",
    id: hw.id,
    sectionId: hw.sections[0]?.sectionId ?? "",
    subjectId: hw.subjectId,
  };
}

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on ? styles.chipOn : null]}
      testID={testID}
    >
      <ThemedText variant="bodyStrong" color={on ? colors.onAccent : colors.ink}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** A due-date picker: the type's presets plus any day. */
export function DuePicker({ kind, day, onDay }: { kind: GiveKind; day: string; onDay: (d: string) => void }) {
  const today = localDateToIso(new Date());
  const presets = duePresets(kind, today);
  const custom = !presets.some((p) => p.day === day);
  return (
    <View>
      <View style={styles.chips}>
        {presets.map((p) => (
          <Chip key={p.day} label={p.label} on={p.day === day} onPress={() => onDay(p.day)} />
        ))}
      </View>
      <DateField label={give.pick} value={custom ? day : null} onChange={onDay} minimumDate={today} />
      <ThemedText variant="meta" style={styles.when}>
        {formatDue(dueInstant(day))}
      </ThemedText>
    </View>
  );
}

const kindOf = (hw: Detail): GiveKind => (hw.kind === "quiz" ? "homework" : hw.kind);

/** Edit reuses Give's wording: the work, and about how long. */
export function EditSheet({ hw, onClose, onSaved }: { hw: Detail; onClose: () => void; onSaved: () => void }) {
  const base = useBase(hw);
  const reading = hw.kind === "reading";
  const [title, setTitle] = useState(hw.title);
  const [details, setDetails] = useState(hw.details ?? "");
  const [book, setBook] = useState(hw.book ?? "");
  const [minutes, setMinutes] = useState<number | null>(hw.estimatedMinutes);
  const update = trpc.homework.update.useMutation({ onSuccess: onSaved });
  const valid = title.trim().length > 0 && (!reading || book.trim().length > 0);
  return (
    <FormSheet
      visible
      title={text.editTitle}
      onClose={onClose}
      testIDPrefix="hw-edit-sheet"
      footer={
        <View style={styles.footer}>
          {update.isError ? <Notice tone="critical" message={toFriendlyError(update.error).message} /> : null}
          <CapsuleButton
            title={text.editSave}
            onPress={() =>
              update.mutate({
                ...base,
                title: title.trim(),
                ...(reading ? { book: book.trim() } : { details: details.trim() || null }),
                estimatedMinutes: minutes,
              })
            }
            loading={update.isPending}
            disabled={!valid || update.isPending}
            style={styles.stretch}
            testID="hw-edit-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        {reading ? (
          <FormField label={give.bookLabel} value={book} onChangeText={setBook} maxLength={250} />
        ) : null}
        <FormField
          label={reading ? give.pagesLabel : give.titleLabel}
          value={title}
          onChangeText={setTitle}
          maxLength={250}
          testID="hw-edit-title"
        />
        {!reading ? (
          <FormField label={give.detailsLabel} value={details} onChangeText={setDetails} multiline maxLength={10000} />
        ) : null}
        <View>
          <ThemedText variant="sectionLabel" style={styles.fieldLabel}>
            {give.howLong}
          </ThemedText>
          <View style={styles.chips}>
            {[15, 30, 45, 60].map((m) => (
              <Chip key={m} label={give.minutes(m)} on={minutes === m} onPress={() => setMinutes(minutes === m ? null : m)} />
            ))}
          </View>
        </View>
      </View>
    </FormSheet>
  );
}

/** Move the due date for every class, or only one (frame 26). */
export function MoveDueSheet({ hw, onClose, onSaved }: { hw: Detail; onClose: () => void; onSaved: () => void }) {
  const base = useBase(hw);
  const [day, setDay] = useState(localDateToIso(new Date(hw.dueAt)));
  const [only, setOnly] = useState<string | null>(null);
  const move = trpc.homework.moveDue.useMutation({ onSuccess: onSaved });
  return (
    <FormSheet
      visible
      title={text.moveTitle}
      onClose={onClose}
      testIDPrefix="hw-move-sheet"
      footer={
        <View style={styles.footer}>
          {move.isError ? <Notice tone="critical" message={toFriendlyError(move.error).message} /> : null}
          <CapsuleButton
            title={text.moveSave}
            onPress={() =>
              move.mutate({ ...base, dueAt: dueInstant(day), ...(only ? { onlySectionId: only } : {}) })
            }
            loading={move.isPending}
            disabled={move.isPending}
            style={styles.stretch}
            testID="hw-move-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <DuePicker kind={kindOf(hw)} day={day} onDay={setDay} />
        {hw.sections.length > 1 ? (
          <View>
            <ThemedText variant="sectionLabel" style={styles.fieldLabel}>
              {text.moveOnly}
            </ThemedText>
            <View style={styles.chips}>
              <Chip label={text.moveAll} on={only === null} onPress={() => setOnly(null)} />
              {hw.sections.map((s) => (
                <Chip
                  key={s.sectionId}
                  label={sectionLabel(s.className, s.sectionName)}
                  on={only === s.sectionId}
                  onPress={() => setOnly(s.sectionId)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </FormSheet>
  );
}

/** Give the same homework to other classes of the subject (frame 27). */
export function GiveAgainSheet({ hw, onClose, onSaved }: { hw: Detail; onClose: () => void; onSaved: () => void }) {
  const base = useBase(hw);
  const { organizationId, schoolId } = useActiveContext();
  const pairs = trpc.homework.pairs.useQuery({ organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) });
  const given = new Set(hw.sections.map((s) => s.sectionId));
  const options = (pairs.data?.find((p) => p.subjectId === hw.subjectId)?.sections ?? []).filter((s) => !given.has(s.sectionId));
  const [picked, setPicked] = useState<string[]>([]);
  const [day, setDay] = useState(() => duePresets(kindOf(hw), localDateToIso(new Date()))[0]!.day);
  const again = trpc.homework.giveAgain.useMutation({ onSuccess: onSaved });
  const labels = options
    .filter((s) => picked.includes(s.sectionId))
    .map((s) => sectionLabel(s.className, s.sectionName))
    .join(", ");
  return (
    <FormSheet
      visible
      title={text.againTitle}
      onClose={onClose}
      testIDPrefix="hw-again-sheet"
      footer={
        <View style={styles.footer}>
          {again.isError ? <Notice tone="critical" message={toFriendlyError(again.error).message} /> : null}
          <CapsuleButton
            title={text.againSave(labels)}
            onPress={() => again.mutate({ ...base, toSectionIds: picked, dueAt: dueInstant(day) })}
            loading={again.isPending}
            disabled={picked.length === 0 || again.isPending}
            style={styles.stretch}
            testID="hw-again-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <ThemedText variant="meta">{text.againBody}</ThemedText>
        {pairs.isSuccess && options.length === 0 ? <Notice tone="neutral" message={text.againNone} /> : null}
        <View style={styles.chips}>
          {options.map((s) => {
            const on = picked.includes(s.sectionId);
            return (
              <Chip
                key={s.sectionId}
                label={`${sectionLabel(s.className, s.sectionName)} · ${s.studentCount}`}
                on={on}
                onPress={() => setPicked((all) => (on ? all.filter((x) => x !== s.sectionId) : [...all, s.sectionId]))}
                testID={`hw-again-${s.sectionId}`}
              />
            );
          })}
        </View>
        {options.length ? <DuePicker kind={kindOf(hw)} day={day} onDay={setDay} /> : null}
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  footer: { gap: spacing.sm },
  stretch: { alignSelf: "stretch" },
  fieldLabel: { marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    justifyContent: "center",
    backgroundColor: colors.field,
  },
  chipOn: { backgroundColor: colors.accent },
  when: { marginTop: spacing.xs },
});
