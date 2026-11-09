import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { countdown, resultLabel, shownWord } from "../../lib/homework";
import type { PortalDetail } from "../../lib/homework";
import { Enter, Reveal, usePress } from "../../motion";
import { useFamilyTheme } from "../../theme";
import {
  FButton,
  FErrorState,
  FHand,
  FHeader,
  FMascot,
  FNote,
  FRow,
  FScreen,
  FSkeleton,
  FStamp,
  FText,
} from "../../ui";
import { AnswerBox, countdownTone, KindTile, useCountdownLabel, useNow, WordPill } from "./parts";
import { PhotoRow } from "./photos";

/** "2026-11-09" and "19:20:00" from a Date, for the family formatters. */
export function isoParts(value: Date | string): { day: string; clock: string } {
  const d = new Date(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    clock: `${p(d.getHours())}:${p(d.getMinutes())}:00`,
  };
}

/** "Mon, 9 Nov · 8:00 PM". */
export function useWhen() {
  const format = useFormat();
  return (value: Date | string) => {
    const { day, clock } = isoParts(value);
    return `${format.date(day, "weekdayDayMonth")} · ${format.time(clock)}`;
  };
}

/**
 * One homework for the child. What the teacher wants back decides the main
 * action: send photos, tick it, take the quiz, or bring it to class. Checked
 * work shows the stamp and the teacher's note; sent-back work leads with the
 * note and "Send again".
 */
export function FamilyHomeworkDetail() {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const input = { studentId, studentAssignmentId: id ?? "" };
  const detail = trpc.portalHomework.get.useQuery(input, { enabled: studentId.length > 0 && !!id });
  const viewed = trpc.portalHomework.markViewed.useMutation();
  const seen = useRef(false);
  const data = detail.data;

  useEffect(() => {
    if (data && !seen.current) {
      seen.current = true;
      viewed.mutate(input);
    }
    // Once per screen; `input` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/family/homework"));
  const header = (
    <FHeader
      title={data?.title ?? ""}
      onBack={back}
      backLabel={t("detail.back")}
      context={data ? <FText variant="meta" color="muted">{t("detail.context", { subject: data.subjectName, kind: t(`kind.${data.kind}`) })}</FText> : null}
      trailing={
        data ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("detail.questionsRow")}
            hitSlop={12}
            onPress={() => router.push({ pathname: "/family/homework/questions", params: { id: data.studentAssignmentId } })}
          >
            <AppIcon name="comments" size={22} color={theme.color.ink} />
          </Pressable>
        ) : null
      }
    />
  );

  if (detail.isError && !data) {
    return (
      <FScreen header={header}>
        <FErrorState onRetry={() => void detail.refetch()} />
      </FScreen>
    );
  }

  return (
    <FScreen testID="family-homework-detail" header={header} refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      <Reveal
        loading={detail.isPending}
        placeholder={
          <View style={{ gap: theme.space.lg }}>
            <FSkeleton width="50%" height={28} />
            <FSkeleton height={120} radius="xl" />
            <FSkeleton height={80} radius="lg" />
          </View>
        }
      >
        {data ? <Body data={data} now={now} input={input} /> : null}
      </Reveal>
    </FScreen>
  );
}

function Body({ data, now, input }: { data: PortalDetail; now: Date; input: { studentId: string; studentAssignmentId: string } }) {
  const { t } = useTranslation("homework");
  const format = useFormat();
  const theme = useFamilyTheme();
  const label = useCountdownLabel();
  const word = shownWord(data);
  const c = countdown(data.dueAt, data.closeAt, now);
  const open = data.word === "to_do" || data.word === "redo";
  const goSend = () => router.push({ pathname: "/family/homework/send", params: { id: data.studentAssignmentId } });

  return (
    <View style={{ gap: theme.components.screen.sectionGap }}>
      <View style={[styles.row, { gap: theme.space.md }]}>
        <KindTile kind={data.kind} subject={data.subjectName} size={54} />
        <WordPill word={word} />
        {data.book ? (
          <FText variant="meta" color="muted" numberOfLines={1} style={styles.flex}>
            {data.book}
          </FText>
        ) : null}
      </View>

      <View style={[styles.row, styles.wrap, { gap: theme.space.sm }]}>
        {open || data.word === "sent" ? (
          <Chip icon="clock" tone={countdownTone(c)} label={`${label(c)} · ${whenLabel(format, data.dueAt)}`} />
        ) : null}
        {data.estimatedMinutes ? <Chip label={t("detail.about", { time: format.duration(data.estimatedMinutes) })} /> : null}
        {data.gradingMode !== "none" ? (
          <Chip
            icon="grade"
            label={
              data.gradingMode === "marks"
                ? t("detail.grading.marks", { max: format.marks(data.maxMarks ?? "0") })
                : t(`detail.grading.${data.gradingMode}`)
            }
          />
        ) : null}
      </View>

      {data.word === "checked" ? <Checked data={data} /> : null}
      {data.word === "redo" ? <Redo data={data} onSend={goSend} /> : null}
      {data.word === "missed" ? (
        <FText variant="body" color="muted">
          {data.note ?? t("detail.missedBody")}
        </FText>
      ) : null}

      {data.details || data.files.length > 0 ? (
        <Section title={t("detail.from", { name: data.teacherName })}>
          <View style={{ backgroundColor: theme.color.surfaceMuted, borderRadius: theme.radius.lg, padding: theme.space.lg, gap: theme.space.md }}>
            {data.details ? (
              <FText variant="body" selectable>
                {data.details}
              </FText>
            ) : null}
            <PhotoRow photos={data.files} size={86} />
          </View>
        </Section>
      ) : null}

      {data.word !== "checked" && data.word !== "redo" && data.word !== "missed" ? (
        <Action data={data} input={input} onSend={goSend} />
      ) : null}

      <FRow
        testID="hw-questions"
        title={t("detail.questionsRow")}
        subtitle={t("detail.questionsSub")}
        leading={<AppIcon name="comments" size={22} color={theme.color.ink} />}
        onPress={() => router.push({ pathname: "/family/homework/questions", params: { id: data.studentAssignmentId } })}
      />
    </View>
  );
}

function whenLabel(format: ReturnType<typeof useFormat>, value: Date | string) {
  const { day, clock } = isoParts(value);
  return `${format.date(day, "weekdayDayMonth")}, ${format.time(clock)}`;
}

/** What the child does next, by what the teacher wants back. */
function Action({ data, input, onSend }: { data: PortalDetail; input: { studentId: string; studentAssignmentId: string }; onSend: () => void }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const when = useWhen();

  if (data.comesBack === "tick") return <TickButton data={data} input={input} />;

  if (data.comesBack === "questions") return <QuizEntry data={data} />;

  if (data.comesBack === "brought" || data.comesBack === "none") {
    const brought = data.comesBack === "brought";
    return (
      <View style={{ gap: theme.space.lg }}>
        <HowTo
          icon={brought ? "project" : "check"}
          tone={brought ? "caution" : "neutral"}
          title={t(brought ? "detail.how.brought" : "detail.how.none")}
          hint={brought ? t("detail.how.broughtHint", { name: data.teacherName }) : t("detail.how.noneHint")}
        />
        {data.kind === "project" || data.kind === "reading" ? (
          <View style={[styles.row, styles.end, { gap: theme.space.md }]}>
            <FHand align="right">{t(data.kind === "project" ? "bookie.project" : "bookie.reading")}</FHand>
            <FMascot size={64} look="left" />
          </View>
        ) : null}
      </View>
    );
  }

  // Photos.
  if (data.submission) {
    return (
      <View style={{ gap: theme.space.lg }}>
        <Section title={t("detail.yourWork")}>
          <FText variant="meta" color="muted">
            {t(data.submission.isLate ? "detail.sentLate" : "detail.sentAt", { when: when(data.submission.submittedAt) })}
          </FText>
          {data.submission.bodyText ? <AnswerBox text={data.submission.bodyText} /> : null}
          <PhotoRow photos={data.submission.files} />
          <FText variant="meta" color="muted">
            {t("detail.waiting", { name: data.teacherName })}
          </FText>
        </Section>
        {data.canSend ? <FButton testID="hw-replace" label={t("detail.replace")} variant="secondary" icon="camera" block onPress={onSend} /> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: theme.space.lg }}>
      <HowTo icon="camera" tone="info" title={t("detail.how.sent")} hint={t("detail.how.sentHint")} />
      {data.canSend ? <FButton testID="hw-send" label={t("detail.send")} icon="camera" block onPress={onSend} /> : null}
    </View>
  );
}

function TickButton({ data, input }: { data: PortalDetail; input: { studentId: string; studentAssignmentId: string } }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const when = useWhen();
  const format = useFormat();
  const utils = trpc.useUtils();
  const press = usePress(0.94);
  const tick = trpc.portalHomework.tick.useMutation({
    onSuccess: (next) => {
      utils.portalHomework.get.setData(input, next);
      void utils.portalHomework.list.invalidate();
    },
  });
  const look = theme.components.homework.tick;
  const ticked = data.word !== "to_do";
  const now = useNow();
  const canPress = ticked ? data.canUntick : new Date(data.closeAt).getTime() > now.getTime();
  const verb = data.kind === "reading" ? t("tick.read") : t("tick.do");

  return (
    <View style={[styles.center, { gap: theme.space.md }]}>
      <Pressable
        testID="hw-tick"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked, disabled: !canPress }}
        accessibilityLabel={verb}
        disabled={!canPress || tick.isPending}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => tick.mutate({ ...input, ticked: !ticked })}
      >
        <Enter key={String(ticked)}>
          <View
            style={[
              styles.center,
              {
                width: look.size,
                height: look.size,
                borderRadius: look.size / 2,
                backgroundColor: ticked ? look.on : look.off,
                borderWidth: ticked ? 0 : 3,
                borderStyle: "dashed",
                borderColor: look.border,
                gap: theme.space.xs,
              },
            ]}
          >
            <AppIcon name="check" size={56} color={ticked ? look.fg : theme.color.faint} />
            <FText variant="bodyStrong" tint={ticked ? look.fg : theme.color.ink}>
              {verb}
            </FText>
          </View>
        </Enter>
      </Pressable>
      {ticked && data.submission ? (
        <FText variant="bodyStrong">{t("tick.ticked", { time: format.time(isoParts(data.submission.submittedAt).clock) })}</FText>
      ) : null}
      <FText variant="meta" color={tick.isError ? "critical" : "muted"} align="center">
        {tick.isError ? t("tick.failed") : ticked ? (data.canUntick ? t("tick.undoUntil", { when: when(data.dueAt) }) : t("tick.locked")) : t("detail.how.tickHint")}
      </FText>
    </View>
  );
}

function QuizEntry({ data }: { data: PortalDetail }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const format = useFormat();
  const quiz = data.quiz;
  const status = quiz?.attemptStatus ?? null;
  const go = () => router.push({ pathname: "/family/homework/quiz", params: { id: data.studentAssignmentId } });
  const finished = status === "submitted" || status === "graded";
  const now = useNow();
  const closed = new Date(data.closeAt).getTime() <= now.getTime();

  return (
    <View style={{ gap: theme.space.lg }}>
      <View style={[styles.row, { gap: theme.space.sm }]}>
        <Fact value={String(quiz?.questionCount ?? 0)} label={t("quiz.questions")} />
        {data.maxMarks ? <Fact value={format.marks(data.maxMarks)} label={t("quiz.marks")} /> : null}
        {data.estimatedMinutes ? <Fact value={String(data.estimatedMinutes)} label={t("quiz.minutes")} /> : null}
      </View>
      {!finished ? (
        <Section title={t("quiz.before")}>
          <Rule icon="lock" text={t("quiz.ruleOne")} />
          <Rule icon="chevronRight" text={t("quiz.ruleSkip")} />
          <Rule icon="grade" text={t("quiz.ruleScore")} />
        </Section>
      ) : null}
      {finished ? (
        <FButton testID="hw-quiz-result" label={t("quiz.seeResult")} icon="grade" block onPress={go} />
      ) : !closed ? (
        <View style={{ gap: theme.space.md }}>
          <View style={[styles.row, styles.end, { gap: theme.space.md }]}>
            <FHand align="right">{t("bookie.goodLuck")}</FHand>
            <FMascot size={56} look="left" />
          </View>
          <FButton testID="hw-quiz-start" label={status === "in_progress" ? t("quiz.resume") : t("quiz.start")} block onPress={go} />
        </View>
      ) : null}
    </View>
  );
}

function Checked({ data }: { data: PortalDetail }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const r = resultLabel(data);
  const look = data.checkStatus ? t(`detail.checkLook.${data.checkStatus}`) : t("detail.noResult");
  const value = !r ? look : "remark" in r ? t(`remark.${r.remark}`) : r.value;
  const unit = r && !("remark" in r) ? r.unit : undefined;
  // Praise only what is plainly great: full marks or Excellent.
  const great =
    data.checkStatus === "done" &&
    r !== null &&
    ("remark" in r ? r.remark === "excellent" : data.gradingMode === "marks" && data.marks !== null && Number(data.marks) === Number(data.maxMarks));

  return (
    <View style={{ gap: theme.space.xl }}>
      <View style={[styles.row, { gap: theme.space.md }]}>
        <FStamp
          testID="hw-stamp"
          tone={data.checkStatus === "done" ? "green" : "coral"}
          kicker={t("detail.stampKicker", { subject: data.subjectName })}
          value={value}
          unit={unit}
          sub={r ? look : undefined}
          width={200}
        />
        {great ? (
          <View style={[styles.flex, { gap: theme.space.sm }]}>
            <FHand tone="positive">{t("detail.best")}</FHand>
            <FMascot size={60} mood="happy" look="left" />
          </View>
        ) : null}
      </View>
      {data.note ? <FNote testID="hw-note" body={data.note} by={data.teacherName} /> : null}
      {data.comesBack === "questions" && data.quiz?.attemptId ? (
        <FButton
          testID="hw-quiz-answers"
          label={t("quiz.seeResult")}
          icon="grade"
          variant="secondary"
          block
          onPress={() => router.push({ pathname: "/family/homework/quiz", params: { id: data.studentAssignmentId } })}
        />
      ) : null}
      {data.submission && (data.submission.files.length > 0 || data.submission.bodyText) ? (
        <Section title={t("detail.yourWork")}>
          {data.submission.bodyText ? <AnswerBox text={data.submission.bodyText} /> : null}
          <PhotoRow photos={data.submission.files} />
        </Section>
      ) : null}
    </View>
  );
}

function Redo({ data, onSend }: { data: PortalDetail; onSend: () => void }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.xl }}>
      {data.note ? <FNote testID="hw-redo-note" look="redo" body={data.note} by={t("detail.sentBack", { name: data.teacherName })} /> : null}
      {data.submission && (data.submission.files.length > 0 || data.submission.bodyText) ? (
        <Section title={t("detail.lastTime")}>
          {data.submission.bodyText ? <AnswerBox text={data.submission.bodyText} /> : null}
          <PhotoRow photos={data.submission.files} faded />
          <FText variant="meta" color="muted">
            {t("detail.replaceNote")}
          </FText>
        </Section>
      ) : null}
      {data.canSend ? <FButton testID="hw-send-again" label={t("detail.sendAgain")} icon="camera" block onPress={onSend} /> : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <FText variant="label" color="muted">
        {title}
      </FText>
      {children}
    </View>
  );
}

function Chip({ label, icon, tone }: { label: string; icon?: AppIconName; tone?: "critical" | "caution" | "muted" }) {
  const theme = useFamilyTheme();
  const fg = tone && tone !== "muted" ? theme.tone[tone].fg : theme.color.ink;
  const bg = tone && tone !== "muted" ? theme.tone[tone].bg : theme.color.surfaceMuted;
  return (
    <View style={[styles.row, { gap: theme.space.xs, backgroundColor: bg, borderRadius: theme.radius.full, paddingHorizontal: theme.space.md, minHeight: 34 }]}>
      {icon ? <AppIcon name={icon} size={16} color={fg} /> : null}
      <FText variant="meta" tint={fg} numberOfLines={1}>
        {label}
      </FText>
    </View>
  );
}

function HowTo({ icon, tone, title, hint }: { icon: AppIconName; tone: "info" | "caution" | "neutral"; title: string; hint: string }) {
  const theme = useFamilyTheme();
  const colors = theme.tone[tone];
  return (
    <View style={{ gap: theme.space.md }}>
      <View
        style={[
          styles.row,
          {
            gap: theme.space.md,
            padding: theme.space.lg,
            borderRadius: theme.radius.lg,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: tone === "caution" ? colors.fg : theme.components.homework.howTo.border,
          },
        ]}
      >
        <View style={[styles.center, { width: 42, height: 42, borderRadius: theme.radius.md, backgroundColor: colors.bg }]}>
          <AppIcon name={icon} size={22} color={colors.fg} />
        </View>
        <View style={[styles.flex, { gap: 2 }]}>
          <FText variant="bodyStrong">{title}</FText>
          <FText variant="meta" color="muted">
            {hint}
          </FText>
        </View>
      </View>
    </View>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  const theme = useFamilyTheme();
  return (
    <View style={[styles.flex, { backgroundColor: theme.color.surfaceMuted, borderRadius: theme.radius.lg, padding: theme.space.md }]}>
      <FText variant="number">{value}</FText>
      <FText variant="meta" color="muted">
        {label}
      </FText>
    </View>
  );
}

function Rule({ icon, text }: { icon: AppIconName; text: string }) {
  const theme = useFamilyTheme();
  const colors = theme.tone.positive;
  return (
    <View style={[styles.row, { gap: theme.space.md, alignItems: "flex-start" }]}>
      <View style={[styles.center, { width: 34, height: 34, borderRadius: theme.radius.sm, backgroundColor: colors.bg }]}>
        <AppIcon name={icon} size={18} color={colors.fg} />
      </View>
      <FText variant="body" style={styles.flex}>
        {text}
      </FText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexWrap: "wrap" },
  end: { justifyContent: "flex-end" },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
});
