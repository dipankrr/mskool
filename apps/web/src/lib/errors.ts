import { isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "@repo/trpc";

import { copy } from "@/lib/copy";

/**
 * WHATEVER WENT WRONG, IN WORDS A TEACHER CAN ACT ON.
 *
 * `packages/trpc/src/errors.ts` (ADR-026) already turns database and service
 * failures into human sentences on the server. This is the other half: the
 * failures that never reach a resolver — no session, no permission, no network —
 * plus the decision about what the UI should *do* about each one.
 *
 * Two rules.
 *
 * **A server message is passed through only where the server writes for the user.**
 * That is CONFLICT and BAD_REQUEST, which ADR-026 phrases deliberately. FORBIDDEN
 * is not one of them: `staffProcedure` throws `Missing permission: school:create`,
 * which is correct for a developer reading a log and useless on a screen.
 *
 * **Nothing developer-facing gets through even by accident.** `looksTechnical`
 * inspects a message before it is shown, so an unmapped constraint or a stack
 * trace degrades to generic wording instead of leaking. A slightly vaguer message
 * is a worse experience; a Postgres string on a school clerk's screen is a broken
 * one.
 */

export type ErrorKind =
  | "signedOut"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "invalid"
  | "network"
  | "server"
  | "unknown";

export type FriendlyError = {
  kind: ErrorKind;
  /** Ready to render. Never null, never a raw exception message. */
  message: string;
  /** Offer a Retry control — the same request could plausibly succeed. */
  retryable: boolean;
  /**
   * The session is gone. The caller should send the user to `/login`; this module
   * stays free of `next/navigation` so it can be read from anywhere, including a
   * server component.
   */
  requiresSignIn: boolean;
};

/**
 * Does this read like something written for a developer?
 *
 * Only ever used to *reject* a message, so a false positive costs a little
 * specificity and a false negative costs a leak. Weighted accordingly.
 */
function looksTechnical(message: string): boolean {
  if (message.length === 0 || message.length > 300) return true;

  // A zod issue array arrives as JSON, because the routers set no errorFormatter.
  if (message.startsWith("[") || message.startsWith("{")) return true;

  return /missing permission|\bat \w+ \(|constraint|postgres|drizzle|relation "|column "|sqlstate|econnrefused|undefined is not|cannot read propert/i.test(
    message,
  );
}

/** A server-authored message if it is fit to show, otherwise the fallback. */
function humanOrFallback(message: string | undefined, fallback: string): string {
  if (!message) return fallback;

  const trimmed = message.trim();

  return looksTechnical(trimmed) ? fallback : trimmed;
}

/**
 * The one function callers need. Accepts anything — a TanStack Query error is
 * typed `unknown` at most call sites, and a thrown string is still possible.
 */
export function toFriendlyError(cause: unknown): FriendlyError {
  if (!isTRPCClientError<AppRouter>(cause)) {
    /**
     * Not a tRPC failure at all: a bug in a component, or `fetch` rejecting
     * before the link could wrap it. Retryable, because the commonest cause of a
     * bare TypeError here is a dropped connection mid-request.
     */
    return {
      kind: "unknown",
      message: copy.errors.unknown,
      retryable: true,
      requiresSignIn: false,
    };
  }

  /**
   * No `data` means the request never got a tRPC response to shape: DNS, CORS,
   * an offline device, or the API not running. This is the single most common
   * failure in development and on a patchy mobile connection, and it is the one
   * that most needs a Retry rather than an explanation.
   */
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

    /**
     * Never the server's wording. `staffProcedure` names the permission it wanted
     * and `resolveNode` deliberately conflates "missing" with "not yours" so a
     * caller cannot probe which ids exist — neither is a sentence for a screen.
     */
    case "FORBIDDEN":
      return {
        kind: "forbidden",
        message: copy.errors.forbidden,
        retryable: false,
        requiresSignIn: false,
      };

    /**
     * Often not an error at all in this app: a `class_teacher` addressing a closed
     * session by a valid id gets NOT_FOUND because `read_history` gates the row,
     * not because the row is gone (ADR-024). "No longer available" is true in both
     * readings, and does not accuse the user of anything.
     */
    case "NOT_FOUND":
      return {
        kind: "notFound",
        message: copy.errors.notFound,
        retryable: false,
        requiresSignIn: false,
      };

    /** ADR-026 writes these for the user: overlapping dates, a duplicate name. */
    case "CONFLICT":
    case "PRECONDITION_FAILED":
      return {
        kind: "conflict",
        message: humanOrFallback(cause.message, copy.errors.conflict),
        retryable: false,
        requiresSignIn: false,
      };

    /**
     * Two different failures share this code. ADR-026's service translations are
     * human — "Choose a branch first" — while zod input validation arrives as a
     * JSON array of issues. `looksTechnical` separates them, and the array case
     * falls back to wording that points at the form.
     */
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

    /**
     * Redis or Postgres unreachable, or an untranslated throw. ADR-026 logs the
     * detail server-side and sends deliberately vague wording, so there is nothing
     * here worth showing beyond "try again".
     */
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

/** Shorthand for the common case: a toast, or one line under a field. */
export function errorMessage(cause: unknown): string {
  return toFriendlyError(cause).message;
}
