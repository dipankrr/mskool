import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";

import { TrpcProvider, trpc } from "../lib/trpc";
import { wireQueryLifecycle } from "../lib/query";
import { ActiveContextProvider, useActiveContext } from "../hooks/use-active-context";
import { useSessionBoundary } from "../hooks/use-session-boundary";
import { useMe } from "../hooks/use-me";
import { colors } from "../theme/brand-admin";

SplashScreen.preventAutoHideAsync();

// Keys must match the `fontFamily` token in theme/tokens.ts. Loaded in the
// root layout so no route renders before the face is available.
const FONTS = {
  "ClashGrotesk-Regular": require("../../assets/fonts/ClashGrotesk-Regular.ttf"),
  "ClashGrotesk-Medium": require("../../assets/fonts/ClashGrotesk-Medium.ttf"),
  "ClashGrotesk-Semibold": require("../../assets/fonts/ClashGrotesk-Semibold.ttf"),
  "ClashGrotesk-Bold": require("../../assets/fonts/ClashGrotesk-Bold.ttf"),
} as const;

/**
 * Provider tree, outside-in: tRPC/QueryClient → active-context → session
 * boundary → routes. The hydration gate lives here (splash until session +
 * `me.get` settle) so no route ever decides on unhydrated state — deciding
 * early is what flashes the wrong shell on cold start. Route guards are
 * navigation behavior, not a security boundary: the API authorizes every
 * request server-side.
 */
function Shell() {
  const { clear } = useActiveContext();
  const { session, sessionPending, isFetched } = useMe();
  const utils = trpc.useUtils();

  useSessionBoundary(clear);

  useEffect(() => wireQueryLifecycle(), []);

  // Foreground return refetches identity so a grant/revoke surfaces without
  // waiting out the 60s staleTime (server remains authoritative regardless).
  // Mount is skipped — the initial fetch is already fresh.
  const sessionRef = useRef(session);
  // Latest-value ref for the listener without resubscribing on every session
  // change: updated post-commit, before any AppState event can run.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener("change", (status) => {
      if (prev !== "active" && status === "active" && sessionRef.current) {
        void utils.me.get.invalidate();
      }
      prev = status;
    });
    return () => subscription.remove();
  }, [utils]);

  const hydrated = !sessionPending && (!session || isFetched);
  useEffect(() => {
    if (hydrated) {
      void SplashScreen.hideAsync();
    }
  }, [hydrated]);

  return (
    <>
      {/* The design is light-only this slice; dark content on the light canvas
          (no UIUserInterfaceStyle flip until dark mode is designed). */}
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONTS);
  // Splash stays up (hide is gated on hydration in Shell) until the face is
  // in, so no early screen flashes the system font.
  if (!fontsLoaded) return null;

  return (
    <TrpcProvider>
      <ActiveContextProvider>
        <Shell />
      </ActiveContextProvider>
    </TrpcProvider>
  );
}
