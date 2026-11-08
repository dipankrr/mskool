import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";

import { Avatar } from "../../components/avatar";
import { CapsuleButton } from "../../components/capsule-button";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { sectionLabel } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { DayRow } from "./index";

const text = copy.homework.classPage;

/**
 * One class and subject (Home v3, frame 3): how the class is doing, what is
 * out, what waits to be checked, who owes work this week, then earlier
 * homework. "Give to 6A" starts Give with this class already picked.
 */
export function ClassPageScreen() {
  const { sectionId, subjectId } = useLocalSearchParams<{ sectionId: string; subjectId: string }>();
  const { organizationId, schoolId } = useActiveContext();
  const { has } = usePermissions();
  const view = trpc.homework.classView.useQuery(
    { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}), forSectionId: sectionId, subjectId },
    { enabled: Boolean(organizationId && sectionId && subjectId) },
  );
  const v = view.data;
  const label = v ? sectionLabel(v.className, v.sectionName) : "";
  const now = v ? new Date() : null;
  const out = v && now ? v.homework.filter((h) => h.status === "published" && new Date(h.dueAt) > now) : [];
  const waiting = v ? v.homework.filter((h) => (h.sections[0]?.toCheck ?? 0) > 0 && now && new Date(h.dueAt) <= now) : [];
  const shown = new Set([...out, ...waiting].map((h) => h.id));
  const earlier = v ? v.homework.filter((h) => !shown.has(h.id)).slice(0, 15) : [];

  return (
    <ScreenFrame
      title={v ? `${label} · ${v.subjectName}` : ""}
      meta={v ? text.students(v.studentCount) : undefined}
      backAccessibilityLabel={copy.common.back}
      onRefresh={() => void view.refetch()}
      refreshing={view.isRefetching}
      footer={
        v && has("homework:create") ? (
          <CapsuleButton
            title={text.giveTo(label)}
            icon="add"
            onPress={() =>
              router.push({ pathname: "/homework/give", params: { sectionId, subjectId } } as unknown as Href)
            }
            style={styles.stretch}
            testID="class-give"
          />
        ) : undefined
      }
    >
      {!v ? (
        view.isError ? (
          <ErrorCard cause={view.error} onRetry={() => void view.refetch()} />
        ) : (
          <View style={styles.stack}>
            <Skeleton height={80} />
            <Skeleton height={120} />
          </View>
        )
      ) : (
        <>
          <View style={styles.stats}>
            <Stat value={v.onTimePct === null ? "–" : `${v.onTimePct}%`} label={text.onTime} />
            <Stat value={String(v.toCheck)} label={text.toCheck} color={v.toCheck ? colors.tone.caution.fg : undefined} />
            <Stat value={String(v.owe.length)} label={text.oweWork} color={v.owe.length ? colors.tone.critical.fg : undefined} />
          </View>

          <SectionLabel style={styles.label}>{text.outNow}</SectionLabel>
          <View style={styles.list}>
            {out.length ? (
              out.map((h, i) => <DayRow key={h.id} hw={h} first={i === 0} hideClasses />)
            ) : (
              <ThemedText variant="meta" style={styles.empty}>
                {text.noneOut}
              </ThemedText>
            )}
          </View>

          {waiting.length ? (
            <>
              <SectionLabel style={styles.label}>{text.toCheckLabel}</SectionLabel>
              <View style={styles.list}>
                {waiting.map((h, i) => (
                  <DayRow key={h.id} hw={h} first={i === 0} hideClasses />
                ))}
              </View>
            </>
          ) : null}

          {v.owe.length ? (
            <>
              <View style={styles.head}>
                <SectionLabel>{text.owe}</SectionLabel>
                <ThemedText variant="meta">{text.oweWeek}</ThemedText>
              </View>
              <View style={styles.list}>
                {v.owe.map((o, i) => (
                  <View key={o.studentId} style={[styles.person, i > 0 ? styles.divider : null]}>
                    <Avatar name={o.name} />
                    <View style={styles.grow}>
                      <ThemedText variant="name" numberOfLines={1}>
                        {o.name}
                      </ThemedText>
                      <ThemedText variant="meta" color={colors.tone.critical.fg}>
                        {text.oweLine(o.notDone, o.incomplete, o.missing)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {earlier.length ? (
            <>
              <SectionLabel style={styles.label}>{text.earlier}</SectionLabel>
              <View style={styles.list}>
                {earlier.map((h, i) => (
                  <DayRow key={h.id} hw={h} first={i === 0} hideClasses />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </ScreenFrame>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText variant="title" color={color ?? colors.ink}>
        {value}
      </ThemedText>
      <ThemedText variant="caption">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, marginTop: spacing.md },
  stretch: { alignSelf: "stretch" },
  grow: { flex: 1, gap: spacing.xxs },
  stats: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  list: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: "hidden" },
  empty: { padding: spacing.lg },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
});
