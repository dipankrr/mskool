"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { useSessionBoundary } from "@/lib/session-boundary";
import { copy } from "@/lib/copy";

/**
 * Signing out is a real request, so it can be slow and it can fail.
 *
 * `router.replace` rather than `push`: the signed-in page must not be reachable by
 * pressing Back. The dashboard gate would bounce it anyway, but a flash of the
 * previous screen is a bad look for an action whose whole point is leaving.
 *
 * The session boundary runs BEFORE the navigation: the query cache still holds
 * the previous user's `me.get` permission snapshot and lists, and signing out
 * without clearing them is exactly how the NEXT user inherited this user's UI
 * until a hard refresh (see lib/session-boundary.ts).
 */
export function SignOutButton({
  variant = "outline",
  className,
}: {
  variant?: "outline" | "ghost" | "destructive";
  className?: string;
}) {
  const router = useRouter();
  const { logout } = useAuth();
  const clearSessionState = useSessionBoundary();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant={variant}
      className={className}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await logout();
          await clearSessionState();
          router.replace("/login");
        } finally {
          // If sign-out failed the user is still signed in, so the control has to
          // come back rather than staying stuck in a pending state.
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <LogOutIcon data-icon="inline-start" />
      )}
      {copy.nav.signOut}
    </Button>
  );
}
