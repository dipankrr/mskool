"use client";

/**
 * THE DASHBOARD ERROR BOUNDARY, nested inside (dashboard)/layout.tsx.
 *
 * A page that throws during render lands here instead of taking the whole
 * shell down: the sidebar, the org and session switchers and the theme toggle
 * all stay mounted and usable, which matters when the failure is in one
 * screen's data and the fix is navigating elsewhere. Only a failure in the
 * layout or provider itself escapes to app/error.tsx.
 *
 * Same contract as the root boundary: never render `error.message`, offer the
 * digest, make retry one click.
 */

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
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
