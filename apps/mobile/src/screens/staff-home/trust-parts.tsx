import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { HomeOrg } from "@repo/contracts";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { percent, shortMoney } from "./home-logic";
import { Figure, HomeCard, Progress, SectionHead, Tile, homeStyles } from "./ui";

const c = copy.home;

/**
 * "This branch | All branches" (ADR-072). Lives on Home only: the app's
 * active branch never changes because of it, so every other screen keeps
 * working one branch at a time.
 */
export function ScopeSwitch({
  branchName,
  all,
  onChange,
}: {
  branchName: string;
  all: boolean;
  onChange: (all: boolean) => void;
}) {
  return (
    <View style={styles.switch} accessibilityRole="tablist">
      {[false, true].map((value) => (
        <Pressable
          key={String(value)}
          onPress={() => onChange(value)}
          accessibilityRole="tab"
          accessibilityState={{ selected: all === value }}
          style={[styles.switchItem, all === value ? styles.switchOn : null]}
          testID={value ? "home-scope-all" : "home-scope-branch"}
        >
          <AppIcon name={value ? "stack" : "school"} size={14} color={all === value ? colors.ink : colors.muted} />
          <ThemedText style={[styles.switchText, all === value ? styles.switchTextOn : null]} numberOfLines={1}>
            {value ? c.allBranches : branchName}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/** The All branches page: dashboard figures only, each null where not allowed. */
export function TrustView({ org, onOpenBranch }: { org: HomeOrg; onOpenBranch: (schoolId: string) => void }) {
  const b = org.branches;
  const sum = (pick: (x: HomeOrg["branches"][number]) => number | null | undefined) => {
    const values = b.map(pick).filter((v): v is number => v != null);
    return values.length ? values.reduce((s, v) => s + v, 0) : null;
  };
  const present = sum((x) => x.attendance?.present);
  const marked = sum((x) => x.attendance?.marked);
  const unmarked = sum((x) => (x.attendance ? x.attendance.sections - x.attendance.sectionsMarked : null));
  const collectedToday = sum((x) => (x.fees ? Number(x.fees.collectedToday) : null));
  const receipts = sum((x) => x.fees?.receiptsToday);
  const paid = sum((x) => (x.fees ? Number(x.fees.paidOnThisMonth) : null));
  const billed = sum((x) => (x.fees ? Number(x.fees.billedThisMonth) : null));
  const staffTotal = sum((x) => x.staff?.total);
  const notJoined = sum((x) => x.staff?.notJoined);
  const presentPct = present != null && marked != null ? percent(present, marked) : null;
  const feePct = paid != null && billed != null ? percent(paid, billed) : null;

  return (
    <View testID="home-trust">
      <SectionHead title={c.trustToday} />
      <View style={homeStyles.row2}>
        {presentPct != null || present != null ? (
          <Tile area="attendance" icon="attendance" label={c.presentSoFar}>
            <Figure value={presentPct == null ? "—" : String(presentPct)} small={presentPct == null ? undefined : "%"} />
            <ThemedText variant="meta" style={homeStyles.meta}>
              {unmarked ? `${c.acrossBranches(b.length)} · ${unmarked} unmarked` : c.acrossBranches(b.length)}
            </ThemedText>
          </Tile>
        ) : null}
        {collectedToday != null ? (
          <Tile area="fees" icon="fees" label={c.collectedToday}>
            <Figure value={shortMoney(String(collectedToday))} />
            <ThemedText variant="meta" style={homeStyles.meta}>
              {c.receipts(receipts ?? 0)}
            </ThemedText>
          </Tile>
        ) : null}
      </View>

      <SectionHead title={c.branches} area="trust" icon="school" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchRow}>
        {b.map((branch) => {
          const att = branch.attendance ? percent(branch.attendance.present, branch.attendance.marked) : null;
          const fee = branch.fees ? percent(Number(branch.fees.paidOnThisMonth), Number(branch.fees.billedThisMonth)) : null;
          const behind = feePct != null && fee != null && fee < feePct - 8;
          return (
            <HomeCard
              key={branch.schoolId}
              style={styles.branchCard}
              onPress={() => onOpenBranch(branch.schoolId)}
              accessibilityLabel={`${branch.name}, opens this branch`}
              testID={`home-branch-${branch.schoolId}`}
            >
              <View style={styles.branchHead}>
                <ThemedText style={styles.branchName} numberOfLines={2}>
                  {branch.name}
                </ThemedText>
                {behind ? (
                  <View style={styles.behind}>
                    <ThemedText style={styles.behindText}>{c.behind}</ThemedText>
                  </View>
                ) : (
                  <AppIcon name="chevronRight" size={16} color={colors.chevron} />
                )}
              </View>
              <ThemedText variant="meta">{branch.students != null ? c.branchStudents(branch.students) : branch.session?.name ?? ""}</ThemedText>
              <View style={styles.branchFigs}>
                <View style={styles.branchFig}>
                  <ThemedText variant="meta">{c.presentToday}</ThemedText>
                  <ThemedText style={styles.branchFigText}>{att == null ? c.notAllowed : `${att}%`}</ThemedText>
                </View>
                <View style={styles.branchFig}>
                  <ThemedText variant="meta">{c.branchFees}</ThemedText>
                  <ThemedText style={[styles.branchFigText, behind ? { color: colors.tone.caution.fg } : null]}>
                    {fee == null ? c.notAllowed : `${fee}%`}
                  </ThemedText>
                </View>
              </View>
            </HomeCard>
          );
        })}
      </ScrollView>

      {feePct != null ? (
        <>
          <SectionHead title={c.feesMonth} area="fees" icon="fees" />
          <HomeCard>
            <View style={styles.feeTop}>
              <View>
                <ThemedText variant="meta" style={styles.label}>
                  {c.feesWholeTrust}
                </ThemedText>
                <Figure value={String(feePct)} small="%" />
              </View>
              <ThemedText variant="meta" style={styles.right}>
                {`${shortMoney(String(paid))}\n${c.ofAmount(shortMoney(String(billed)))}`}
              </ThemedText>
            </View>
            {b
              .filter((x) => x.fees)
              .map((x) => {
                const p = percent(Number(x.fees!.paidOnThisMonth), Number(x.fees!.billedThisMonth)) ?? 0;
                const low = p < feePct - 8;
                return (
                  <View key={x.schoolId} style={styles.barRow}>
                    <ThemedText style={styles.barName} numberOfLines={1}>
                      {x.name}
                    </ThemedText>
                    <View style={styles.grow}>
                      <Progress value={p} color={low ? colors.tone.caution.fg : colors.area.fees.fg} height={10} />
                    </View>
                    <ThemedText style={styles.barValue}>{`${p}%`}</ThemedText>
                  </View>
                );
              })}
          </HomeCard>
        </>
      ) : null}

      {staffTotal != null ? (
        <>
          <SectionHead title={c.staff} area="teaching" icon="students" />
          <View style={homeStyles.row2}>
            <Tile area="teaching" icon="students" label={c.staffTotal}>
              <Figure value={String(staffTotal)} />
              <ThemedText variant="meta" style={homeStyles.meta}>
                {c.staffAcross(b.filter((x) => x.staff).length)}
              </ThemedText>
            </Tile>
            <Tile area={notJoined ? "amber" : "teaching"} icon="key" label={c.notJoined}>
              <Figure value={String(notJoined ?? 0)} color={notJoined ? colors.tone.caution.fg : undefined} />
              <ThemedText variant="meta" style={homeStyles.meta} numberOfLines={2}>
                {b
                  .filter((x) => x.staff && x.staff.notJoined > 0)
                  .map((x) => `${x.name.split(" ")[0]} ${x.staff!.notJoined}`)
                  .join(" · ") || c.notJoinedCap}
              </ThemedText>
            </Tile>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  switch: { flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.7)", gap: 4, marginTop: 14 },
  switchItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 11, paddingHorizontal: spacing.sm },
  switchOn: { backgroundColor: colors.surface, boxShadow: "0 1px 3px rgba(16,24,40,0.12)" },
  switchText: { fontFamily: fontFamily.semibold, fontSize: fontSize.small, color: colors.muted, flexShrink: 1 },
  switchTextOn: { color: colors.ink },
  branchRow: { gap: 10, paddingRight: spacing.lg },
  branchCard: { width: 260 },
  branchHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  branchName: { flex: 1, fontFamily: fontFamily.bold, fontSize: 18, color: colors.ink },
  behind: { height: 24, paddingHorizontal: 9, borderRadius: radius.full, backgroundColor: colors.tone.caution.bg, justifyContent: "center" },
  behindText: { fontFamily: fontFamily.semibold, fontSize: fontSize.caption, color: colors.tone.caution.fg },
  branchFigs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  branchFig: { flex: 1, backgroundColor: colors.canvas, borderRadius: radius.md, padding: 10 },
  branchFigText: { fontFamily: fontFamily.bold, fontSize: 20, color: colors.ink, fontVariant: ["tabular-nums"] },
  feeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  label: { fontFamily: fontFamily.semibold, marginBottom: 6 },
  right: { textAlign: "right" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  barName: { width: 84, fontFamily: fontFamily.semibold, fontSize: fontSize.fine, color: colors.ink, marginTop: 10 },
  barValue: { width: 40, textAlign: "right", fontFamily: fontFamily.semibold, fontSize: fontSize.fine, color: colors.ink, marginTop: 10, fontVariant: ["tabular-nums"] },
});
