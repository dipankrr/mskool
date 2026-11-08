import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { CheckStatus, Remark } from "@repo/contracts";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatDue, marksValid, sectionLabel, type RegisterRow } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors, type Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { InfoChip, PhotoStrip } from "./ui";

const text = copy.homework.review;
const statuses = copy.homework.check.statuses;
const remarks = copy.homework.check.remarks;

const STATUS_TONE: Record<CheckStatus, Tone> = {
  done: "positive",
  incomplete: "caution",
  not_done: "critical",
  absent: "neutral",
};

type Group = "toReview" | "reviewed" | "redo" | "notSent";

function groupOf(r: RegisterRow): Group {
  if (r.status === "checked") return "reviewed";
  if (r.status === "redo") return "redo";
  if (r.status === "submitted") return "toReview";
  return "notSent";
}

/**
 * Work sent in the app (frames 21 and 22). The class grouped by what each
 * child needs, then one child at a time: their photos and typed answer, a
 * result in the homework's grading, a note they see, Save · next, or Redo
 * with a note. Nothing is shown as saved until the server says so.
 */
export function ReviewScreen() {
  const { id, sectionId, subjectId } = useLocalSearchParams<{ id: string; sectionId: string; subjectId: string }>();
  const { organizationId } = useActiveContext();
  const input = { organizationId: organizationId ?? "", id, sectionId, subjectId };
  const register = trpc.homework.register.get.useQuery(input, { enabled: Boolean(organizationId && id) });
  const [focus, setFocus] = useState<string | null>(null);

  const rows = useMemo(() => register.data?.rows ?? [], [register.data]);
  const groups = useMemo(() => {
    const g: Record<Group, RegisterRow[]> = { toReview: [], reviewed: [], redo: [], notSent: [] };
    for (const r of rows) g[groupOf(r)].push(r);
    return g;
  }, [rows]);

  const title = register.data ? sectionLabel(register.data.className, register.data.sectionName) : "";
  const hw = register.data?.homework;

  if (focus && register.data) {
    const queue = [...groups.toReview, ...groups.reviewed, ...groups.redo];
    return (
      <ReviewOne
        key={focus}
        saId={focus}
        queue={queue.map((r) => r.studentAssignmentId)}
        pair={{ sectionId, subjectId }}
        gradingMode={register.data.homework.gradingMode}
        maxMarks={register.data.homework.maxMarks}
        gradeLetters={register.data.gradeLetters}
        title={title}
        onMove={setFocus}
        onBack={() => {
          setFocus(null);
          void register.refetch();
        }}
      />
    );
  }

  return (
    <ScreenFrame
      title={title || text.title}
      meta={hw ? `${hw.title} · ${text.title}` : undefined}
      backAccessibilityLabel={copy.common.back}
      onRefresh={() => void register.refetch()}
      refreshing={register.isRefetching}
    >
      {register.isPending ? (
        <View style={styles.stack}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : register.isError ? (
        <ErrorCard cause={register.error} onRetry={() => void register.refetch()} />
      ) : (
        <>
          <View style={styles.counts}>
            <InfoChip label={`${groups.toReview.length} ${text.toReview}`} tone="caution" />
            <InfoChip label={`${groups.reviewed.length} ${text.reviewed}`} tone="positive" />
            <InfoChip label={`${groups.notSent.length} ${text.notSent}`} tone="neutral" />
          </View>
          {groups.toReview.length === 0 && groups.reviewed.length > 0 ? (
            <Notice tone="positive" title={text.done} message={text.doneBody} style={styles.notice} />
          ) : null}
          {(["toReview", "redo", "reviewed", "notSent"] as Group[]).map((g) =>
            groups[g].length ? (
              <View key={g}>
                <SectionLabel style={styles.label}>{GROUP_LABEL[g]}</SectionLabel>
                <Card padless>
                  {groups[g].map((r, i) => (
                    <Pressable
                      key={r.studentAssignmentId}
                      accessibilityRole="button"
                      disabled={g === "notSent"}
                      onPress={() => setFocus(r.studentAssignmentId)}
                      style={({ pressed }) => [styles.row, i > 0 ? styles.divider : null, pressed ? styles.pressed : null]}
                      testID={`review-row-${r.studentAssignmentId}`}
                    >
                      <Avatar name={r.name} />
                      <View style={styles.grow}>
                        <ThemedText variant="name" numberOfLines={1}>
                          {r.name}
                        </ThemedText>
                        <ThemedText variant="meta" numberOfLines={1}>
                          {[
                            r.rollNumber ? copy.homework.check.roll(r.rollNumber) : null,
                            r.submittedAt ? text.sentAt(formatDue(r.submittedAt)) : null,
                            r.fileCount ? text.photosCount(r.fileCount) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </ThemedText>
                      </View>
                      {r.isLate && g !== "notSent" ? <InfoChip label={text.lateTag} tone="caution" /> : null}
                      {r.checkStatus ? (
                        <InfoChip
                          label={r.marks ?? r.grade ?? (r.remark ? remarks[r.remark] : statuses[r.checkStatus])}
                          tone={STATUS_TONE[r.checkStatus]}
                        />
                      ) : null}
                      {g !== "notSent" ? <AppIcon name="chevronRight" size={18} color={colors.chevron} /> : null}
                    </Pressable>
                  ))}
                </Card>
              </View>
            ) : null,
          )}
          {rows.length === 0 ? <EmptyState icon="homework" title={text.nothing} /> : null}
        </>
      )}
    </ScreenFrame>
  );
}

const GROUP_LABEL: Record<Group, string> = {
  toReview: text.toReview,
  reviewed: text.reviewed,
  redo: text.redoLabel,
  notSent: text.notSent,
};

function ReviewOne({
  saId,
  queue,
  pair,
  gradingMode,
  maxMarks,
  gradeLetters,
  title,
  onMove,
  onBack,
}: {
  saId: string;
  queue: string[];
  pair: { sectionId: string; subjectId: string };
  gradingMode: string;
  maxMarks: string | null;
  gradeLetters: string[];
  title: string;
  onMove: (id: string) => void;
  onBack: () => void;
}) {
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();
  const input = { organizationId: organizationId ?? "", id: saId, ...pair };
  const child = trpc.homework.students.get.useQuery(input, { enabled: Boolean(organizationId) });
  const c = child.data;

  const [status, setStatus] = useState<CheckStatus | null | undefined>(undefined);
  const [marks, setMarks] = useState<string | undefined>(undefined);
  const [grade, setGrade] = useState<string | null | undefined>(undefined);
  const [remark, setRemark] = useState<Remark | null | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoNote, setRedoNote] = useState("");

  const cur = {
    status: status === undefined ? (c?.checkStatus ?? "done") : status,
    marks: marks ?? c?.marks ?? "",
    grade: grade === undefined ? (c?.grade ?? null) : grade,
    remark: remark === undefined ? (c?.remark ?? null) : remark,
    note: note ?? c?.note ?? "",
  };

  const index = queue.indexOf(saId);
  const nextId = queue[index + 1];
  const save = trpc.homework.register.save.useMutation({
    onSuccess: () => {
      void utils.homework.home.invalidate();
      void utils.homework.byId.invalidate();
      if (nextId) onMove(nextId);
      else onBack();
    },
  });
  const sendBack = trpc.homework.students.sendBack.useMutation({
    onSuccess: () => {
      setRedoOpen(false);
      void utils.homework.home.invalidate();
      if (nextId) onMove(nextId);
      else onBack();
    },
  });

  const graded = cur.status === "done" || cur.status === "incomplete";
  const marksBad = gradingMode === "marks" && graded && cur.marks !== "" && !marksValid(cur.marks, maxMarks);

  return (
    <ScreenFrame
      title={c?.name ?? title}
      meta={queue.length > 1 ? text.of(index + 1, queue.length) : title}
      backAccessibilityLabel={copy.common.back}
      footer={
        <View style={styles.footer}>
          {save.isError ? <Notice tone="critical" message={toFriendlyError(save.error).message} /> : null}
          <View style={styles.footerRow}>
            <CapsuleButton
              title={text.redo}
              variant="secondary"
              icon="resubmit"
              onPress={() => setRedoOpen(true)}
              disabled={!c?.submission}
              testID="review-redo"
            />
            <CapsuleButton
              title={nextId ? text.saveNext : text.save}
              icon="check"
              onPress={() =>
                save.mutate({
                  organizationId: organizationId ?? "",
                  id: c!.homeworkId,
                  ...pair,
                  results: [
                    {
                      studentAssignmentId: saId,
                      checkStatus: cur.status,
                      marks: gradingMode === "marks" && graded && cur.marks ? cur.marks : null,
                      grade: gradingMode === "grade" && graded ? cur.grade : null,
                      remark: gradingMode === "remark" && graded ? cur.remark : null,
                      note: cur.note.trim() || null,
                    },
                  ],
                })
              }
              loading={save.isPending}
              disabled={!c || save.isPending || marksBad}
              style={styles.grow}
              testID="review-save"
            />
          </View>
        </View>
      }
    >
      {!c ? (
        child.isError ? (
          <ErrorCard cause={child.error} onRetry={() => void child.refetch()} />
        ) : (
          <View style={styles.stack}>
            <Skeleton height={220} />
            <Skeleton height={120} />
          </View>
        )
      ) : (
        <View style={styles.stack}>
          <View style={styles.counts}>
            {c.submittedAt ? <InfoChip label={text.sentAt(formatDue(c.submittedAt))} icon="clock" /> : null}
            {c.isLate ? <InfoChip label={text.lateTag} tone="caution" /> : null}
          </View>
          {c.submission?.files.length ? (
            <PhotoStrip photos={c.submission.files} size={160} />
          ) : (
            <Notice tone="neutral" message={text.noPhotos} />
          )}
          {c.submission?.bodyText ? (
            <Card>
              <ThemedText variant="sectionLabel">{text.typed}</ThemedText>
              <ThemedText variant="body" selectable style={styles.typed}>
                {c.submission.bodyText}
              </ThemedText>
            </Card>
          ) : null}

          <Card style={styles.result}>
            <ThemedText variant="sectionLabel">{text.statusLabel}</ThemedText>
            <View style={styles.chips}>
              {(["done", "incomplete", "not_done"] as CheckStatus[]).map((s) => (
                <Pressable
                  key={s}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: cur.status === s }}
                  onPress={() => setStatus(s)}
                  style={[
                    styles.choice,
                    cur.status === s ? { backgroundColor: colors.tone[STATUS_TONE[s]].bg, borderColor: colors.tone[STATUS_TONE[s]].fg } : null,
                  ]}
                  testID={`review-status-${s}`}
                >
                  <ThemedText variant="bodyStrong" color={cur.status === s ? colors.tone[STATUS_TONE[s]].fg : colors.ink}>
                    {statuses[s]}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            {graded && gradingMode === "marks" ? (
              <View style={styles.marksRow}>
                <ThemedText variant="body" style={styles.grow}>
                  {text.marksLabel(maxMarks ?? "0")}
                </ThemedText>
                <TextInput
                  value={cur.marks}
                  onChangeText={(v) => setMarks(v.replace(/[^0-9.]/g, ""))}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  style={[styles.marksInput, marksBad ? styles.inputBad : null]}
                  testID="review-marks"
                />
              </View>
            ) : null}
            {graded && gradingMode === "grade" ? (
              <View style={styles.chips}>
                {gradeLetters.map((g) => (
                  <Pressable key={g} onPress={() => setGrade(g)} style={[styles.choice, cur.grade === g ? styles.choiceOn : null]}>
                    <ThemedText variant="bodyStrong" color={cur.grade === g ? colors.accentDeep : colors.ink}>
                      {g}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {graded && gradingMode === "remark" ? (
              <View style={styles.chips}>
                {(["excellent", "good", "bad"] as Remark[]).map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setRemark(r)}
                    style={[styles.choice, cur.remark === r ? styles.choiceOn : null]}
                    testID={`review-remark-${r}`}
                  >
                    <ThemedText variant="bodyStrong" color={cur.remark === r ? colors.accentDeep : colors.ink}>
                      {remarks[r]}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <ThemedText variant="sectionLabel" style={styles.noteLabel}>
              {text.noteLabel}
            </ThemedText>
            <View style={styles.chips}>
              {copy.homework.check.noteChips.map((n) => (
                <Pressable key={n} onPress={() => setNote(n)} style={styles.noteChip}>
                  <ThemedText variant="chip">{n}</ThemedText>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={cur.note}
              onChangeText={setNote}
              placeholder={copy.homework.check.notePlaceholder}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={1000}
              style={styles.note}
              testID="review-note"
            />
          </Card>
        </View>
      )}

      {redoOpen ? (
        <FormSheet
          visible
          title={text.redoTitle}
          onClose={() => setRedoOpen(false)}
          testIDPrefix="review-redo-sheet"
          footer={
            <View style={styles.footer}>
              {sendBack.isError ? <Notice tone="critical" message={toFriendlyError(sendBack.error).message} /> : null}
              <CapsuleButton
                title={text.redoSave}
                onPress={() => sendBack.mutate({ ...input, note: redoNote.trim() })}
                loading={sendBack.isPending}
                disabled={!redoNote.trim() || sendBack.isPending}
                style={styles.stretch}
                testID="review-redo-save"
              />
            </View>
          }
        >
          <View style={styles.stack}>
            <ThemedText variant="meta">{text.redoBody}</ThemedText>
            <TextInput
              value={redoNote}
              onChangeText={setRedoNote}
              placeholder={text.redoPlaceholder}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={1000}
              style={styles.note}
              autoFocus
              testID="review-redo-note"
            />
          </View>
        </FormSheet>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, marginTop: spacing.md },
  grow: { flex: 1, gap: spacing.xxs },
  stretch: { alignSelf: "stretch" },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  notice: { marginTop: spacing.md },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { opacity: 0.85 },
  footer: { gap: spacing.sm },
  footerRow: { flexDirection: "row", gap: spacing.sm },
  typed: { marginTop: spacing.xs },
  result: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.field,
  },
  choiceOn: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  marksRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  marksInput: {
    width: 96,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: colors.ink,
  },
  inputBad: { borderWidth: 1.5, borderColor: colors.tone.critical.fg },
  noteLabel: { marginTop: spacing.sm },
  noteChip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, justifyContent: "center", backgroundColor: colors.chip },
  note: {
    minHeight: 72,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    color: colors.ink,
    textAlignVertical: "top",
  },
});
