"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, getTrpcClientConfig } from "./client";
import { toFriendlyError } from "@/lib/errors";

/**
 * THE ONE RETRY POLICY.
 *
 * One retry — not TanStack's default three with exponential backoff. Measured:
 * a failing list showed a loading skeleton for about seventeen seconds before
 * admitting anything was wrong, and a user reads that as a hang and reloads the
 * page, restarting the same seventeen seconds. One retry covers the genuinely
 * transient case (a dropped connection, a cold database) and then says so.
 *
 * What is retried is decided by the error mapper, not here: a permission or
 * not-found answer is final (asking again cannot change it), an expired session
 * must go to sign-in rather than spin, and only network/server failures are
 * worth another attempt. Stating this once means no query can drift into
 * retrying a 403.
 */
function queryRetry(failureCount: number, error: Error): boolean {
  const friendly = toFriendlyError(error);
  return friendly.retryable && !friendly.requiresSignIn && failureCount < 1;
}

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: queryRetry,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => trpc.createClient(getTrpcClientConfig()));

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
