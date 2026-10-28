import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { Card } from "../../../components/card";
import { SectionLabel } from "../../../components/section-label";
import { StatusPill } from "../../../components/status-pill";
import { ThemedText } from "../../../components/themed-text";
import { coverageSegments } from "../../../lib/grading-scale";
import type { BandDraft } from "../../../lib/grading-scale";
import { colors } from "../../../theme/brand-admin";
import type { Tone } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { AppIcon } from "../../../components/app-icon";

/**
 * GRADING SETUP (chunk 7F) — the three screens' shared anatomy.
 *
 * Only things that repeat across more than one grading screen live here: a
 * section heading with a right-aligned status, the quiet fact chip, the
 * coverage strip, and the "In short" policy card. Each screen still owns its
 * rows and forms.
 */

export function SectionHead({
  title,
  hint,
  tone,
  children,
}: {
  title: string;
  hint?: string;
  /** `critical` when the hint is a refusal rather than a count. */
  tone?: "critical";
  children?: ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <ThemedText variant="sectionLabel">{title}</ThemedText>
      {hint ? (
        <ThemedText
          variant="meta"
          color={tone === "critical" ? colors.tone.critical.fg : undefined}
          numberOfLines={2}
          style={styles.hint}
          accessibilityLiveRegion={tone === "critical" ? "polite" : undefined}
        >
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/** A quiet fact inside a row ("In use", "Default"). Never a control. */
export function QuietChip({
  label,
  tone = "neutral",
  testID,
}: {
  label: string;
  tone?: Tone;
  testID?: string;
}) {
  return <StatusPill label={label} tone={tone} testID={testID} />;
}

/**
 * The 0–100 strip: covered stretches in accent, holes in the critical tint.
 * Decorative — the sentence beside it carries the meaning for a screen reader.
 * Widths are hundredths of a percent, so the picture cannot drift from the
 * numbers the validation reads.
 */
export function CoverageBar({
  drafts,
  testID,
}: {
  drafts: readonly BandDraft[];
  testID?: string;
}) {
  const { segments } = coverageSegments(drafts);

  const pieces: { from: number; to: number; covered: boolean }[] = [];
  let cursor = 0;
  segments.forEach((segment) => {
    if (segment.from > cursor) {
      pieces.push({ from: cursor, to: segment.from, covered: false });
    }
    pieces.push({ from: segment.from, to: Math.max(segment.to, segment.from), covered: true });
    cursor = Math.max(cursor, segment.to);
  });
  if (cursor < 10_000) {
    pieces.push({ from: cursor, to: 10_000, covered: false });
  }

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.bar}
    >
      {pieces.map((piece, index) => (
        <View
          key={`${piece.from}-${piece.to}-${index}`}
          style={[
            styles.piece,
            piece.covered ? styles.pieceCovered : styles.pieceGap,
            { flexGrow: Math.max(piece.to - piece.from, 0.0001) },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * The four-line policy read-back. It sits above the controls on the pass-rule
 * editor so the rule can be understood before the switches are touched.
 */
export function SummaryCard({
  title,
  lines,
  testID,
}: {
  title: string;
  lines: readonly string[];
  testID?: string;
}) {
  return (
    <Card testID={testID}>
      <SectionLabel style={styles.summaryTitle}>{title}</SectionLabel>
      <View style={styles.summaryLines}>
        {lines.map((line, index) => (
          <View key={`${index}-${line}`} style={styles.summaryLine}>
            <AppIcon
              name="checkCircle"
              size={16}
              color={colors.accentDeep}
              style={styles.summaryIcon}
            />
            <ThemedText variant="body" style={styles.summaryText}>
              {line}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  hint: {
    flexShrink: 1,
    textAlign: "right",
  },
  bar: {
    flexDirection: "row",
    height: 10,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: colors.tone.neutral.bg,
  },
  piece: {
    height: "100%",
  },
  pieceCovered: {
    backgroundColor: colors.accent,
  },
  pieceGap: {
    backgroundColor: colors.tone.critical.bg,
  },
  summaryTitle: {
    marginTop: 0,
  },
  summaryLines: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  summaryIcon: {
    marginTop: 3,
  },
  summaryText: {
    flex: 1,
  },
});
