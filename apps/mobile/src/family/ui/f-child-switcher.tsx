import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { useFamilyTheme } from "../theme";
import { FRow } from "./f-row";
import { FSheet } from "./f-sheet";
import { FText } from "./f-text";

export type FChild = {
  id: string;
  /** "Aarav" */
  name: string;
  /** "Class 6 · A" */
  detail: string | null;
};

/**
 * The header's child line: "Aarav, Class 6 · A". With more than one child it
 * opens a sheet to switch; with one it is plain text. All text arrives
 * translated from the caller.
 */
export function FChildSwitcher({
  items,
  selectedId,
  onSelect,
  line,
  sheetTitle,
  switchHint,
  testID,
}: {
  items: FChild[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The header text for the selected child, already formatted. */
  line: string;
  sheetTitle: string;
  /** Screen-reader hint, e.g. "Switch child". */
  switchHint: string;
  testID?: string;
}) {
  const theme = useFamilyTheme();
  const [open, setOpen] = useState(false);
  const many = items.length > 1;

  if (!many) {
    return (
      <FText testID={testID} variant="meta" color="muted" numberOfLines={1} align="center">
        {line}
      </FText>
    );
  }
  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={line}
        accessibilityHint={switchHint}
        hitSlop={8}
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen(true);
        }}
        style={[styles.line, { gap: theme.space.xs }]}
      >
        <FText variant="meta" color="muted" numberOfLines={1} style={styles.text}>
          {line}
        </FText>
        <AppIcon name="chevronDown" size={16} color={theme.color.muted} />
      </Pressable>
      <FSheet visible={open} onDismiss={() => setOpen(false)} title={sheetTitle}>
        {items.map((child) => (
          <FRow
            key={child.id}
            testID={testID ? `${testID}-${child.id}` : undefined}
            title={child.name}
            subtitle={child.detail}
            chevron={false}
            trailing={
              child.id === selectedId ? <AppIcon name="checkCircle" size={22} color={theme.color.ink} /> : null
            }
            onPress={() => {
              onSelect(child.id);
              setOpen(false);
            }}
          />
        ))}
      </FSheet>
    </>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    maxWidth: "100%",
  },
  text: {
    flexShrink: 1,
  },
});
