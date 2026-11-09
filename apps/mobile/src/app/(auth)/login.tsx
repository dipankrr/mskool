import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";

import "../../family/i18n";
import { FamilyLogin } from "../../family/screens/family-login";
import { Welcome } from "../../family/screens/welcome";
import { useMe } from "../../hooks/use-me";
import { clearLoginChoice, readLoginChoice, saveLoginChoice } from "../../lib/login-choice";
import type { LoginChoice } from "../../lib/login-choice";
import { bestEffort } from "../../lib/with-timeout";
import { StaffLoginForm } from "../../screens/auth/staff-login-form";

/** Bounded post-sign-in session settle (see the staff form). */
const SIGN_IN_SETTLE_MS = 4_000;

/** `loading` until storage answers; `welcome` when the phone has no saved choice. */
type Stage = LoginChoice | "welcome" | "loading";

/**
 * One sign-in route for everyone. A phone with no saved choice (first
 * launch, after signing out) opens on the welcome screen, whose two cards
 * pick the family or staff form; the choice is remembered, so a staff phone
 * opens straight on the staff form. Back on either form forgets it. A
 * settled session never sees any of this: armed sessions go to the forced
 * change, everyone else to the index dispatch, which picks the shell.
 */
export default function LoginScreen() {
  const { session, sessionPending, mustChangePassword, isFetched, refetchSession } = useMe();
  const [view, setView] = useState<Stage>("loading");

  useEffect(() => {
    let alive = true;
    void readLoginChoice().then((saved) => {
      if (alive) setView(saved ?? "welcome");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!sessionPending && session && isFetched) {
    return <Redirect href={mustChangePassword ? "/change-password" : "/"} />;
  }
  if (view === "loading") return null;

  const choose = (next: LoginChoice) => {
    setView(next);
    void saveLoginChoice(next);
  };
  const back = () => {
    setView("welcome");
    void clearLoginChoice();
  };

  if (view === "welcome") {
    return <Welcome onChoose={choose} />;
  }
  if (view === "staff") {
    return <StaffLoginForm onBack={back} />;
  }
  return (
    <FamilyLogin
      onBack={back}
      onSignedIn={async () => {
        await bestEffort(refetchSession(), SIGN_IN_SETTLE_MS);
        router.replace("/");
      }}
    />
  );
}
