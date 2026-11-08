import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import type { CheckStatus, Remark } from "@repo/contracts";

import { Avatar } from "../../components/avatar";
import { CapsuleButton } from "../../components/capsule-button";
import { ErrorCard } from "../../components/error-card";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  appendMarkKey,
  changedResults,
  countDrafts,
  dueLine,
  formatDue,
  initialDrafts,
  markAllDone,
  marksValid,
  nextStatus,
  sectionLabel,
  type CheckDraft,
  type RegisterRow,
} from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors, type Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

const text = copy.homework.check;

const STATUS_TONE: Record<CheckStatus, Tone> = {
  done: "positive",
  incomplete: "caution",
  not_done: "critical",
  absent: "neutral",
};

/**
 * The checking list (frames 15 to 20). Everyone starts unmarked (children
 * absent today start Absent for work brought to class); "All done" marks the
 * rest Done and the teacher taps only the exceptions. With grading, a pad
 * stays at the bottom and moves down the roll. Nothing is saved until Save,
 * and a failed save keeps every mark.
 */
export function CheckScreen() {
  const { id, sectionId, subjectId } = useLocalSearchParams<{ id: string; sectionId: string; subjectId: string }>();
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();
  const input = { organizationId: organizationId ?? "", id, sectionId, subjectId };

  const register = trpc.homework.register.get.useQuery(input, {
    enabled: Boolean(organizationId && id && sectionId && subjectId),
    staleTime: 0,
  });
  const rows = useMemo(() => register.data?.rows ?? [], [register.data]);
  const hw = register.data?.homework;
  const grading = hw?.gradingMode ?? "none";

  const [edits, setEdits] = useState<Record<string, CheckDraft>>({});
  const drafts = useMemo(() => ({ ...initialDrafts(rows), ...edits }), [rows, edits]);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [padError, setPadError] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ sectionId: string; done: number; total: number; followUp: { row: RegisterRow; status: CheckStatus }[] } | null>(null);

  const changes = changedResults(rows, drafts);
  const counts = countDrafts(drafts);

  const save = trpc.homework.register.save.useMutation({
    onSuccess: (result) => {
      void utils.homework.register.get.invalidate(input);
      void utils.homework.home.invalidate();
      setEdits({});
      setSelected(null);
      setSaved({
        sectionId,
        done: result.counts.done,
        total: rows.length,
        // Kept with the status as saved: the drafts are cleared below.
        followUp: rows
          .map((row) => ({ row, status: drafts[row.studentAssignmentId]?.checkStatus ?? null }))
          .filter((x): x is { row: RegisterRow; status: CheckStatus } =>
            x.status === "not_done" || x.status === "incomplete",
          ),
      });
    },
  });

  useUnsavedChanges(changes.length > 0 && !save.isPending, {
    title: text.leaveTitle,
    body: text.leaveBody,
    keepEditing: copy.forms.keepEditing,
    discard: copy.forms.discard,
  });

  const setDraft = (saId: string, patch: Partial<CheckDraft>) =>
    setEdits((all) => ({ ...all, [saId]: { ...drafts[saId]!, ...all[saId], ...patch } }));

  const indexOf = (saId: string) => rows.findIndex((r) => r.studentAssignmentId === saId);
  const moveNext = (saId: string) => {
    const next = rows[indexOf(saId) + 1];
    setSelected(next ? next.studentAssignmentId : null);
    setTyped(next ? (drafts[next.studentAssignmentId]?.marks ?? "") : "");
    setPadError(null);
  };

  const onRowPress = (row: RegisterRow) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (grading === "none") {
      setDraft(row.studentAssignmentId, { checkStatus: nextStatus(drafts[row.studentAssignmentId]?.checkStatus ?? null) });
      return;
    }
    setSelected(row.studentAssignmentId);
    setTyped(drafts[row.studentAssignmentId]?.marks ?? "");
    setPadError(null);
  };

  /** A pad result: Done with a score, or a status without one. */
  const record = (saId: string, patch: Partial<CheckDraft>) => {
    setDraft(saId, patch);
    moveNext(saId);
  };

  const commitMarks = () => {
    if (!selected) return;
    if (typed === "") return moveNext(selected);
    if (!marksValid(typed, hw?.maxMarks ?? null)) {
      setPadError(text.marksTooHigh(String(Number(hw?.maxMarks ?? 0))));
      return;
    }
    record(selected, { checkStatus: "done", marks: typed });
  };

  const selectedRow = selected ? rows.find((r) => r.studentAssignmentId === selected) : null;
  const title = register.data ? sectionLabel(register.data.className, register.data.sectionName) : "";
  const meta = hw ? `${hw.title} · ${dueLine(hw.dueAt)}` : undefined;

  if (saved && saved.sectionId === sectionId && register.data) {
    const nextSection = register.data.homework.sections.find(
      (s) => s.sectionId !== sectionId && s.toCheck > 0,
    );
    return (
      <ScreenFrame title={title} meta={meta} backAccessibilityLabel={copy.common.back}>
        <View style={styles.savedWrap} testID="check-saved">
          <ThemedText variant="title">{text.savedTitle}</ThemedText>
          <ThemedText variant="body">{text.savedBody(saved.done, saved.total)}</ThemedText>
          {saved.followUp.length > 0 ? (
            <View style={styles.followUp}>
              <ThemedText variant="sectionLabel">{text.followUp}</ThemedText>
              {saved.followUp.map(({ row: r, status }) => (
                <ThemedText key={r.studentAssignmentId} variant="body">
                  {`${r.rollNumber ? `${r.rollNumber}. ` : ""}${r.name} · ${text.statuses[status]}`}
                </ThemedText>
              ))}
            </View>
          ) : null}
          {nextSection ? (
            <CapsuleButton
              title={text.nextSection(sectionLabel(nextSection.className, nextSection.sectionName))}
              onPress={() => router.setParams({ sectionId: nextSection.sectionId })}
              testID="check-next-section"
              style={styles.stretch}
            />
          ) : null}
          <CapsuleButton
            title={text.backHome}
            variant={nextSection ? "secondary" : "primary"}
            onPress={() => router.back()}
            testID="check-back-home"
            style={styles.stretch}
          />
        </View>
      </ScreenFrame>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.counts}>
        <Count n={counts.done} label={text.statuses.done} tone="positive" />
        <Count n={counts.incomplete} label={text.statuses.incomplete} tone="caution" />
        <Count n={counts.notDone} label={text.statuses.not_done} tone="critical" />
        <Count n={counts.left} label={text.left} tone="neutral" />
      </View>
      {grading === "none" ? (
        <CapsuleButton
          title={text.allDone}
          size="compact"
          variant="secondary"
          icon="checkCircle"
          disabled={counts.left === 0}
          onPress={() => setEdits((all) => ({ ...all, ...markAllDone(drafts) }))}
          testID="check-all-done"
          style={styles.allDone}
        />
      ) : null}
    </View>
  );

  const pad = selectedRow ? (
    <View style={styles.pad} testID="check-pad">
      <View style={styles.padHead}>
        <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.grow}>
          {`${selectedRow.rollNumber ? `${selectedRow.rollNumber}. ` : ""}${selectedRow.name}`}
        </ThemedText>
        {grading === "marks" ? (
          <ThemedText variant="numeric" testID="check-typed">
            {`${typed || "–"} / ${Number(hw?.maxMarks ?? 0)}`}
          </ThemedText>
        ) : null}
      </View>
      {padError ? <ThemedText variant="meta" color={colors.tone.critical.fg}>{padError}</ThemedText> : null}
      {grading === "marks" ? (
        <View style={styles.keys}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
            <PadKey key={k} label={k} onPress={() => setTyped((v) => appendMarkKey(v, k))} testID={`check-key-${k}`} />
          ))}
        </View>
      ) : grading === "remark" ? (
        <View style={styles.keys}>
          {(["excellent", "good", "bad"] as Remark[]).map((r) => (
            <PadKey
              key={r}
              label={text.remarks[r]}
              tone={r === "excellent" ? "positive" : r === "bad" ? "critical" : "neutral"}
              onPress={() => record(selectedRow.studentAssignmentId, { checkStatus: "done", remark: r })}
              testID={`check-remark-${r}`}
            />
          ))}
        </View>
      ) : (
        <View style={styles.keys}>
          {(register.data?.gradeLetters ?? []).map((g) => (
            <PadKey
              key={g}
              label={g}
              onPress={() => record(selectedRow.studentAssignmentId, { checkStatus: "done", grade: g })}
              testID={`check-grade-${g}`}
            />
          ))}
        </View>
      )}
      <View style={styles.keys}>
        <PadKey
          label={text.statuses.incomplete}
          small
          onPress={() => record(selectedRow.studentAssignmentId, { checkStatus: "incomplete" })}
          testID="check-pad-incomplete"
        />
        <PadKey
          label={text.statuses.not_done}
          small
          onPress={() => record(selectedRow.studentAssignmentId, { checkStatus: "not_done", marks: null, grade: null, remark: null })}
          testID="check-pad-not-done"
        />
        <PadKey
          label={grading === "marks" ? text.next : text.skip}
          small
          accent
          onPress={() => (grading === "marks" ? commitMarks() : moveNext(selectedRow.studentAssignmentId))}
          testID="check-pad-next"
        />
      </View>
    </View>
  ) : null;

  const footer = (
    <View style={styles.footer}>
      {pad}
      {save.isError ? <Notice tone="critical" message={toFriendlyError(save.error).message} testID="check-save-error" /> : null}
      <CapsuleButton
        title={changes.length ? text.saveCount(changes.length) : text.nothingToSave}
        icon="check"
        onPress={() =>
          save.mutate({
            ...input,
            results: changes.map((c) => ({
              studentAssignmentId: c.studentAssignmentId,
              checkStatus: c.checkStatus,
              marks: c.marks,
              grade: c.grade,
              remark: c.remark,
              note: c.note,
            })),
          })
        }
        loading={save.isPending}
        disabled={changes.length === 0 || save.isPending}
        testID="check-save"
        style={styles.stretch}
      />
    </View>
  );

  const sheetRow = sheetFor ? rows.find((r) => r.studentAssignmentId === sheetFor) : null;

  return (
    <ScreenFrame
      title={title}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="check-back"
      stickyHeader={register.data ? header : undefined}
      footer={register.data ? footer : undefined}
    >
      {register.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : register.isError ? (
        <ErrorCard cause={register.error} onRetry={() => void register.refetch()} testID="check-error" />
      ) : (
        <FlatList
          data={rows}
          scrollEnabled={false}
          keyExtractor={(r) => r.studentAssignmentId}
          extraData={[drafts, selected]}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          style={styles.list}
          renderItem={({ item }) => (
            <CheckRow
              row={item}
              draft={drafts[item.studentAssignmentId]!}
              comesBack={hw?.comesBack ?? "brought"}
              selected={selected === item.studentAssignmentId}
              onPress={() => onRowPress(item)}
              onHold={() => setSheetFor(item.studentAssignmentId)}
            />
          )}
        />
      )}

      {sheetRow ? (
        <ChildSheet
          row={sheetRow}
          draft={drafts[sheetRow.studentAssignmentId]!}
          onChange={(patch) => setDraft(sheetRow.studentAssignmentId, patch)}
          onClose={() => setSheetFor(null)}
        />
      ) : null}
    </ScreenFrame>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: Tone }) {
  return (
    <View style={[styles.count, { backgroundColor: colors.tone[tone].bg }]}>
      <ThemedText variant="bodyStrong" color={colors.tone[tone].fg}>
        {String(n)}
      </ThemedText>
      <ThemedText variant="caption" color={colors.tone[tone].fg}>
        {label}
      </ThemedText>
    </View>
  );
}

function CheckRow({
  row,
  draft,
  comesBack,
  selected,
  onPress,
  onHold,
}: {
  row: RegisterRow;
  draft: CheckDraft;
  comesBack: string;
  selected: boolean;
  onPress: () => void;
  onHold: () => void;
}) {
  const status = draft.checkStatus;
  const label = status ? text.statuses[status] : text.unset;
  const score = draft.marks ?? draft.grade ?? (draft.remark ? text.remarks[draft.remark] : null);
  const sub = [
    row.rollNumber ? text.roll(row.rollNumber) : null,
    row.absentToday && comesBack === "brought" ? text.absentToday : null,
    row.submittedAt ? `${text.sent(formatDue(row.submittedAt))}${row.isLate ? ` · ${text.late}` : ""}` : null,
    draft.note ? `“${draft.note}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text.row(row.name, row.rollNumber, score ? `${label}, ${score}` : label)}
      accessibilityHint={text.rowHint}
      accessibilityActions={[{ name: "longpress", label: text.changeAction }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress") onHold();
      }}
      onPress={onPress}
      onLongPress={onHold}
      delayLongPress={400}
      style={({ pressed }) => [styles.row, selected ? styles.rowSelected : null, pressed ? styles.pressed : null]}
      testID={`check-row-${row.studentAssignmentId}`}
    >
      <Avatar name={row.name} />
      <View style={styles.grow}>
        <ThemedText variant="name" numberOfLines={1}>
          {row.name}
        </ThemedText>
        {sub ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {sub}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.mark,
          { backgroundColor: status ? colors.tone[STATUS_TONE[status]].bg : colors.field },
        ]}
      >
        <ThemedText
          variant="bodyStrong"
          color={status ? colors.tone[STATUS_TONE[status]].fg : colors.muted}
          numberOfLines={1}
          maxFontSizeMultiplier={1.25}
        >
          {score ?? (status ? text.short[status] : "–")}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function PadKey({
  label,
  onPress,
  tone,
  small,
  accent,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  small?: boolean;
  accent?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        small ? styles.keySmall : null,
        tone ? { backgroundColor: colors.tone[tone].bg } : null,
        accent ? styles.keyAccent : null,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <ThemedText
        variant="bodyStrong"
        color={accent ? colors.onAccent : tone ? colors.tone[tone].fg : colors.ink}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Hold on a child (frame 19): status, a note the student sees, quick chips. */
function ChildSheet({
  row,
  draft,
  onChange,
  onClose,
}: {
  row: RegisterRow;
  draft: CheckDraft;
  onChange: (patch: Partial<CheckDraft>) => void;
  onClose: () => void;
}) {
  const statuses: CheckStatus[] = ["done", "incomplete", "not_done", "absent"];
  return (
    <FormSheet
      visible
      title={text.sheetTitle(row.name)}
      onClose={onClose}
      testIDPrefix="check-sheet"
      footer={<CapsuleButton title={text.done} onPress={onClose} testID="check-sheet-done" />}
    >
      <View style={styles.sheetBody}>
        <View style={styles.statusRow}>
          {statuses.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityState={{ selected: draft.checkStatus === s }}
              onPress={() => onChange({ checkStatus: s })}
              style={[
                styles.statusOpt,
                draft.checkStatus === s
                  ? { backgroundColor: colors.tone[STATUS_TONE[s]].bg, borderColor: colors.tone[STATUS_TONE[s]].fg }
                  : null,
              ]}
              testID={`check-sheet-${s}`}
            >
              <ThemedText variant="bodyStrong" color={draft.checkStatus === s ? colors.tone[STATUS_TONE[s]].fg : colors.ink}>
                {text.statuses[s]}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <ThemedText variant="sectionLabel">{text.noteLabel}</ThemedText>
        <View style={styles.chips}>
          {text.noteChips.map((c) => (
            <Pressable key={c} accessibilityRole="button" onPress={() => onChange({ note: c })} style={styles.noteChip}>
              <ThemedText variant="chip">{c}</ThemedText>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={draft.note ?? ""}
          onChangeText={(v) => onChange({ note: v })}
          placeholder={text.notePlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={1000}
          multiline
          style={styles.note}
          testID="check-sheet-note"
        />
        {draft.checkStatus ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange({ checkStatus: null, marks: null, grade: null, remark: null })}
            style={styles.clear}
            testID="check-sheet-clear"
          >
            <ThemedText variant="meta" color={colors.tone.critical.fg}>
              {text.clear}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },
  header: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  counts: { flexDirection: "row", gap: spacing.xs },
  count: { flex: 1, alignItems: "center", paddingVertical: spacing.xs, borderRadius: radius.sm },
  loading: { gap: spacing.sm, marginTop: spacing.md },
  list: { marginTop: spacing.md, borderRadius: radius.lg, overflow: "hidden" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  rowSelected: { backgroundColor: colors.accentTint },
  mark: {
    minWidth: 56,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { gap: spacing.sm },
  stretch: { alignSelf: "stretch" },
  allDone: { alignSelf: "flex-start" },
  pad: { gap: spacing.sm },
  padHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  keys: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  key: {
    width: "32%",
    flexGrow: 1,
    height: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.field,
  },
  keySmall: { height: 44 },
  keyAccent: { backgroundColor: colors.accent },
  sheetBody: { gap: spacing.md },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statusOpt: {
    width: "48%",
    flexGrow: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "transparent",
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  noteChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    justifyContent: "center",
    backgroundColor: colors.chip,
  },
  note: {
    minHeight: 72,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    color: colors.ink,
    textAlignVertical: "top",
  },
  clear: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  savedWrap: { gap: spacing.md, marginTop: spacing.lg },
  followUp: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
});
