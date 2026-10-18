import { isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "@repo/trpc";

import { copy } from "./copy";

/**
 * Port of apps/web's `lib/errors.ts` (ADR-026's client half). Whatever went
 * wrong, in words a teacher can act on.
 *
 * Two rules, unchanged: a server message is passed through only where the
 * server writes for the user (CONFLICT, BAD_REQUEST); nothing
 * developer-facing gets through even by accident (`looksTechnical` rejects
 * first, so a data-layer string degrades to generic wording instead of
 * leaking onto a clerk's screen).
 */
type ErrorKind =
  | "signedOut"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "invalid"
  | "network"
  | "server"
  | "unknown";

type FriendlyError = {
  kind: ErrorKind;
  /** Ready to render. Never null, never a raw exception message. */
  message: string;
  /** Offer a Retry control — the same request could plausibly succeed. */
  retryable: boolean;
  /** The session is gone. The caller should send the user to the login route. */
  requiresSignIn: boolean;
};

export function looksTechnical(message: string): boolean {
  if (message.length === 0 || message.length > 300) return true;
  if (message.startsWith("[") || message.startsWith("{")) return true;
  if (
    /missing permission|\bat (?:async )?\w+ \(|constraint|postgres|drizzle|relation "|column "|sqlstate|undefined is not|cannot read propert/i.test(
      message,
    )
  ) {
    return true;
  }
  // Native transport failures (2026-10-17 walk: a raw
  // `fetch failed: java.net.ConnectException: Failed to connect to …`
  // reached the login screen). Callers map these to copy.errors.network.
  return /fetch failed|connectexception|failed to connect|java\.net|network request failed|etimedout|econnreset|enetunreach|econnrefused|aborted/i.test(
    message,
  );
}

/**
 * Server-authored FORBIDDEN messages that ARE for a screen. The default hides
 * the gate's machine-shaped wording; the subject gate's refusal (ADR-029
 * amended) is written for the teacher it refuses. Explicit allowlist.
 */
const HONEST_FORBIDDEN_MESSAGES: RegExp[] = [
  /^You are not the assigned teacher for this paper\.$/,
];

function honestForbiddenOrFallback(
  message: string | undefined,
  fallback: string,
): string {
  if (!message) return fallback;
  return HONEST_FORBIDDEN_MESSAGES.some((pattern) => pattern.test(message))
    ? message
    : fallback;
}

function humanOrFallback(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const trimmed = message.trim();
  return looksTechnical(trimmed) ? fallback : trimmed;
}

/** The one function callers need. Accepts anything. */
export function toFriendlyError(cause: unknown): FriendlyError {
  if (!isTRPCClientError<AppRouter>(cause)) {
    return {
      kind: "unknown",
      message: copy.errors.unknown,
      retryable: true,
      requiresSignIn: false,
    };
  }

  if (!cause.data) {
    return {
      kind: "network",
      message: copy.errors.network,
      retryable: true,
      requiresSignIn: false,
    };
  }

  switch (cause.data.code) {
    case "UNAUTHORIZED":
      return {
        kind: "signedOut",
        message: copy.errors.signedOut,
        retryable: false,
        requiresSignIn: true,
      };
    case "FORBIDDEN":
      return {
        kind: "forbidden",
        message: honestForbiddenOrFallback(cause.message, copy.errors.forbidden),
        retryable: false,
        requiresSignIn: false,
      };
    case "NOT_FOUND":
      return {
        kind: "notFound",
        message: copy.errors.notFound,
        retryable: false,
        requiresSignIn: false,
      };
    case "CONFLICT":
    case "PRECONDITION_FAILED":
      return {
        kind: "conflict",
        message: humanOrFallback(cause.message, copy.errors.conflict),
        retryable: false,
        requiresSignIn: false,
      };
    case "BAD_REQUEST":
    case "UNPROCESSABLE_CONTENT":
    case "PARSE_ERROR":
      return {
        kind: "invalid",
        message: humanOrFallback(cause.message, copy.errors.invalid),
        retryable: false,
        requiresSignIn: false,
      };
    case "TOO_MANY_REQUESTS":
      return {
        kind: "invalid",
        message: copy.errors.tooMany,
        retryable: true,
        requiresSignIn: false,
      };
    case "TIMEOUT":
    case "INTERNAL_SERVER_ERROR":
    case "BAD_GATEWAY":
    case "SERVICE_UNAVAILABLE":
    case "GATEWAY_TIMEOUT":
      return {
        kind: "server",
        message: copy.errors.server,
        retryable: true,
        requiresSignIn: false,
      };
    default:
      return {
        kind: "unknown",
        message: copy.errors.unknown,
        retryable: true,
        requiresSignIn: false,
      };
  }
}

/** Shorthand for the common case: one line under a field. */
export function errorMessage(cause: unknown): string {
  return toFriendlyError(cause).message;
}

/**
 * Message for a thrown (not tRPC-shaped) error — the auth transport path
 * (sign-in / sign-out). A human Error message passes through (the rule the
 * login screen used inline); anything else becomes the network copy, the
 * dominant cause of a thrown auth call on native (2026-10-17 walk).
 */
export function thrownMessage(cause: unknown): string {
  return cause instanceof Error && !looksTechnical(cause.message)
    ? cause.message
    : copy.errors.network;
}
