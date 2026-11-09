import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
} from "@expo/ui/community/bottom-sheet";

import { colors } from "../../../theme/brand-admin";
import { spacing } from "../../../theme/tokens";

/**
 * The profile's read-and-pick sheets (More, recent homework, all details): the same
 * bottom sheet ChoiceSheet uses, driven by `visible`, scrolling past 78% of the screen.
 */
export function ProfileSheet({
  visible,
  onDismiss,
  testID,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  testID: string;
  children: ReactNode;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetScrollView
        testID={testID}
        style={{ maxHeight: Math.round(height * 0.78) }}
        contentContainerStyle={styles.content}
      >
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.huge,
  },
});
