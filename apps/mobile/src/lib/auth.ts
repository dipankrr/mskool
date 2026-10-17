import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

import { env } from "../env";
import { withTimeout } from "./with-timeout";

/**
 * Mobile-configured auth client (Step 0, ADR-043). Do NOT reuse the
 * web-configured instance: native has no cookie jar, so the session cookie
 * persists in SecureStore and is attached to each tRPC request manually
 * (see ./trpc.tsx). `credentials: "omit"` — `include` interferes with the
 * manually-set Cookie header on native.
 */
export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_API_URL,
  plugins: [
    usernameClient(),
    expoClient({
      scheme: "mskool",
      storagePrefix: "mskool",
      storage: SecureStore,
    }),
  ],
  fetchOptions: {
    credentials: "omit",
  },
});

/** Staff sign-in: email + password (better-auth's emailAndPassword core). */
export async function login(email: string, password: string) {
  return withTimeout((signal) =>
    authClient.signIn.email({ email, password }, { signal }),
  );
}

/**
 * Family sign-in (Step 9; ADR-037 phone-only claim). Kept beside login so the
 * family shell reuses this seam — staff screens never call it.
 */
export async function loginByPhone(username: string, password: string) {
  return withTimeout((signal) =>
    authClient.signIn.username({ username, password }, { signal }),
  );
}

export async function logout() {
  return withTimeout((signal) => authClient.signOut({ fetchOptions: { signal } }));
}

/**
 * The first-login change (ADR-007). better-auth's own changePassword endpoint:
 * it verifies the CURRENT (temporary) password, so the change is a proof of
 * possession, not a takeover. The server route clears must_change_password;
 * the caller refetches the session + me.get — never trust a local flag.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  return withTimeout((signal) =>
    authClient.changePassword(
      {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
      { signal },
    ),
  );
}
