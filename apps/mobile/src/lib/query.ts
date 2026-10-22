import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";
import * as Network from "expo-network";

/**
 * Server state lives here and nowhere else (Step 0, ADR-043).
 *
 * Freshness policy: `staleTime` bounds freshness, it is NOT polling — no
 * interval refetch anywhere. Foreground return + mutation invalidation is
 * the freshness policy. `me.get` refetches on foreground + after assignment
 * mutations; reference lists override staleTime to 5 min per call.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false, // native has no window focus; AppState drives it
      // Do not PAUSE offline reads (2026-10-19 walk): a paused query keeps
      // `isPending` forever, so a screen with no cache shows a skeleton and no
      // explanation. Attempt the request instead — it fails fast into the
      // screens' existing connection copy + Retry, and resumes on reconnect.
      networkMode: "always",
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false;
        // 403/404/409 never succeed on retry — fail honestly instead.
        const code = (error as { data?: { code?: string } })?.data?.code;
        return (
          code !== "FORBIDDEN" && code !== "NOT_FOUND" && code !== "CONFLICT"
        );
      },
    },
    mutations: {
      // Same rule for writes: a paused offline save would sit on "Saving…"
      // and fire later, after the user thinks it failed. Fail now with the
      // connection copy instead — nothing is written behind their back.
      networkMode: "always",
    },
  },
});

/**
 * Wiring, verbatim per TanStack's React Native guidance: AppState changes →
 * focusManager, expo-network state → onlineManager (already a dependency via
 * better-auth — no new package). Call once from the root layout effect;
 * returns cleanup for HMR/unmount.
 */
export function wireQueryLifecycle() {
  const onAppStateChange = (status: AppStateStatus) => {
    if (Platform.OS !== "web") {
      focusManager.setFocused(status === "active");
    }
  };
  const appStateSubscription = AppState.addEventListener(
    "change",
    onAppStateChange,
  );

  let initialised = false;
  let removeNetworkListener: (() => void) | undefined;
  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) => {
      initialised = true;
      setOnline(!!state.isConnected);
    });
    Network.getNetworkStateAsync()
      .then((state) => {
        if (!initialised) setOnline(!!state.isConnected);
      })
      .catch(() => {
        // getNetworkStateAsync can reject on some platforms/SDK versions.
      });
    removeNetworkListener = () => subscription.remove();
    return removeNetworkListener;
  });

  return () => {
    appStateSubscription.remove();
    removeNetworkListener?.();
  };
}
