import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { BottomSheetModal, BottomSheetView } from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { IconTile } from "../../components/icon-tile";
import { SectionLabel } from "../../components/section-label";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { spacing, touch } from "../../theme/tokens";

/**
 * The branch list behind Home's branch switch. Picking one changes the app's
 * branch, the same as the account popup does, so every tab follows.
 */
export function BranchSheet({ visible, onDismiss, onPicked }: { visible: boolean; onDismiss: () => void; onPicked: () => void }) {
  const ref = useRef<BottomSheetModal>(null);
  const { organizationId, schoolId, branches, select } = useActiveContext();

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.canvas }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetView style={styles.content}>
        <SectionLabel>{copy.more.branch}</SectionLabel>
        <Card padless>
          {branches.map((branch, index) => {
            const selected = branch.id === schoolId;
            return (
              <Pressable
                key={branch.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={branch.name}
                onPress={() => {
                  void Haptics.selectionAsync();
                  if (organizationId && !selected) select(organizationId, branch.id);
                  onPicked();
                  onDismiss();
                }}
                style={({ pressed }) => [styles.row, index === 0 ? null : styles.divider, pressed ? styles.pressed : null]}
                testID={`home-branch-pick-${branch.id}`}
              >
                <IconTile name="branches" tone={selected ? "accent" : "neutral"} />
                <View style={styles.text}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {branch.name}
                  </ThemedText>
                  {branch.code || branch.city ? (
                    <ThemedText variant="meta" numberOfLines={1}>
                      {[branch.code, branch.city].filter(Boolean).join(" · ")}
                    </ThemedText>
                  ) : null}
                </View>
                {selected ? <AppIcon name="check" size={18} color={colors.accentDeep} /> : null}
              </Pressable>
            );
          })}
        </Card>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch.row, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  text: { flex: 1, gap: spacing.xxs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.field },
});
