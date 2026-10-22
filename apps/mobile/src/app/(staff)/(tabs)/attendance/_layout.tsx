import { Stack } from "expo-router";

import { colors } from "../../../../theme/brand-admin";

/**
 * The attendance tab's own stack (chunk 3): the marking/summary shell is the
 * root screen, and the management surfaces (hub, calendar, policy, periods)
 * push over it. Headers stay off — every screen draws its own head row; the
 * floating tab bar stays visible, and pushed screens pad with
 * `useTabBarSpace()`.
 */
export default function AttendanceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}
