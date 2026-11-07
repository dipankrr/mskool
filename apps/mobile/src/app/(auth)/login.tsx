import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import "../../family/i18n";
import { FamilyLogin } from "../../family/screens/family-login";
import { useMe } from "../../hooks/use-me";
import { bestEffort } from "../../lib/with-timeout";
import { StaffLoginForm } from "../../screens/auth/staff-login-form";

/** Bounded post-sign-in session settle (see the staff form). */
const SIGN_IN_SETTLE_MS = 4_000;

/** The phone remembers which form it last used, so a staff phone opens on staff. */
const MODE_KEY = "login.mode";
type Mode = "family" | "staff";

/**
 * One sign-in screen for everyone. Families (the majority) see the phone
 * form by default; staff tap "Staff sign in" for the email form. A settled
 * session never sees either form: armed sessions go to the forced change,
 * everyone else to the index dispatch, which picks the shell.
 */
export default function LoginScreen() {
  const { session, sessionPending, mustChangePassword, isFetched, refetchSession } = useMe();
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(MODE_KEY)
      .then((saved) => {
        if (alive) setMode(saved === "staff" ? "staff" : "family");
      })
      .catch(() => {
        if (alive) setMode("family");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!sessionPending && session && isFetched) {
    return <Redirect href={mustChangePassword ? "/change-password" : "/"} />;
  }
  if (mode === null) return null;

  const choose = (next: Mode) => {
    setMode(next);
    void AsyncStorage.setItem(MODE_KEY, next).catch(() => undefined);
  };

  if (mode === "staff") {
    return <StaffLoginForm onFamily={() => choose("family")} />;
  }
  return (
    <FamilyLogin
      onStaff={() => choose("staff")}
      onSignedIn={async () => {
        await bestEffort(refetchSession(), SIGN_IN_SETTLE_MS);
        router.replace("/");
      }}
    />
  );
}
