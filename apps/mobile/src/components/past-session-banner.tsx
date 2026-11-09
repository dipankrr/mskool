import { useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useActiveContext } from "../hooks/use-active-context";
import { copy } from "../lib/copy";
import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * The warning that sits above the tab bar while a past session is chosen
 * (ADR-066). It stays until its × is pressed, and comes back on the next tab:
 * dismissing is per tab visit, so nobody browses from tab to tab forgetting
 * they are in last year. "Switch back" returns to the running session.
 *
 * The dismissed flag lives in a tiny module store rather than component state,
 * so `useTabBarSpace` can make room on the screen only while it shows.
 */
export const PAST_BANNER_HEIGHT = 56;

/** Dismissed on the tab now showing; reset whenever the tab changes. */
const store = { dismissed: false };
const listeners = new Set<() => void>();
const setDismissed = (value: boolean) => {
  if (store.dismissed === value) return;
  store.dismissed = value;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => store.dismissed;

/** True while the banner is on screen for the focused tab. */
export function usePastBannerShown(): boolean {
  const { academicYear, currentYear } = useActiveContext();
  const dismissed = useSyncExternalStore(subscribe, read, read);
  const viewingPast = Boolean(academicYear && academicYear.id !== currentYear?.id);
  return viewingPast && !dismissed;
}

export function PastSessionBanner({ tabKey }: { tabKey: string }) {
  const { academicYear, selectYear } = useActiveContext();
  // A new tab shows the banner again.
  useEffect(() => {
    setDismissed(false);
  }, [tabKey]);
  const shown = usePastBannerShown();

  if (!shown || !academicYear) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" testID="past-session-banner">
      <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
      <View style={styles.text}>
        <ThemedText variant="bodyStrong" color={colors.tone.caution.fg} numberOfLines={1}>
          {copy.pastSession.title(academicYear.name)}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => selectYear(null)}
          testID="past-session-switch-back"
        >
          <ThemedText variant="caption" color={colors.accentDeep}>
            {copy.pastSession.switchBack}
          </ThemedText>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.pastSession.dismiss}
        hitSlop={10}
        onPress={() => setDismissed(true)}
        style={styles.close}
        testID="past-session-dismiss"
      >
        <AppIcon name="close" size={18} color={colors.tone.caution.fg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: PAST_BANNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.tone.caution.bg,
    borderWidth: 1,
    borderColor: colors.tone.caution.fg,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  close: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
