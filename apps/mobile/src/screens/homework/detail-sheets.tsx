import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
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
import { Chip, DueChips } from "./pickers";
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


/** A due date and time: the type's presets, any other day, and the time, on one row. */
export function DuePicker({
  kind,
  day,
  onDay,
  time,
  onTime,
}: {
  kind: GiveKind;
  day: string;
  onDay: (d: string) => void;
  time: string;
  onTime: (t: string) => void;
}) {
  const today = localDateToIso(new Date());
  return (
    <View>
      <DueChips presets={duePresets(kind, today)} day={day} onDay={onDay} time={time} onTime={onTime} minimumDate={today} />
      <ThemedText variant="meta" style={styles.when}>
        {formatDue(dueInstant(day, time))}
      </ThemedText>
    </View>
  );
}

const timeOf = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

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
  const [time, setTime] = useState(timeOf(new Date(hw.dueAt)));
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
              move.mutate({ ...base, dueAt: dueInstant(day, time), ...(only ? { onlySectionId: only } : {}) })
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
        <DuePicker kind={kindOf(hw)} day={day} onDay={setDay} time={time} onTime={setTime} />
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
  const { organizationId, schoolId, academicYear } = useActiveContext();
  // The viewed session's classes (ADR-066); the server already refuses a class from another session.
  const pairs = trpc.homework.pairs.useQuery({
    organizationId: organizationId ?? "",
    ...(schoolId ? { schoolId } : {}),
    ...(academicYear ? { academicYearId: academicYear.id } : {}),
  });
  const given = new Set(hw.sections.map((s) => s.sectionId));
  const options = (pairs.data?.find((p) => p.subjectId === hw.subjectId)?.sections ?? []).filter((s) => !given.has(s.sectionId));
  const [picked, setPicked] = useState<string[]>([]);
  const [day, setDay] = useState(() => duePresets(kindOf(hw), localDateToIso(new Date()))[0]!.day);
  const [time, setTime] = useState(timeOf(new Date(hw.dueAt)));
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
            onPress={() => again.mutate({ ...base, toSectionIds: picked, dueAt: dueInstant(day, time) })}
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
        {options.length ? <DuePicker kind={kindOf(hw)} day={day} onDay={setDay} time={time} onTime={setTime} /> : null}
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
