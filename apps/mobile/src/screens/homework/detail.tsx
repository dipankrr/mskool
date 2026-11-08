import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { ConfirmSheet } from "../../components/confirm-sheet";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { dueLine, formatDue, sectionLabel } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors, type Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { EditSheet, GiveAgainSheet, MoveDueSheet } from "./detail-sheets";
import { InfoChip, KindTile, PhotoStrip, ProgressBar } from "./ui";

const text = copy.homework.detail;

type Sheet = null | "edit" | "move" | "again" | "close" | "cancel" | "delete";

/**
 * One homework (frame 25): what was asked, each class's progress with the
 * way in to check it, students' questions, and the few real actions. Edits
 * that work has made impossible say why instead of failing.
 */
export function HomeworkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { organizationId } = useActiveContext();
  const { has } = usePermissions();
  const utils = trpc.useUtils();
  const [sheet, setSheet] = useState<Sheet>(null);

  const query = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id },
    { enabled: Boolean(organizationId && id) },
  );
  const hw = query.data;
  const pair = hw ? { sectionId: hw.sections[0]?.sectionId ?? "", subjectId: hw.subjectId } : null;
  const base = { organizationId: organizationId ?? "", id, ...(pair ?? { sectionId: "", subjectId: "" }) };

  const refresh = () => {
    void utils.homework.byId.invalidate();
    void utils.homework.home.invalidate();
    void utils.homework.list.invalidate();
  };
  const onDone = () => {
    setSheet(null);
    refresh();
  };
  const give = trpc.homework.give.useMutation({ onSuccess: refresh });
  const close = trpc.homework.close.useMutation({ onSuccess: onDone });
  const cancel = trpc.homework.cancel.useMutation({ onSuccess: onDone });
  const remove = trpc.homework.deleteDraft.useMutation({
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  if (!hw) {
    return (
      <ScreenFrame title="" backAccessibilityLabel={copy.common.back}>
        {query.isError ? (
          <ErrorCard cause={query.error} onRetry={() => void query.refetch()} testID="hw-detail-error" />
        ) : (
          <View style={styles.stack}>
            <Skeleton height={120} />
            <Skeleton height={88} />
            <Skeleton height={88} />
          </View>
        )}
      </ScreenFrame>
    );
  }

  const isDraft = hw.status === "draft" || hw.status === "scheduled";
  const live = hw.status === "published";
  const canEdit = has("homework:update") && (isDraft || live);
  const classes = hw.sections.map((s) => sectionLabel(s.className, s.sectionName)).join(", ");
  const banner: { tone: Tone; text: string } | null =
    hw.status === "draft"
      ? { tone: "neutral", text: text.draftBanner }
      : hw.status === "scheduled" && hw.publishAt
        ? { tone: "neutral", text: text.scheduledBanner(formatDue(hw.publishAt)) }
        : hw.status === "closed"
          ? { tone: "caution", text: text.closedBanner }
          : hw.status === "cancelled"
            ? { tone: "critical", text: text.cancelledBanner }
            : null;
  const gradingLabel =
    hw.gradingMode === "marks"
      ? text.grading.marks(hw.maxMarks ?? "0")
      : text.grading[hw.gradingMode as "none" | "grade" | "remark"];

  return (
    <ScreenFrame
      title={hw.book ? hw.book : hw.title}
      meta={`${hw.subjectName} · ${classes}`}
      backAccessibilityLabel={copy.common.back}
      backTestID="hw-detail-back"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      footer={
        isDraft && has("homework:update") ? (
          <View style={styles.footer}>
            {give.isError ? <Notice tone="critical" message={toFriendlyError(give.error).message} /> : null}
            <CapsuleButton
              title={text.giveNow}
              icon="check"
              onPress={() => pair && give.mutate({ ...base })}
              loading={give.isPending}
              disabled={give.isPending}
              testID="hw-give-now"
              style={styles.stretch}
            />
          </View>
        ) : undefined
      }
    >
      {banner ? <Notice tone={banner.tone} message={banner.text} style={styles.banner} /> : null}

      <Card style={styles.hero}>
        <View style={styles.heroRow}>
          <KindTile kind={hw.kind} size="lg" />
          <View style={styles.grow}>
            {hw.book ? (
              <ThemedText variant="bodyStrong" numberOfLines={2}>
                {hw.title}
              </ThemedText>
            ) : null}
            <ThemedText variant="bodyStrong" color={colors.accentDeep}>
              {dueLine(hw.dueAt)}
            </ThemedText>
            <ThemedText variant="meta">{formatDue(hw.dueAt)}</ThemedText>
          </View>
        </View>
        <View style={styles.chips}>
          <InfoChip label={text.chips[hw.comesBack]} icon={COMES_BACK_ICON[hw.comesBack]} />
          {hw.comesBack === "brought" || hw.comesBack === "sent" ? <InfoChip label={gradingLabel} icon="grade" /> : null}
          {hw.estimatedMinutes ? <InfoChip label={text.estimate(hw.estimatedMinutes)} icon="clock" /> : null}
        </View>
        {hw.details ? (
          <View style={styles.detailsBox}>
            <ThemedText variant="body" selectable>
              {hw.details}
            </ThemedText>
          </View>
        ) : null}
        {hw.files.length ? (
          <View style={styles.photos}>
            <PhotoStrip photos={hw.files} />
          </View>
        ) : null}
        <ThemedText variant="caption" style={styles.givenBy}>
          {text.givenBy(hw.createdByName)}
        </ThemedText>
      </Card>

      {!isDraft ? (
        <>
          <SectionLabel style={styles.label}>{text.classes}</SectionLabel>
          <Card padless>
            {hw.sections.map((s, i) => {
              const progress = sectionProgress(hw.comesBack, s);
              const route = SECTION_ROUTE[hw.comesBack];
              return (
                <View key={s.sectionId} style={[styles.sectionRow, i > 0 ? styles.divider : null]} testID={`hw-section-${s.sectionId}`}>
                  <View style={styles.grow}>
                    <View style={styles.sectionHead}>
                      <ThemedText variant="name">{sectionLabel(s.className, s.sectionName)}</ThemedText>
                      <ThemedText variant="meta" style={styles.grow} numberOfLines={1}>
                        {progress.line}
                      </ThemedText>
                    </View>
                    <ProgressBar value={progress.value} total={s.total} warn={progress.warn} />
                  </View>
                  {route && hw.status !== "cancelled" ? (
                    <CapsuleButton
                      title={route.label}
                      size="compact"
                      variant={progress.waiting ? "primary" : "secondary"}
                      onPress={() =>
                        router.push({
                          pathname: route.path,
                          params: { id: hw.id, sectionId: s.sectionId, subjectId: hw.subjectId },
                        } as unknown as Href)
                      }
                      testID={`hw-section-open-${s.sectionId}`}
                    />
                  ) : null}
                </View>
              );
            })}
          </Card>

          <SectionLabel style={styles.label}>{text.questions}</SectionLabel>
          <ActionRow
            icon="comments"
            label={text.questions}
            meta={text.questionsCount(hw.commentCount)}
            onPress={() => router.push({ pathname: "/homework/comments", params: { id: hw.id } } as unknown as Href)}
            testID="hw-comments"
          />
        </>
      ) : null}

      {canEdit || (has("homework:create") && !isDraft && hw.status !== "cancelled") ? (
        <>
          <SectionLabel style={styles.label}>{text.actions}</SectionLabel>
          <Card padless>
            {canEdit ? <ActionRow icon="edit" label={text.edit} onPress={() => setSheet("edit")} testID="hw-edit" inCard /> : null}
            {live && has("homework:update") ? (
              <ActionRow icon="calendar" label={text.moveDue} onPress={() => setSheet("move")} testID="hw-move" inCard divider />
            ) : null}
            {!isDraft && hw.status !== "cancelled" && has("homework:create") ? (
              <ActionRow icon="add" label={text.giveAgain} onPress={() => setSheet("again")} testID="hw-again" inCard divider />
            ) : null}
            {live && hw.comesBack !== "none" && has("homework:update") ? (
              <ActionRow icon="lock" label={text.close} onPress={() => setSheet("close")} testID="hw-close" inCard divider />
            ) : null}
            {(live || hw.status === "closed") && has("homework:update") ? (
              <ActionRow icon="closeCircle" label={text.cancel} tone="critical" onPress={() => setSheet("cancel")} testID="hw-cancel" inCard divider />
            ) : null}
            {isDraft && has("homework:delete") ? (
              <ActionRow icon="closeCircle" label={text.deleteDraft} tone="critical" onPress={() => setSheet("delete")} testID="hw-delete" inCard divider />
            ) : null}
          </Card>
          {hw.isLocked && canEdit ? <ThemedText variant="caption" style={styles.lockNote}>{text.lockedNote}</ThemedText> : null}
        </>
      ) : null}

      {sheet === "edit" ? <EditSheet hw={hw} onClose={() => setSheet(null)} onSaved={onDone} /> : null}
      {sheet === "move" ? <MoveDueSheet hw={hw} onClose={() => setSheet(null)} onSaved={onDone} /> : null}
      {sheet === "again" ? <GiveAgainSheet hw={hw} onClose={() => setSheet(null)} onSaved={onDone} /> : null}
      {sheet === "close" ? (
        <ConfirmSheet
          title={text.closeTitle}
          body={text.closeBody}
          confirmLabel={text.close}
          keepLabel={text.keep}
          submitting={close.isPending}
          error={close.error}
          onConfirm={() => close.mutate(base)}
          onClose={() => setSheet(null)}
          testIDPrefix="hw-close-sheet"
        />
      ) : null}
      {sheet === "cancel" ? (
        <ConfirmSheet
          title={text.cancelTitle}
          body={text.cancelBody}
          confirmLabel={text.cancel}
          keepLabel={text.keep}
          tone="destructive"
          submitting={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate(base)}
          onClose={() => setSheet(null)}
          testIDPrefix="hw-cancel-sheet"
        />
      ) : null}
      {sheet === "delete" ? (
        <ConfirmSheet
          title={text.deleteTitle}
          body={text.deleteBody}
          confirmLabel={text.deleteDraft}
          keepLabel={text.keep}
          tone="destructive"
          submitting={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(base)}
          onClose={() => setSheet(null)}
          testIDPrefix="hw-delete-sheet"
        />
      ) : null}
    </ScreenFrame>
  );
}

const COMES_BACK_ICON: Record<string, AppIconName> = {
  brought: "homework",
  sent: "camera",
  tick: "check",
  none: "close",
  questions: "quiz",
};

const SECTION_ROUTE: Record<string, { label: string; path: string } | null> = {
  brought: { label: text.check, path: "/homework/check" },
  sent: { label: text.review, path: "/homework/review" },
  tick: { label: text.ticks, path: "/homework/ticks" },
  none: null,
  questions: null,
};

type SectionCounts = { total: number; toCheck: number; checked: number; submitted: number; missing: number; redo: number };

/** The section's progress line and bar, in the words of how the work comes back. */
function sectionProgress(comesBack: string, s: SectionCounts) {
  if (comesBack === "brought") {
    return { line: text.progressChecked(s.checked, s.total), value: s.checked, warn: 0, waiting: s.toCheck > 0 };
  }
  if (comesBack === "sent") {
    const sent = s.submitted + s.checked + s.redo;
    return {
      line: `${text.progressSent(sent, s.total)}${s.missing ? ` · ${text.missing(s.missing)}` : ""}`,
      value: sent,
      warn: s.missing,
      waiting: s.submitted > 0,
    };
  }
  if (comesBack === "tick") {
    return { line: text.progressTicked(s.submitted, s.total), value: s.submitted, warn: 0, waiting: false };
  }
  return { line: text.progressNone(s.total), value: 0, warn: 0, waiting: false };
}

function ActionRow({
  icon,
  label,
  meta,
  tone,
  onPress,
  testID,
  inCard,
  divider,
}: {
  icon: AppIconName;
  label: string;
  meta?: string;
  tone?: Tone;
  onPress: () => void;
  testID?: string;
  inCard?: boolean;
  divider?: boolean;
}) {
  const fg = tone ? colors.tone[tone].fg : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        inCard ? null : styles.actionCard,
        divider ? styles.divider : null,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={[styles.actionIcon, tone ? { backgroundColor: colors.tone[tone].bg } : null]}>
        <AppIcon name={icon} size={18} color={tone ? fg : colors.accentDeep} />
      </View>
      <ThemedText variant="body" color={fg} style={styles.grow}>
        {label}
      </ThemedText>
      {meta ? <ThemedText variant="meta">{meta}</ThemedText> : null}
      <AppIcon name="chevronRight" size={18} color={colors.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, marginTop: spacing.md },
  grow: { flex: 1, gap: spacing.xxs },
  stretch: { alignSelf: "stretch" },
  footer: { gap: spacing.sm },
  banner: { marginTop: spacing.md },
  hero: { marginTop: spacing.md, gap: spacing.md },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  detailsBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.canvas },
  photos: { marginHorizontal: -spacing.xxs },
  givenBy: { color: colors.muted },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  sectionHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, marginBottom: spacing.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg },
  actionCard: { borderRadius: radius.lg, backgroundColor: colors.surface },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  pressed: { opacity: 0.85 },
  lockNote: { marginTop: spacing.sm, color: colors.muted },
});
