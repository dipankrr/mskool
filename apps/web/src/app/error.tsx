"use client";

/**
 * THE ROOT ERROR BOUNDARY.
 *
 * Everything above the (dashboard) layout lands here: a failure inside the
 * dashboard layout itself, the sign-in screens, or anything Next fails to
 * attribute to a nearer boundary. It is deliberately self-contained — no
 * AppShell, no context hooks — because whatever threw may have been the shell
 * or the context provider, and rendering either could throw again.
 *
 * `error.message` is never rendered. Render-time failures carry developer
 * wording ("useActiveContext must be used inside ActiveContextGate..."), and
 * the boundary exists precisely so that kind of string dies in the console
 * instead of on a teacher's screen. The digest is Next's correlation id for
 * the server-side log; it is all support needs.
 */

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The one place the raw failure is allowed to go.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">{copy.errors.boundaryTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {copy.errors.boundaryBody}
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            {copy.errors.boundaryDigest}: {error.digest}
          </p>
        ) : null}
      </div>
      <Button onClick={reset}>{copy.common.retry}</Button>
    </main>
  );
}
