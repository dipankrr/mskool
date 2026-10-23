import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@expo/ui/community/bottom-sheet";

import { CapsuleButton } from "../../components/capsule-button";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";

/**
 * The summary's "How this is calculated" sheet. The year card keeps the
 * numbers short; this is the one place the two rates and the half-day
 * accounting are explained in full. It is intentionally not a modal alert:
 * the teacher can keep it open while looking at the report behind it.
 */
export function SummaryInfoSheet({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [visible]);

  const rows = [
    {
      title: copy.attendance.summary.calculation.coverageTitle,
      body: copy.attendance.summary.calculation.coverageBody,
    },
    {
      title: copy.attendance.summary.calculation.officialTitle,
      body: copy.attendance.summary.calculation.officialBody,
    },
    {
      title: copy.attendance.summary.calculation.markedTitle,
      body: copy.attendance.summary.calculation.markedBody,
    },
  ];

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetView style={styles.content}>
        <ThemedText variant="title" style={styles.title}>
          {copy.attendance.summary.calculation.title}
        </ThemedText>
        <View style={styles.rows}>
          {rows.map((row) => (
            <View key={row.title} style={styles.row}>
              <ThemedText variant="bodyStrong">{row.title}</ThemedText>
              <ThemedText variant="meta" color={colors.muted} style={styles.body}>
                {row.body}
              </ThemedText>
            </View>
          ))}
        </View>
        <CapsuleButton
          title={copy.attendance.summary.calculation.close}
          variant="secondary"
          size="compact"
          onPress={onDismiss}
          style={styles.close}
          testID="summary-info-close"
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.huge,
  },
  title: {
    marginTop: spacing.xs,
  },
  rows: {
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  row: {
    gap: spacing.xs,
  },
  body: {
    color: colors.muted,
  },
  close: {
    marginTop: spacing.xxl,
    alignSelf: "stretch",
  },
});
