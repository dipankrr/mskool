import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import { useFormat } from "../../i18n/format";
import { countdown, shownWord } from "../../lib/homework";
import type { TonightRow } from "../../lib/home";
import { Enter, usePress } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FButton, FRow, FRowStack, FSkeleton, FText } from "../../ui";
import { KindTile, NewMark, WordPill, useCountdownLabel, useResultText } from "../homework/parts";
import { QuietBox, SectionHead, TickCircle } from "./parts";
import type { Home } from "./use-home";

/** Rows shown before "N more in Homework". */
const MAX_ROWS = 6;

function openHomework(id: string) {
  router.push({ pathname: "/family/homework/[id]", params: { id } });
}

/**
 * Tonight's work: everything due by the next school day. Homework that only
 * needs a tick is ticked right here; photos and quizzes open their own page.
 * Finished rows stay, outlined, so the count shows progress.
 */
export function Tonight({ home }: { home: Home }) {
  const { t } = useTranslation("family");
  const { t: tc } = useTranslation();
  const theme = useFamilyTheme();
  const p = theme.components.home.progress;
  const { plan, homework, now } = home;
  if (homework.isError && !homework.data) {
    return (
      <View style={{ gap: theme.space.md }}>
        <SectionHead title={t("home.tonight.title")} />
        <View style={[styles.row, { gap: theme.space.md }]}>
          <FText variant="meta" color="muted" style={styles.flex}>
            {t("home.tonight.loadFailed")}
          </FText>
          <FButton label={tc("retry")} variant="secondary" size="sm" onPress={() => void homework.refetch()} />
        </View>
      </View>
    );
  }
  if (homework.isPending) {
    return (
      <View style={{ gap: theme.space.md }}>
        <SectionHead title={t("home.tonight.title")} />
        <View style={{ gap: theme.components.row.stackGap }}>
          <FSkeleton height={72} radius="lg" />
          <FSkeleton height={72} radius="lg" />
        </View>
      </View>
    );
  }

  const done = plan.total - plan.left;
  // Past the cap, work still to do wins a place over finished work; the order stays.
  const open = plan.work.filter((row) => !row.done).slice(0, MAX_ROWS);
  const keep = new Set([...open, ...plan.work.filter((row) => row.done).slice(0, MAX_ROWS - open.length)]);
  const shown = plan.work.filter((row) => keep.has(row));
  const hidden = plan.work.length - shown.length;
  return (
    <View testID="home-tonight" style={{ gap: theme.space.md }}>
      <SectionHead
        title={t("home.tonight.title")}
        aside={plan.total > 0 ? t("home.tonight.count", { done, total: plan.total }) : null}
      />
      {plan.total > 0 ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: plan.total, now: done }}
          style={{ height: p.height, borderRadius: p.height / 2, backgroundColor: p.track, overflow: "hidden" }}
        >
          <View
            style={{
              width: `${Math.round((done / plan.total) * 100)}%`,
              height: p.height,
              borderRadius: p.height / 2,
              backgroundColor: plan.left === 0 ? p.full : p.fill,
            }}
          />
        </View>
      ) : null}
      {plan.total === 0 ? (
        <QuietBox>
          <FText variant="meta" color="muted" align="center">
            {t("home.tonight.empty")}
          </FText>
        </QuietBox>
      ) : (
        <FRowStack>
          {shown.map((row, index) => (
            <Enter key={row.item.studentAssignmentId} index={index}>
              <WorkRow row={row} now={now} onToggle={() => home.toggleRow(row)} />
            </Enter>
          ))}
        </FRowStack>
      )}
      {home.tickFailed ? (
        <FText variant="meta" color="critical">
          {t("home.tonight.tickFailed")}
        </FText>
      ) : null}
      {hidden > 0 ? (
        <FButton
          testID="home-all-homework"
          label={t("home.tonight.more", { count: hidden })}
          variant="quiet"
          size="sm"
          onPress={() => router.navigate("/family/homework")}
          style={styles.start}
        />
      ) : null}
    </View>
  );
}

function WorkRow({ row, now, onToggle }: { row: TonightRow; now: Date; onToggle: () => void }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const theme = useFamilyTheme();
  const a = theme.components.home.action;
  const label = useCountdownLabel();
  const result = useResultText();
  const { item, done, action } = row;
  const c = countdown(item.dueAt, item.closeAt, now);
  const ticks = action === "tick" || action === "local";
  // A server tick locks at the due time; before that it can be undone.
  const locked = action === "tick" && (done ? !item.canUntick : c.kind === "closed");

  const when = label(c);
  const sub = done
    ? t("home.tonight.rowDone", { subject: item.subjectName })
    : item.estimatedMinutes
      ? t("home.tonight.rowSubTime", { subject: item.subjectName, time: format.duration(item.estimatedMinutes), when })
      : t("home.tonight.rowSub", { subject: item.subjectName, when });
  const tone = done ? undefined : c.kind !== "left" ? "caution" : c.tone !== "neutral" ? c.tone : undefined;
  const doneLook = theme.components.homework.doneRow;

  return (
    <FRow
      testID={`home-work-${item.studentAssignmentId}`}
      title={item.title}
      subtitle={sub}
      subtitleTone={tone}
      leading={
        ticks ? (
          <TickCircle
            testID={`home-tick-${item.studentAssignmentId}`}
            checked={done}
            disabled={locked}
            label={t("home.tonight.tickA11y", { title: item.title })}
            onPress={onToggle}
          />
        ) : (
          <KindTile kind={item.kind} subject={item.subjectName} />
        )
      }
      trailing={
        <View style={[styles.row, { gap: theme.space.xs }]}>
          {item.isNew || item.newReplies > 0 ? <NewMark replies={item.newReplies} isNew={item.isNew} /> : null}
          {ticks ? null : done ? (
            <WordPill word={shownWord(item)} result={item.word === "checked" ? result(item) : null} />
          ) : (
            <View
              style={[
                styles.center,
                { height: a.height, borderRadius: a.height / 2, paddingHorizontal: theme.space.lg, backgroundColor: a.bg },
              ]}
            >
              <FText variant="meta" tint={a.fg}>
                {t(item.word === "redo" ? "home.tonight.fix" : action === "quiz" ? "home.tonight.start" : "home.tonight.send")}
              </FText>
            </View>
          )}
        </View>
      }
      chevron={false}
      onPress={() => openHomework(item.studentAssignmentId)}
      style={
        done
          ? { backgroundColor: doneLook.bg, borderColor: doneLook.border, borderWidth: 1.5, paddingHorizontal: theme.space.md }
          : { paddingHorizontal: theme.space.md }
      }
    />
  );
}

/**
 * The bag: things to carry to class for the next school day. Ticks stay on
 * this phone; the teacher checks the real thing in class.
 */
export function Bag({ home }: { home: Home }) {
  const { t } = useTranslation("family");
  const theme = useFamilyTheme();
  const { plan } = home;
  if (home.homework.isPending || plan.bag.length === 0) return null;
  const packed = plan.bag.length - plan.bagLeft;
  return (
    <View testID="home-bag" style={{ gap: theme.space.md }}>
      <SectionHead title={t("home.bag.title")} aside={t("home.bag.count", { done: packed, total: plan.bag.length })} />
      <View style={[styles.wrap, { gap: theme.space.sm }]}>
        {plan.bag.map((row) => (
          <BagItem key={row.item.studentAssignmentId} row={row} onToggle={() => home.toggleRow(row)} />
        ))}
      </View>
      <FText variant="meta" color="faint">
        {t("home.bag.note")}
      </FText>
    </View>
  );
}

function BagItem({ row, onToggle }: { row: TonightRow; onToggle: () => void }) {
  const { t } = useTranslation("family");
  const theme = useFamilyTheme();
  const b = theme.components.home.bag;
  const k = theme.components.home.tick;
  const press = usePress(0.96);
  const { item, done } = row;
  return (
    <Pressable
      testID={`home-bag-${item.studentAssignmentId}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={t("home.bag.itemA11y", { title: item.title, subject: item.subjectName })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onToggle}
      style={styles.bagItem}
    >
      <View
        style={[
          styles.row,
          {
            minHeight: b.height,
            borderRadius: b.height / 2,
            paddingLeft: theme.space.sm,
            paddingRight: theme.space.lg,
            gap: theme.space.sm,
            backgroundColor: done ? b.onBg : b.bg,
            borderWidth: 1,
            borderColor: done ? b.onBorder : b.border,
          },
        ]}
      >
        <View
          style={[
            styles.center,
            {
              width: b.tick,
              height: b.tick,
              borderRadius: b.tick / 2,
              backgroundColor: done ? k.on : "transparent",
              borderWidth: done ? 0 : 2,
              borderColor: k.border,
            },
          ]}
        >
          {done ? <AppIcon name="check" size={16} color={k.fg} /> : null}
        </View>
        <FText variant="label" tint={done ? b.onFg : undefined} numberOfLines={1} style={styles.shrink}>
          {item.title}
        </FText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  start: { alignSelf: "flex-start" },
  bagItem: { maxWidth: "100%" },
});
