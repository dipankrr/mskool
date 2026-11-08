import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { useFamilyTheme } from "../theme";

/**
 * A teacher's note as a sticky note. The words stay in the normal face so a
 * long note reads easily; `redo` is the pink note on work sent back.
 */
export function FNote({
  body,
  by,
  look = "plain",
  testID,
  style,
}: {
  body: string;
  /** "Mrs. Rao · sent back Mon". */
  by?: string;
  look?: "plain" | "redo";
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useFamilyTheme();
  const n = theme.components.note;
  const colors = n.look[look];
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.bg,
          padding: n.padding,
          gap: theme.space.sm,
          borderRadius: n.radius,
          borderTopLeftRadius: n.corner,
          transform: [{ rotate: n.tilt }],
        },
        style,
      ]}
    >
      <Text selectable style={[theme.text("heading"), { color: colors.fg }]}>
        {body}
      </Text>
      {by ? <Text style={[theme.text("meta"), { color: colors.muted }]}>{by}</Text> : null}
    </View>
  );
}
