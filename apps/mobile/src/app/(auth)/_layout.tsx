import { Stack } from "expo-router";

import { colors } from "../../theme/brand-admin";

/**
 * Route group shell: no UI of its own, only a shared Stack. Headers stay
 * hidden (2026-10-18 walk finding #5): the default header rendered the raw
 * route title ("login") above screens that draw their own titles.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}
