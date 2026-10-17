import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";

import { TrpcProvider, trpc } from "../lib/trpc";
import { wireQueryLifecycle } from "../lib/query";
import { ActiveContextProvider, useActiveContext } from "../hooks/use-active-context";
import { useSessionBoundary } from "../hooks/use-session-boundary";
import { useMe } from "../hooks/use-me";

SplashScreen.preventAutoHideAsync();

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
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <TrpcProvider>
      <ActiveContextProvider>
        <Shell />
      </ActiveContextProvider>
    </TrpcProvider>
  );
}
