import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { router } from "expo-router";
import type { Href } from "expo-router";

import { SessionSheet } from "../../components/session-sheet";
import { useActiveContext } from "../../hooks/use-active-context";
import { AccountSheet } from "./account-sheet";
import { Sidebar } from "./sidebar";

/**
 * The staff shell's two overlays, mounted once above every staff screen: the
 * sidebar (every screen, from the menu button) and the account popup (who and
 * where, from the avatar). Screens ask for them through `useShell`; none of
 * them owns a copy.
 *
 * Only one is ever up. The session picker is a third sheet the account popup
 * hands over to, so two sheets never stack.
 */
type Shell = {
  openMenu: () => void;
  openAccount: () => void;
};

const ShellContext = createContext<Shell>({ openMenu: () => {}, openAccount: () => {} });

export function useShell(): Shell {
  return useContext(ShellContext);
}

type Overlay = "menu" | "account" | "sessions" | null;

export function ShellProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const { years, currentYear, academicYear, selectYear } = useActiveContext();

  const close = useCallback(() => setOverlay(null), []);
  const shell = useMemo<Shell>(
    () => ({
      openMenu: () => setOverlay("menu"),
      openAccount: () => setOverlay("account"),
    }),
    [],
  );

  const go = useCallback((href: Href, tab: boolean) => {
    setOverlay(null);
    // A tab is switched to; anything else is pushed over the tabs.
    if (tab) router.navigate(href);
    else router.push(href);
  }, []);

  return (
    <ShellContext.Provider value={shell}>
      {children}
      <Sidebar visible={overlay === "menu"} onClose={close} onGo={go} />
      <AccountSheet
        visible={overlay === "account"}
        // Dismissal also fires when this sheet is swapped for the session
        // picker; only clear the overlay if this sheet still owns it.
        onDismiss={() => setOverlay((current) => (current === "account" ? null : current))}
        onOpenSessions={() => setOverlay("sessions")}
        onOpenProfile={() => go("/profile", false)}
        onChangePassword={() =>
          go({ pathname: "/change-password", params: { returnTo: "/home" } }, false)
        }
      />
      <SessionSheet
        visible={overlay === "sessions"}
        years={years}
        currentYear={currentYear}
        chosenId={academicYear?.id ?? ""}
        onSelect={(id) => {
          // Back to the running one stores nothing, so a later change of the
          // running session is followed without a stale pin.
          selectYear(id === currentYear?.id ? null : id);
          setOverlay(null);
        }}
        onDismiss={() => setOverlay((current) => (current === "sessions" ? null : current))}
      />
    </ShellContext.Provider>
  );
}
