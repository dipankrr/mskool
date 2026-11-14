import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import { Alert, Linking, Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SegmentBar } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useActiveBranchName } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { StaffAvatar } from "./staff-photo";
import { fullName, hasLeft, isOffice, staffCounts, staffGroups, teachingTags } from "./staff-list-logic";
import type { StaffTab } from "./staff-list-logic";

type Row = inferRouterOutputs<AppRouter>["staff"]["list"][number];

/**
 * Staff (prototype/staff-list.html, v2). Tabs All · Teaching · Office — a
 * teacher who also holds an office job is in both. A row stays quiet when
 * someone is fine: a pill only for Invited / Not invited / Left. Teachers show
 * what they teach; everyone has a call button. People who left hide behind a
 * switch at the end of the list.
 */
export function StaffListScreen() {
  const { organizationId, schoolId } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();
  const [tab, setTab] = useState<StaffTab>("all");
  const [q, setQ] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const [notOnAppOnly, setNotOnAppOnly] = useState(false);
  const enabled = Boolean(organizationId && schoolId);
  const list = trpc.staff.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", includeInactive: true },
    { enabled },
  );

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => staffCounts(rows), [rows]);
  const searching = q.trim().length > 0;
  const groups = useMemo(
    () =>
      notOnAppOnly
        ? [{ key: "notOnApp", title: "Not on the app", rows: counts.notOnApp as Row[] }]
        : staffGroups(rows, { tab, query: q, showLeft }),
    [notOnAppOnly, counts.notOnApp, rows, tab, q, showLeft],
  );
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <ScreenFrame
      title="Staff"
      meta={[branchName, `${counts.all} people`].filter(Boolean).join(" · ")}
      backAccessibilityLabel="Back"
      action={
        has("staff:create")
          ? { label: "Add", icon: "add", onPress: () => router.push("/staff-form") }
          : undefined
      }
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
    >
      <View style={styles.searchRow}>
        <View style={[styles.search, searching ? styles.searchOn : null]}>
          <AppIcon name="search" size={18} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={(text) => {
              setQ(text);
              if (text) setNotOnAppOnly(false);
            }}
            placeholder="Name or phone"
            placeholderTextColor={colors.muted}
            style={styles.searchText}
            autoCorrect={false}
            testID="staff-search"
            accessibilityLabel="Search staff"
          />
        </View>
        {searching ? (
          <Pressable accessibilityRole="button" onPress={() => setQ("")} style={styles.cancel} hitSlop={8}>
            <ThemedText variant="bodyStrong" style={styles.link}>
              Cancel
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {!searching && !notOnAppOnly ? (
        <View style={styles.tabs}>
          <SegmentBar
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: `All ${counts.all}`, testID: "staff-tab-all" },
              { value: "teaching", label: `Teaching ${counts.teaching}`, testID: "staff-tab-teaching" },
              { value: "office", label: `Office ${counts.office}`, testID: "staff-tab-office" },
            ]}
          />
        </View>
      ) : null}

      {!searching && counts.notOnApp.length > 0 ? (
        <NotOnAppCard
          people={counts.notOnApp as Row[]}
          open={notOnAppOnly}
          onToggle={() => setNotOnAppOnly((v) => !v)}
        />
      ) : null}

      {list.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : list.isError ? (
        <ErrorCard cause={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="students"
          title="No staff yet"
          message="Add your teachers and office staff, then invite them to the app."
        />
      ) : (
        <>
          {searching ? (
            <ThemedText variant="sectionLabel" style={styles.groupLabel}>
              {shownCount === 1 ? "1 person" : `${shownCount} people`}
            </ThemedText>
          ) : null}
          {shownCount === 0 ? (
            <EmptyState icon="search" title="Nobody here" message="Try another name, phone or tab." />
          ) : (
            groups.map((group) => (
              <View key={group.key} style={styles.group}>
                {group.title ? (
                  <View style={styles.groupHead}>
                    <ThemedText variant="sectionLabel">{group.title}</ThemedText>
                    <ThemedText variant="caption" style={styles.muted}>
                      {group.rows.length}
                    </ThemedText>
                  </View>
                ) : null}
                <View style={styles.card}>
                  {group.rows.map((row, i) => (
                    <StaffRow key={row.id} row={row} first={i === 0} />
                  ))}
                </View>
              </View>
            ))
          )}
        </>
      )}

      {!searching && !notOnAppOnly && counts.left > 0 ? (
        <View style={styles.leftRow}>
          <ThemedText variant="bodyStrong" style={styles.grow}>
            Show people who left
          </ThemedText>
          <ThemedText variant="meta">{counts.left}</ThemedText>
          <Switch
            value={showLeft}
            onValueChange={setShowLeft}
            trackColor={{ true: colors.accent, false: colors.chip }}
            accessibilityLabel="Show people who left"
            testID="staff-show-left"
          />
        </View>
      ) : null}
    </ScreenFrame>
  );
}

function NotOnAppCard({ people, open, onToggle }: { people: Row[]; open: boolean; onToggle: () => void }) {
  const names = people.map((p) => fullName(p));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? "Show everyone" : `${people.length} not on the app yet. Show them`}
      onPress={onToggle}
      style={({ pressed }) => [styles.nudge, pressed ? styles.pressed : null]}
      testID="staff-not-on-app"
    >
      <View style={styles.stack}>
        {people.slice(0, 2).map((p, i) => (
          <StaffAvatar
            key={p.id}
            name={fullName(p)}
            uri={p.photo?.url}
            cacheKey={p.photo?.id}
            size={32}
            style={[styles.stackAv, { zIndex: 2 - i }, i > 0 ? styles.stackOverlap : null]}
          />
        ))}
      </View>
      <View style={styles.grow}>
        <ThemedText variant="bodyStrong">
          {people.length === 1 ? "1 not on the app yet" : `${people.length} not on the app yet`}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {names.join(", ")}
        </ThemedText>
      </View>
      <View style={styles.nudgeBtn}>
        <ThemedText variant="chip" style={styles.link}>
          {open ? "Show all" : "Invite"}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function StaffRow({ row, first }: { row: Row; first: boolean }) {
  const name = fullName(row);
  const left = hasLeft(row);
  const tags = row.teachesClasses ? teachingTags(row.teaching) : { shown: [], more: 0 };
  const office = row.teachesClasses && isOffice(row) ? row.designation : null;
  const line = left
    ? [row.designation, row.dateOfLeaving ? `left ${monthYear(row.dateOfLeaving)}` : "left"].filter(Boolean).join(" · ")
    : !row.teachesClasses
      ? row.designation
      : office ?? (tags.shown.length === 0 ? "Nothing assigned yet" : null);
  const notOnApp = !left && row.joinState !== "joined";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => router.push({ pathname: "/staff-profile", params: { id: row.id } })}
      style={({ pressed }) => [styles.row, !first ? styles.rowLine : null, pressed ? styles.pressed : null]}
      testID={`staff-row-${row.id}`}
    >
      <View style={left ? styles.faded : null}>
        <StaffAvatar name={name} uri={row.photo?.url} cacheKey={row.photo?.id} />
        {notOnApp ? <View style={styles.ring} /> : null}
      </View>
      <View style={[styles.grow, left ? styles.faded : null]}>
        <ThemedText variant="name" numberOfLines={1}>
          {name}
        </ThemedText>
        {line ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {line}
          </ThemedText>
        ) : null}
        {!left && tags.shown.length > 0 ? (
          <View style={styles.tags}>
            {tags.shown.map((tag) => (
              <View key={tag.key} style={[styles.tag, tag.classTeacher ? styles.tagCt : null]}>
                {tag.classTeacher ? <AppIcon name="star" size={11} color={colors.accentDeep} /> : null}
                <ThemedText variant="caption" style={tag.classTeacher ? styles.tagCtText : styles.tagText} numberOfLines={1}>
                  {tag.label}
                </ThemedText>
              </View>
            ))}
            {tags.more > 0 ? (
              <View style={styles.tag}>
                <ThemedText variant="caption" style={styles.tagText}>
                  +{tags.more}
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {left ? (
        <Pill label="Left" tone="neutral" />
      ) : row.joinState === "not_invited" ? (
        <Pill label="Not invited" tone="caution" />
      ) : row.joinState === "invited" ? (
        <Pill label="Invited" tone="neutral" />
      ) : row.phone ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${name}`}
          onPress={() =>
            void Linking.openURL(`tel:+91${row.phone}`).catch(() => Alert.alert("Couldn't start a call on this phone."))
          }
          style={({ pressed }) => [styles.call, pressed ? styles.callPressed : null]}
          hitSlop={4}
          testID={`staff-call-${row.id}`}
        >
          <AppIcon name="call" size={18} color={colors.ink} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function Pill({ label, tone }: { label: string; tone: "neutral" | "caution" }) {
  const look = colors.tone[tone];
  return (
    <View style={[styles.pill, { backgroundColor: look.bg }]}>
      <ThemedText variant="caption" style={{ color: look.fg }}>
        {label}
      </ThemedText>
    </View>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthYear(iso: string) {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${y}`.trim();
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.inputLine,
    paddingHorizontal: spacing.md,
  },
  searchOn: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 2 },
  searchText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    color: colors.ink,
    paddingVertical: spacing.sm,
  },
  cancel: { minHeight: 44, justifyContent: "center", paddingLeft: spacing.xs },
  link: { color: colors.accentDeep },
  tabs: { marginTop: spacing.md },
  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
  },
  stack: { flexDirection: "row" },
  stackAv: { borderWidth: 2, borderColor: colors.surface },
  stackOverlap: { marginLeft: -10 },
  nudgeBtn: {
    height: 34,
    paddingHorizontal: spacing.md + 2,
    borderRadius: 999,
    backgroundColor: colors.accentTint,
    justifyContent: "center",
  },
  loading: { gap: spacing.sm, marginTop: spacing.lg },
  group: { marginTop: spacing.lg },
  groupHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginHorizontal: spacing.xs,
    marginBottom: spacing.xs + 2,
  },
  groupLabel: { marginTop: spacing.lg, marginLeft: spacing.xs, marginBottom: -spacing.sm },
  muted: { color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.canvas },
  grow: { flex: 1, minWidth: 0 },
  faded: { opacity: 0.55 },
  ring: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.tone.caution.fg,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs + 1 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.tone.neutral.bg,
    maxWidth: "100%",
  },
  tagCt: { backgroundColor: colors.accentTint },
  tagText: { color: colors.tone.neutral.fg },
  tagCtText: { color: colors.accentDeep },
  pill: { height: 24, paddingHorizontal: spacing.sm + 1, borderRadius: 999, justifyContent: "center" },
  call: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  callPressed: { backgroundColor: colors.chip },
  leftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
  },
});
