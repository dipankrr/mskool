import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
// Type-only import — the same boundary as apps/web: TypeScript erases this
// entirely, so server-only modules (HTTP server, data layer, drivers,
// connection strings) can never reach the native bundle. Row shapes come
// from inferRouterOutputs.
import type { AppRouter } from "@repo/trpc";

import { authClient } from "./auth";
import { queryClient } from "./query";
import { withDeadline } from "./with-timeout";
import { env } from "../env";

export const trpc = createTRPCReact<AppRouter>();

/**
 * tRPC-over-HTTP is the only transport. Auth rides a `Cookie` header built
 * from SecureStore (`await authClient.getCookie()`), NOT
 * `credentials: "include"` — include interferes with the manually-set
 * cookies on native. Wire carries no superjson: timestamps arrive as
 * strings, money as decimal strings — identical to web.
 */
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${env.EXPO_PUBLIC_API_URL}/trpc`,
          async headers() {
            const cookies = await authClient.getCookie();
            // Queries are GETs and React Query invalidates them on every
            // mutation. The native HTTP layer has a disk cache; without this
            // a refetch is answered from the stored body and the screen keeps
            // the pre-save value (API also sends no-store; this is the belt).
            return {
              "cache-control": "no-store",
              ...(cookies ? { Cookie: cookies } : {}),
            };
          },
          fetch(url, options) {
            // Every call carries a deadline (2026-10-18 walk finding #4): a
            // dead-zone network must fail into the screens' retry copy, not
            // spin forever. Fused with React Query's cancellation signal so
            // unmounts still abort; `release` drops the timer + listener.
            const { signal, release } = withDeadline(options?.signal);
            return fetch(url, { ...options, credentials: "omit", signal }).finally(
              release,
            );
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
