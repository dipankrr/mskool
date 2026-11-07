import { useEffect, useRef } from "react";
import { useWindowDimensions } from "react-native";
import type { ReactNode } from "react";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

/**
 * A bottom sheet in the family look (`components.sheet`), on the same
 * engine as the staff sheets. The caller owns `visible`.
 */
export function FSheet({
  visible,
  onDismiss,
  title,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  children: ReactNode;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const theme = useFamilyTheme();
  const k = theme.components.sheet;
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
      backgroundStyle={{ backgroundColor: k.bg, borderRadius: k.radius }}
      handleIndicatorStyle={{ backgroundColor: k.grabber }}
    >
      <BottomSheetView style={{ paddingHorizontal: k.padding, paddingBottom: theme.space.huge, gap: theme.space.md }}>
        {title ? (
          <FText variant="heading" accessibilityRole="header">
            {title}
          </FText>
        ) : null}
        <BottomSheetScrollView
          style={{ maxHeight: Math.round(height * 0.6) }}
          contentContainerStyle={{ gap: theme.components.row.stackGap }}
        >
          {children}
        </BottomSheetScrollView>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
