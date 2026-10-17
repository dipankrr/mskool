import { TRPCClientError } from "@trpc/client";

// Port of apps/web's errors.test.ts (vitest → jest globals; jest-expo
// preset). Same contract: whatever arrives, the message shown is one a
// teacher can act on and never something a developer wrote for a log.
import { errorMessage, looksTechnical, toFriendlyError } from "./errors";

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
    const result = toFriendlyError(
      new TypeError("cannot read properties of undefined"),
    );
    expect(result.kind).toBe("unknown");
    expect(result.retryable).toBe(true);
    expect(result.message).not.toContain("undefined");
  });

  it("maps a response-less tRPC error to the network wording", () => {
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

  it("passes through the subject gate's honest refusal (ADR-029 amended)", () => {
    const result = toFriendlyError(
      trpcError({
        message: "You are not the assigned teacher for this paper.",
        data: { code: "FORBIDDEN" },
      }),
    );
    expect(result.kind).toBe("forbidden");
    expect(result.message).toContain("assigned teacher");
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

  it("errorMessage returns the mapped message directly", () => {
    expect(
      errorMessage(trpcError({ data: { code: "UNAUTHORIZED" } })),
    ).toContain("session expired");
  });
});

describe("looksTechnical", () => {
  it("rejects empty, overlong, JSON, permission, and trace shapes", () => {
    expect(looksTechnical("")).toBe(true);
    expect(looksTechnical("x".repeat(301))).toBe(true);
    expect(looksTechnical('[{"code":"too_small"}]')).toBe(true);
    expect(looksTechnical("Missing permission: fee:read")).toBe(true);
    expect(looksTechnical("boom at async save (/a/b.ts:1:2)")).toBe(true);
  });

  it("accepts human sentences written for the user", () => {
    expect(looksTechnical("Choose a branch first")).toBe(false);
    expect(looksTechnical("That session overlaps 2024-25.")).toBe(false);
  });

  it("rejects native transport failure shapes (2026-10-17 walk finding)", () => {
    expect(
      looksTechnical(
        "fetch failed: java.net.ConnectException: Failed to connect to /192.168.0.101:4000",
      ),
    ).toBe(true);
    expect(looksTechnical("Network request failed")).toBe(true);
    expect(looksTechnical("The operation was aborted")).toBe(true);
  });
});
