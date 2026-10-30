import { useMemo } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { asAnnualSnapshot, snapshotVersionOf } from "../../../lib/annual";
import { annualCopy } from "../../../lib/annual-copy";
import { copy } from "../../../lib/copy";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { VerdictPill, pct } from "./parts";
import { useAnnualCard } from "./use-annual";

const c = annualCopy.card;

/**
 * THE YEAR CARD (chunk 7G) - the version-2 snapshot, drawn for a phone: the
 * verdict and ranks first, the terms as a strip, then the subjects grouped by
 * the school's own widgets with each term's score and the year. A draft is
 * labelled as one until it is published; a version this app does not know is
 * said to be unknown, never guessed at.
 */
export function AnnualCardScreen() {
  const { classId, studentId } = useLocalSearchParams<{ classId: string; studentId: string }>();
  const scope = useExamScope();
  const card = useAnnualCard(classId, studentId);

  const snapshot = useMemo(
    () => (card.data ? asAnnualSnapshot(card.data.snapshotData) : null),
    [card.data],
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={snapshot?.student.name ?? c.title}
      meta={snapshot ? `${snapshot.student.className}${snapshot.student.sectionName ? ` · ${snapshot.student.sectionName}` : ""}` : undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="annual-card-back"
      titleTestID="annual-card-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canReadCards) {
    return frame(
      <EmptyState icon="lock" title={copy.exams.deniedTitle} message={copy.exams.deniedBody} testID="annual-card-denied" />,
    );
  }
  if (!scope.ready || card.isPending) {
    return frame(
      <View style={styles.body} testID="annual-card-loading">
        <Skeleton height={120} />
        <Skeleton height={220} />
      </View>,
    );
  }
  if (card.isError) {
    return frame(<ErrorCard cause={card.error} onRetry={() => void card.refetch()} testID="annual-card-error" />);
  }
  if (!card.data) {
    return frame(<EmptyState icon="exams" title={c.notFound} message={c.notFoundBody} testID="annual-card-none" />);
  }
  if (!snapshot) {
    const version = snapshotVersionOf(card.data.snapshotData);
    return frame(
      <EmptyState
        icon="info"
        title={c.unreadable}
        message={version !== null ? `${c.unreadableBody} (version ${version})` : c.unreadableBody}
        testID="annual-card-unreadable"
      />,
    );
  }

  const groups = new Map<string, typeof snapshot.subjects>();
  for (const subject of snapshot.subjects) {
    const key = subject.widgetName ?? "";
    groups.set(key, [...(groups.get(key) ?? []), subject]);
  }
  const showSum = snapshot.policy.totalDisplay === "sum";

  return frame(
    <View style={styles.body}>
      <Notice
        tone={card.data.status === "draft" ? "caution" : "positive"}
        icon={card.data.status === "draft" ? "info" : "checkCircle"}
        title={card.data.status === "draft" ? c.draftBanner : c.publishedBanner(card.data.version ?? 1)}
        testID="annual-card-banner"
      />

      <Card testID="annual-card-head">
        <ThemedText variant="meta">{snapshot.school.name}</ThemedText>
        <ThemedText variant="bodyStrong">{snapshot.academicYear.name}</ThemedText>
        <ThemedText variant="meta" style={styles.policy}>
          {snapshot.policy.summary}
        </ThemedText>
        <View style={styles.verdictRow}>
          <VerdictPill status={snapshot.verdict.promotionStatus} testID="annual-card-verdict" />
          {snapshot.totals.percentage ? (
            <ThemedText variant="bodyStrong">
              {pct(snapshot.totals.percentage)}%{snapshot.totals.grade ? ` · ${snapshot.totals.grade}` : ""}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText variant="meta">
          {[
            snapshot.totals.rankInSection ? `${c.rankSection} ${snapshot.totals.rankInSection}` : null,
            snapshot.totals.rankInClass ? `${c.rankClass} ${snapshot.totals.rankInClass}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
        {snapshot.verdict.failedSubjects.length > 0 ? (
          <ThemedText variant="body" color={colors.tone.critical.fg} style={styles.failed}>
            {snapshot.verdict.failedSubjects.map((s) => s.subjectName).join(", ")}
          </ThemedText>
        ) : null}
      </Card>

      <ThemedText variant="sectionLabel" style={styles.section}>
        {c.termsTitle}
      </ThemedText>
      <Card padless testID="annual-card-terms">
        {snapshot.terms.map((term, index) => (
          <View key={term.termId} style={[styles.termRow, index === 0 ? null : styles.divider]}>
            <ThemedText variant="bodyStrong" style={styles.termName}>
              {term.name}
            </ThemedText>
            <ThemedText variant="body">
              {term.percentage ? `${pct(term.percentage)}%` : "-"}
              {term.grade ? ` · ${term.grade}` : ""}
              {term.nominalWeight ? ` · weight ${pct(term.nominalWeight)}%` : ""}
            </ThemedText>
          </View>
        ))}
      </Card>

      {[...groups.entries()].map(([widget, subjects]) => (
        <View key={widget || "subjects"} style={styles.group}>
          <ThemedText variant="sectionLabel" style={styles.section}>
            {widget || annualCopy.student.subjectsTitle}
          </ThemedText>
          <Card padless>
            {subjects.map((subject, index) => (
              <View
                key={subject.subjectId}
                style={[styles.subjectRow, index === 0 ? null : styles.divider]}
                testID={`annual-card-subject-${subject.subjectId}`}
              >
                <View style={styles.subjectHead}>
                  <ThemedText variant="bodyStrong" style={styles.termName} numberOfLines={2}>
                    {subject.subjectName}
                  </ThemedText>
                  <ThemedText
                    variant="bodyStrong"
                    color={subject.isExempted || subject.isPassed ? colors.ink : colors.tone.critical.fg}
                  >
                    {subject.isExempted
                      ? annualCopy.student.excused
                      : showSum && subject.displayMarks
                        ? `${pct(subject.displayMarks)}/${pct(subject.displayMax)}`
                        : subject.percentage
                          ? `${pct(subject.percentage)}${subject.grade ? ` · ${subject.grade}` : ""}`
                          : (subject.grade ?? "-")}
                  </ThemedText>
                </View>
                <ThemedText variant="meta">
                  {snapshot.terms
                    .map((term) => {
                      const t = subject.byTerm.find((x) => x.termId === term.termId);
                      return `${term.name.replace(/^Term\s*/i, "T")} ${t?.score ? pct(t.score) : (t?.grade ?? "-")}${t?.used ? "" : " (not counted)"}`;
                    })
                    .join("  ·  ")}
                </ThemedText>
              </View>
            ))}
          </Card>
        </View>
      ))}

      {snapshot.attendance ? (
        <ThemedText variant="meta" style={styles.section}>
          {`${annualCopy.student.attendance}: ${snapshot.attendance.daysPresent}/${snapshot.attendance.workingDays} days${
            snapshot.attendance.percentage ? ` · ${pct(snapshot.attendance.percentage)}%` : ""
          }`}
        </ThemedText>
      ) : null}
    </View>,
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  policy: { marginTop: spacing.xs },
  verdictRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
  failed: { marginTop: spacing.xs },
  section: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  group: { gap: spacing.sm },
  termRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  termName: { flex: 1 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  subjectRow: { gap: spacing.xxs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.sm },
  subjectHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
});
