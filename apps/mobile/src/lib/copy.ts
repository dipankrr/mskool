/**
 * English strings only (Step 0). Vocabulary mirrors apps/web's `lib/copy.ts`
 * so both clients phrase the same failure the same way. A later locale adds
 * files under a real i18n setup (react-i18next + expo-localization) with the
 * in-app override — no screen is touched then. Screens read this module, never
 * literals, so the key-per-string discipline already holds.
 */
export const copy = {
  /** Read by `lib/errors.ts`. Nothing else should phrase a failure. */
  errors: {
    signedOut: "Your session expired. Please sign in again.",
    forbidden: "You don't have permission to do this. Ask your administrator.",
    notFound: "This record is no longer available. It may have been closed or moved.",
    invalid: "Some details need fixing. Check the highlighted fields and try again.",
    conflict: "That conflicts with something already saved. Check the details and try again.",
    network: "Couldn't reach the server. Check your connection and try again.",
    server: "Something went wrong on our side. Please try again.",
    tooMany: "Too many attempts. Wait a moment and try again.",
    unknown: "Something went wrong. Please try again.",
  },
  auth: {
    appName: "mskool",
    signInTitle: "Sign in",
    emailLabel: "Email",
    passwordLabel: "Password",
    signInAction: "Sign in",
    signingIn: "Signing in…",
    invalidCredentials:
      "Those details didn't match. Check them and try again.",
    forcedChangeTitle: "Set your own password",
    forcedChangeBody:
      "For security, set your own password before continuing. You cannot skip this step.",
    currentPasswordLabel: "Current password",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm new password",
    passwordMismatch: "The new passwords don't match.",
    changeAction: "Set password",
    changing: "Setting password…",
    signOutAction: "Sign out",
  },
  session: {
    loading: "Checking your session…",
    loadFailed: "Couldn't check your session.",
    retry: "Retry",
  },
} as const;
