"use client";

import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
// Type-only import — this is the whole trick that keeps apps/web from
// ever bundling apps/api's server code (express, drizzle, postgres...).
// TypeScript erases this import entirely at build time.
import type { AppRouter } from "@repo/trpc";
import { env } from "@/env";

export const trpc = createTRPCReact<AppRouter>();

export function getTrpcClientConfig() {
  return {
    links: [
      httpBatchLink({
        url: `${env.NEXT_PUBLIC_API_URL}/trpc`,

        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" }); // send better-auth cookie
        },
      }),
    ],
  };
}
