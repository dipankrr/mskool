import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

import { env } from "../env";
import { copy } from "./copy";
import { queryClient } from "./query";
import { withTimeout } from "./with-timeout";

/**
 * Mobile-configured auth client (Step 0, ADR-043). Do NOT reuse the
 * web-configured instance: native has no cookie jar, so the session cookie
 * persists in SecureStore and is attached to each tRPC request manually
 * (see ./trpc.tsx). `credentials: "omit"` — `include` interferes with the
 * manually-set Cookie header on native.
 */
/**
 * SecureStore namespace for the expo plugin's persisted auth material:
 * `${prefix}_cookie` (the session cookie map) and `${prefix}_session_data`
 * (a cached get-session response, rehydrated into the session atom on cold
 * start). `logout()` sweeps both plus the plugin's chunk suffixes — the
 * plugin splits values past ~1.8 KB into `<key>.0..N`.
 */
const AUTH_STORAGE_PREFIX = "mskool";
const AUTH_STORAGE_BASE_KEYS = [
  `${AUTH_STORAGE_PREFIX}_cookie`,
  `${AUTH_STORAGE_PREFIX}_session_data`,
] as const;
const AUTH_STORAGE_CHUNK_SWEEP = 10;

/** Every key the plugin may hold for these bases, chunk suffixes included. */
function storageKeysFor(bases: readonly string[]) {
  return bases.flatMap((base) => [
    base,
    ...Array.from(
      { length: AUTH_STORAGE_CHUNK_SWEEP },
      (_, index) => `${base}.${index}`,
    ),
  ]);
}

/**
 * Account-switch hygiene (2026-10-18 walk finding): a get-session response
 * raced across sign-out can write the OLD session into the plugin's
 * `_session_data` cache *after* `logout()` swept it, and a deleted session's
 * blob then rehydrates the session atom on every cold start — the old user's
 * name, email, and screens appear while the cookie is the new user's.
 * Sweeping the cache on successful sign-in leaves nothing stale to hydrate
 * from; the caller's session refetch writes the new user's copy.
 */
async function purgeSessionCache() {
  try {
    await Promise.all(
      storageKeysFor([`${AUTH_STORAGE_PREFIX}_session_data`]).map((key) =>
        SecureStore.deleteItemAsync(key),
      ),
    );
  } catch {
    // Best-effort: the server session is live and the refetch that follows
    // heals the cache; a failed native delete must not fail the sign-in.
  }
}

export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_API_URL,
  plugins: [
    usernameClient(),
    expoClient({
      scheme: "mskool",
      storagePrefix: AUTH_STORAGE_PREFIX,
      storage: SecureStore,
    }),
  ],
  fetchOptions: {
    credentials: "omit",
  },
});

/** Staff sign-in: email + password (better-auth's emailAndPassword core). */
export async function login(email: string, password: string) {
  const result = await withTimeout((signal) =>
    authClient.signIn.email({ email, password }, { signal }),
  );
  if (!result.error) {
    await purgeSessionCache();
  }
  return result;
}

/**
 * Family sign-in (Step 9; ADR-037 phone-only claim). Kept beside login so the
 * family shell reuses this seam — staff screens never call it.
 */
export async function loginByPhone(username: string, password: string) {
  const result = await withTimeout((signal) =>
    authClient.signIn.username({ username, password }, { signal }),
  );
  if (!result.error) {
    await purgeSessionCache();
  }
  return result;
}

/**
 * Sign-out must never masquerade. better-auth resolves `{ error }` instead of
 * throwing, and swallowing it is how a still-live session could pass as a
 * sign-out (2026-10-18 walk finding #3) — a resolved error THROWS so the
 * caller alerts honestly.
 */
export async function logout() {
  const result = await withTimeout((signal) =>
    authClient.signOut({ fetchOptions: { signal } }),
  );
  if (result.error) {
    throw new Error(copy.auth.signOutFailed);
  }
  // Confirmed by the server. Sweep the persisted auth material and cached
  // server state deterministically: the expo plugin resets its own cache
  // around the request, but a raced or half-completed flow left the old
  // identity readable (the account-switch walk bug). Deletion is stronger
  // than the plugin's "{}" reset — nothing left to hydrate from.
  const keys = storageKeysFor(AUTH_STORAGE_BASE_KEYS);
  try {
    await Promise.all(keys.map((key) => SecureStore.deleteItemAsync(key)));
  } catch {
    // Best-effort: the server session is already dead; a failed native
    // delete must not read as a failed sign-out.
  }
  await queryClient.cancelQueries();
  queryClient.clear();
  return result;
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
