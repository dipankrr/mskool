import { useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { countdown, groupDone, groupOpen, isOpen, tonight } from "../../lib/homework";
import type { PortalItem } from "../../lib/homework";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import {
  FArrow,
  FEmptyState,
  FErrorState,
  FHand,
  FMascot,
  FOfflineNote,
  FRowStack,
  FScreen,
  FSegment,
  FSkeleton,
  FText,
  useFamilyTabBarSpace,
} from "../../ui";
import { FamilyTabHeader } from "../tab-header";
import { HomeworkRow, useCountdownLabel, useNow } from "./parts";

type Tab = "todo" | "done";

/**
 * The family Homework tab. To do leads with the Tonight card (what's left
 * tonight and about how long), then sent-back work, then by due day. Done
 * holds checked and missed work by week. One read, split on the phone.
 */
export function FamilyHomework() {
  const { t } = useTranslation("homework");
  const { t: tf } = useTranslation("family");
  const theme = useFamilyTheme();
  const space = useFamilyTabBarSpace();
  const now = useNow();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const [tab, setTab] = useState<Tab>("todo");
  const list = trpc.portalHomework.list.useQuery({ studentId, filter: "all" }, { enabled: studentId.length > 0 });
  const header = <FamilyTabHeader title={tf("tabs.homework")} />;

  if (list.isError && !list.data) {
    return (
      <FScreen bottomSpace={space} header={header}>
        <FErrorState onRetry={() => void list.refetch()} />
      </FScreen>
    );
  }

  const items = list.data ?? [];
  const open = groupOpen(items, now);
  const done = groupDone(items, now);
  // Only what the child still has to do: not new results, not work with the teacher.
  const openCount = items.filter(isOpen).length;
  const openHref = (item: PortalItem) =>
    router.push({ pathname: "/family/homework/[id]", params: { id: item.studentAssignmentId } });

  return (
    <FScreen
      testID="family-homework"
      bottomSpace={space}
      header={header}
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
    >
      {list.isError && list.data ? <FOfflineNote /> : null}
      <FSegment
        testID="hw-segment"
        value={tab}
        onChange={setTab}
        options={[
          { key: "todo", label: openCount > 0 ? `${t("segment.todo")} · ${openCount}` : t("segment.todo") },
          { key: "done", label: t("segment.done") },
        ]}
      />
      <Reveal
        loading={list.isPending}
        placeholder={
          <View style={{ gap: theme.components.row.stackGap }}>
            <FSkeleton height={170} radius="xl" />
            <FSkeleton height={80} radius="lg" />
            <FSkeleton height={80} radius="lg" />
          </View>
        }
      >
        {items.length === 0 ? (
          <FEmptyState title={t("bookie.noneYet")} body={t("bookie.noneYetBody")} />
        ) : tab === "todo" ? (
          <View style={{ gap: theme.components.screen.sectionGap }}>
            <TonightCard items={items} now={now} />
            {open.map((group) => (
              <Group key={group.key} title={t(`group.${group.key}`)}>
                {group.items.map((item, i) => (
                  <Enter key={item.studentAssignmentId} index={i}>
                    <HomeworkRow item={item} now={now} onPress={() => openHref(item)} />
                  </Enter>
                ))}
              </Group>
            ))}
          </View>
        ) : done.length === 0 ? (
          <FEmptyState title={t("bookie.doneEmpty")} body={t("bookie.doneEmptyBody")} />
        ) : (
          <View style={{ gap: theme.components.screen.sectionGap }}>
            {done.map((group) => (
              <Group key={group.key} title={t(`group.${group.key}`)}>
                {group.items.map((item, i) => (
                  <Enter key={item.studentAssignmentId} index={i}>
                    <HomeworkRow item={item} now={now} onPress={() => openHref(item)} />
                  </Enter>
                ))}
              </Group>
            ))}
          </View>
        )}
      </Reveal>
    </FScreen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <FText variant="label" color="muted">
        {title}
      </FText>
      <FRowStack>{children}</FRowStack>
    </View>
  );
}

/**
 * Tonight: how many are left and about how long, dots for today's homework
 * filling up. When nothing is left, Bookie says so and names the next one.
 */
function TonightCard({ items, now }: { items: PortalItem[]; now: Date }) {
  const { t } = useTranslation("homework");
  const format = useFormat();
  const theme = useFamilyTheme();
  const label = useCountdownLabel();
  const n = tonight(items, now);
  const card = theme.components.homework.tonight;

  if (n.left === 0) {
    const next = items
      .filter((i) => i.word === "to_do" && new Date(i.dueAt).getTime() > now.getTime())
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
    return (
      <View testID="hw-all-done" style={[styles.allDone, { gap: theme.space.md, paddingVertical: theme.space.lg }]}>
        <View style={[styles.row, { gap: theme.space.md }]}>
          <FMascot size={88} mood="happy" />
          <View style={styles.flex}>
            <FHand tone="info" size={28}>
              {t("bookie.allDone")}
            </FHand>
            <FArrow tone="info" width={48} flip rotate="160deg" style={styles.arrow} />
          </View>
        </View>
        {next ? (
          <FText variant="meta" color="muted">
            {t("bookie.nextOne", { title: next.title, when: label(countdown(next.dueAt, next.closeAt, now)) })}
          </FText>
        ) : null}
      </View>
    );
  }

  const meta = [
    n.minutes > 0 ? t("tonight.about", { time: format.duration(n.minutes) }) : null,
    n.done > 0 ? t("tonight.doneToday", { count: n.done }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      testID="hw-tonight"
      style={{ backgroundColor: card.bg, borderRadius: card.radius, padding: theme.space.xl, gap: theme.space.xs }}
    >
      <View style={[styles.row, { gap: theme.space.md }]}>
        <View style={[styles.flex, { gap: theme.space.xs }]}>
          <FText variant="caption" tint={card.muted}>
            {t("tonight.kicker").toUpperCase()}
          </FText>
          <FText variant="numberHero" tint={card.fg}>
            {t("tonight.left", { count: n.left })}
          </FText>
          {meta ? (
            <FText variant="meta" tint={card.muted}>
              {meta}
            </FText>
          ) : null}
        </View>
        <FMascot size={76} look="left" />
      </View>
      {n.total > 1 ? (
        <View style={[styles.row, { gap: theme.space.xs, marginTop: theme.space.md }]}>
          {Array.from({ length: n.total }, (_, i) => (
            <View
              key={i}
              style={[styles.dot, { borderRadius: theme.radius.full, backgroundColor: i < n.done ? card.dotOn : card.dot }]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  allDone: {},
  arrow: { marginTop: 4 },
  dot: { flex: 1, height: 8 },
});
