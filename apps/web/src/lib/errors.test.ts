import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";

// Imported from the module, not a barrel (A1/A5 note — see format.test.ts).
import { toFriendlyError } from "./errors";

/**
 * The contract under test: whatever arrives, the message shown is one a
 * teacher can act on and never something a developer wrote for a log. The
 * fixtures are deliberately hostile — a raw Postgres exclusion-constraint
 * string, a zod issue array, a bare permission name, a stack trace.
 */

type FakeErrorInit = {
  message?: string;
  data?: { code: string };
};

/**
 * A genuine TRPCClientError instance carrying a hand-set envelope. Built on
 * the real prototype because errors.ts gates every branch behind
 * isTRPCClientError's instanceof check — a lookalike would fall through to
 * "unknown" and test nothing.
 */
function trpcError({ message, data }: FakeErrorInit): unknown {
  const error = Object.create(TRPCClientError.prototype);
  error.message = message ?? "";
  error.name = "TRPCClientError";
  error.data = data;
  return error;
}

describe("toFriendlyError", () => {
  it("treats a non-tRPC throw as an unknown retryable failure", () => {
    const result = toFriendlyError(new TypeError("cannot read properties of undefined"));
    expect(result.kind).toBe("unknown");
    expect(result.retryable).toBe(true);
    expect(result.message).not.toContain("undefined");
  });

  it("maps a response-less tRPC error to the network wording", () => {
    // No `data` means no tRPC envelope ever arrived: DNS, CORS, API down.
    const result = toFriendlyError(trpcError({}));
    expect(result.kind).toBe("network");
    expect(result.retryable).toBe(true);
    expect(result.requiresSignIn).toBe(false);
  });

  it("sends UNAUTHORIZED to sign-in", () => {
    const result = toFriendlyError(
      trpcError({ data: { code: "UNAUTHORIZED" } }),
    );
    expect(result.kind).toBe("signedOut");
    expect(result.requiresSignIn).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it("never repeats the server's FORBIDDEN wording, even the permission name", () => {
    // THE case from the plan: staffProcedure's raw message names the
    // permission. It must not reach the screen.
    const result = toFriendlyError(
      trpcError({
        message: "Missing permission: school:create",
        data: { code: "FORBIDDEN" },
      }),
    );
    expect(result.kind).toBe("forbidden");
    expect(result.message).not.toContain("school:create");
    expect(result.message).not.toContain("Missing permission");
  });

  it("phrases NOT_FOUND as availability, not accusation", () => {
    const result = toFriendlyError(
      trpcError({ data: { code: "NOT_FOUND" } }),
    );
    expect(result.kind).toBe("notFound");
    expect(result.requiresSignIn).toBe(false);
  });

  it("passes through a human CONFLICT message written for the user (ADR-026)", () => {
    const result = toFriendlyError(
      trpcError({
        message: "That session overlaps 2024-25.",
        data: { code: "CONFLICT" },
      }),
    );
    expect(result.kind).toBe("conflict");
    expect(result.message).toContain("overlaps");
  });

  it("degrades a stack-trace-shaped CONFLICT message to generic wording", () => {
    const result = toFriendlyError(
      trpcError({
        message:
          "Failed query: insert into ... at async createSchool (/app/src/services/organization.service.ts:42:9)",
        data: { code: "CONFLICT" },
      }),
    );
    expect(result.kind).toBe("conflict");
    expect(result.message).not.toContain("insert into");
    expect(result.message).not.toContain(".service.ts");
  });

  it("passes through a human BAD_REQUEST message (ADR-026 service translations)", () => {
    const result = toFriendlyError(
      trpcError({
        message: "Choose a branch first",
        data: { code: "BAD_REQUEST" },
      }),
    );
    expect(result.kind).toBe("invalid");
    expect(result.message).toContain("Choose a branch first");
  });

  it("degrades a zod issue array to form-pointing fallback wording", () => {
    const issues = JSON.stringify([
      { origin: "string", code: "too_small", path: ["data", "name"] },
    ]);
    const result = toFriendlyError(
      trpcError({ message: issues, data: { code: "BAD_REQUEST" } }),
    );
    expect(result.kind).toBe("invalid");
    expect(result.message).not.toContain("{");
    expect(result.message).not.toContain("too_small");
  });

  it("routes PRECONDITION_FAILED to the conflict family", () => {
    const result = toFriendlyError(
      trpcError({ data: { code: "PRECONDITION_FAILED" } }),
    );
    expect(result.kind).toBe("conflict");
  });

  it("routes PARSE_ERROR to the invalid family", () => {
    const result = toFriendlyError(
      trpcError({ data: { code: "PARSE_ERROR" } }),
    );
    expect(result.kind).toBe("invalid");
  });

  it("offers retry for rate limiting", () => {
    const result = toFriendlyError(
      trpcError({ data: { code: "TOO_MANY_REQUESTS" } }),
    );
    expect(result.kind).toBe("invalid");
    expect(result.retryable).toBe(true);
  });

  it("keeps the whole server-outage family vague and retryable", () => {
    for (const code of [
      "INTERNAL_SERVER_ERROR",
      "TIMEOUT",
      "BAD_GATEWAY",
      "SERVICE_UNAVAILABLE",
      "GATEWAY_TIMEOUT",
    ] as const) {
      // A raw constraint string rides along as the message; none of it may
      // survive the mapping.
      const result = toFriendlyError(
        trpcError({
          message:
            'error: new row for relation "academic_years" violates exclusion constraint',
          data: { code },
        }),
      );
      expect(result.kind).toBe("server");
      expect(result.retryable).toBe(true);
      expect(result.message).not.toContain("exclusion");
    }
  });
});
