import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { sectionLabel, type RegisterRow } from "../../lib/homework";
import { answerSummary } from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { AnswerGradeSheet } from "./answer-grade-sheet";
import { InfoChip, ProgressBar } from "./ui";

const text = copy.homework.quiz;

type Group = "toMark" | "marked" | "open" | "notStarted";
function groupOf(r: RegisterRow): Group {
  if (r.status === "checked") return "marked";
  if (r.status === "submitted") return "toMark";
  if (r.status === "in_progress") return "open";
  return "notStarted";
}

/**
 * A quiz for one class (frame 23): who handed in, the class average, the
 * written answers still to mark, and each child's answers. The app marks
 * everything it can; the teacher marks only the written answers.
 */
export function QuizResultsScreen() {
  const { id, sectionId, subjectId } = useLocalSearchParams<{ id: string; sectionId: string; subjectId: string }>();
  const { organizationId } = useActiveContext();
  const input = { organizationId: organizationId ?? "", id, sectionId, subjectId };
  const register = trpc.homework.register.get.useQuery(input, { enabled: Boolean(organizationId && id) });
  const [focus, setFocus] = useState<RegisterRow | null>(null);

  const rows = useMemo(() => register.data?.rows ?? [], [register.data]);
  const groups = useMemo(() => {
    const g: Record<Group, RegisterRow[]> = { toMark: [], marked: [], open: [], notStarted: [] };
    for (const r of rows) g[groupOf(r)].push(r);
    return g;
  }, [rows]);
  const hw = register.data?.homework;
  const max = Number(hw?.maxMarks ?? 0);
  const marked = groups.marked.filter((r) => r.marks !== null);
  const average = marked.length ? marked.reduce((s, r) => s + Number(r.marks), 0) / marked.length : null;
  const handedIn = groups.marked.length + groups.toMark.length;

  if (focus && register.data) {
    return (
      <QuizChild
        row={focus}
        pair={{ sectionId, subjectId }}
        homeworkId={id}
        max={hw?.maxMarks ?? "0"}
        onBack={() => {
          setFocus(null);
          void register.refetch();
        }}
      />
    );
  }

  return (
    <ScreenFrame
      title={register.data ? sectionLabel(register.data.className, register.data.sectionName) : text.title}
      meta={hw ? `${hw.title} · ${text.title}` : undefined}
      backAccessibilityLabel={copy.common.back}
      onRefresh={() => void register.refetch()}
      refreshing={register.isRefetching}
    >
      {register.isPending ? (
        <View style={styles.stack}>
          <Skeleton height={120} />
          <Skeleton height={64} />
        </View>
      ) : register.isError ? (
        <ErrorCard cause={register.error} onRetry={() => void register.refetch()} />
      ) : (
        <>
          <Card style={styles.summary}>
            <View style={styles.stats}>
              <Stat value={average === null ? "–" : `${Math.round(average * 10) / 10}`} label={text.average(String(max))} />
              <Stat value={`${handedIn}/${rows.length}`} label={text.handedIn} />
              <Stat value={String(groups.toMark.length)} label={text.toMark} warn={groups.toMark.length > 0} />
            </View>
            <ProgressBar value={handedIn} total={rows.length} />
          </Card>
          {(["toMark", "marked", "open", "notStarted"] as Group[]).map((g) =>
            groups[g].length ? (
              <View key={g}>
                <SectionLabel style={styles.label}>{text.groups[g]}</SectionLabel>
                <Card padless>
                  {groups[g].map((r, i) => (
                    <Pressable
                      key={r.studentAssignmentId}
                      accessibilityRole="button"
                      disabled={g === "notStarted"}
                      onPress={() => setFocus(r)}
                      style={({ pressed }) => [styles.row, i > 0 ? styles.divider : null, pressed ? styles.pressed : null]}
                      testID={`quiz-row-${r.studentAssignmentId}`}
                    >
                      <Avatar name={r.name} />
                      <View style={styles.grow}>
                        <ThemedText variant="name" numberOfLines={1}>
                          {r.name}
                        </ThemedText>
                        {r.rollNumber ? <ThemedText variant="meta">{copy.homework.check.roll(r.rollNumber)}</ThemedText> : null}
                      </View>
                      {r.marks !== null ? (
                        <InfoChip label={`${Number(r.marks)} / ${max}`} tone="positive" />
                      ) : g === "toMark" ? (
                        <InfoChip label={text.needsMarking} tone="caution" />
                      ) : null}
                      {g !== "notStarted" ? <AppIcon name="chevronRight" size={18} color={colors.chevron} /> : null}
                    </Pressable>
                  ))}
                </Card>
              </View>
            ) : null,
          )}
        </>
      )}
    </ScreenFrame>
  );
}

function Stat({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <ThemedText variant="title" color={warn ? colors.tone.caution.fg : colors.ink}>
        {value}
      </ThemedText>
      <ThemedText variant="caption">{label}</ThemedText>
    </View>
  );
}

/** One child's attempt: every answer, the app's marks, and Mark on the written ones. */
function QuizChild({
  row,
  pair,
  homeworkId,
  max,
  onBack,
}: {
  row: RegisterRow;
  pair: { sectionId: string; subjectId: string };
  homeworkId: string;
  max: string;
  onBack: () => void;
}) {
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();
  const attempts = trpc.homework.students.attempts.list.useQuery({
    organizationId: organizationId ?? "",
    id: row.studentAssignmentId,
    ...pair,
  });
  const questions = trpc.homework.questions.get.useQuery({ organizationId: organizationId ?? "", id: homeworkId });
  const grade = trpc.homework.students.attempts.gradeAnswer.useMutation({
    onSuccess: () => {
      setMarking(null);
      void attempts.refetch();
      void utils.homework.home.invalidate();
    },
  });
  const [marking, setMarking] = useState<string | null>(null);

  const attempt = attempts.data?.[0] ?? null;
  const byId = new Map((questions.data ?? []).map((q) => [q.id, q]));
  const answer = attempt?.answers.find((a) => a.id === marking);

  return (
    <ScreenFrame
      title={row.name}
      meta={attempt ? `${Number(attempt.totalScore)} / ${Number(attempt.maxScore || max)}` : undefined}
      backAccessibilityLabel={copy.common.back}
    >
      {attempts.isPending || questions.isPending ? (
        <View style={styles.stack}>
          <Skeleton height={88} />
          <Skeleton height={88} />
        </View>
      ) : attempts.isError ? (
        <ErrorCard cause={attempts.error} onRetry={() => void attempts.refetch()} />
      ) : !attempt ? (
        <ThemedText variant="meta" style={styles.stack}>
          {text.notStartedBody}
        </ThemedText>
      ) : (
        <View style={styles.stack}>
          {attempt.answers
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((a) => {
              const q = byId.get(a.assignmentQuestionId);
              const summary = answerSummary(
                a.questionType,
                a.answer,
                q?.options?.map((o) => ({ id: o.id, text: o.text })) ?? null,
              );
              const waiting = a.needsManualReview && a.marksAwarded === null;
              return (
                <Card key={a.id} style={styles.answer}>
                  <View style={styles.answerHead}>
                    <View style={styles.number}>
                      <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                        {String(a.position)}
                      </ThemedText>
                    </View>
                    <ThemedText variant="body" style={styles.grow}>
                      {a.body}
                    </ThemedText>
                  </View>
                  <View style={styles.given}>
                    <ThemedText variant="body">{summary ?? text.leftBlank}</ThemedText>
                  </View>
                  <View style={styles.answerFoot}>
                    {a.isCorrect === true ? <InfoChip label={text.correct} tone="positive" icon="check" /> : null}
                    {a.isCorrect === false ? <InfoChip label={text.wrong} tone="critical" icon="close" /> : null}
                    {waiting ? <InfoChip label={text.needsMarking} tone="caution" /> : null}
                    <ThemedText variant="meta" style={styles.grow}>
                      {a.marksAwarded !== null ? `${Number(a.marksAwarded)} / ${Number(q?.marks ?? 0)}` : ""}
                    </ThemedText>
                    {a.needsManualReview ? (
                      <CapsuleButton
                        title={waiting ? text.mark : text.changeMark}
                        size="compact"
                        variant={waiting ? "primary" : "secondary"}
                        onPress={() => setMarking(a.id)}
                        testID={`quiz-mark-${a.id}`}
                      />
                    ) : null}
                  </View>
                </Card>
              );
            })}
        </View>
      )}

      {marking && answer && attempt ? (
        <AnswerGradeSheet
          position={answer.position}
          body={answer.body}
          max={byId.get(answer.assignmentQuestionId)?.marks ?? "0"}
          initialMarks={answer.marksAwarded ?? ""}
          initialFeedback={answer.feedback ?? ""}
          submitting={grade.isPending}
          error={grade.error}
          onSubmit={({ marks, feedback }) =>
            grade.mutate({
              organizationId: organizationId ?? "",
              id: attempt.id,
              ...pair,
              answerId: answer.id,
              marksAwarded: marks,
              ...(feedback ? { feedback } : {}),
            })
          }
          onClose={() => setMarking(null)}
        />
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, marginTop: spacing.md },
  grow: { flex: 1, gap: spacing.xxs },
  summary: { marginTop: spacing.md, gap: spacing.md },
  stats: { flexDirection: "row" },
  stat: { flex: 1, alignItems: "center", gap: spacing.xxs },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { opacity: 0.85 },
  answer: { gap: spacing.sm },
  answerHead: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  number: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentTint },
  given: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.canvas },
  answerFoot: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
