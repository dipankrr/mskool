import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { translateError } from "./errors";

/**
 * A SERVICE REFUSAL (services/service-error.ts) crosses the transport with its
 * code and its sentence intact; anything else unrecognised stays a generic 500.
 * The refusal is built by hand here (name + code) because the transport
 * recognises it by shape, never by importing the services package.
 */

const refusal = (code: string, message: string) =>
  Object.assign(new Error(message), { name: "ServiceRefusal", code });

/** tRPC wraps whatever a resolver throws in an INTERNAL_SERVER_ERROR with the original as cause. */
const wrapped = (cause: unknown) =>
  new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: cause as Error });

describe("translateError - service refusals", () => {
  it("passes the code and the sentence through", () => {
    const out = translateError(wrapped(refusal("CONFLICT", "Set the annual rules for this class first.")));
    expect(out.code).toBe("CONFLICT");
    expect(out.message).toBe("Set the annual rules for this class first.");
  });

  it.each(["BAD_REQUEST", "CONFLICT", "NOT_FOUND"])("keeps %s", (code) => {
    expect(translateError(wrapped(refusal(code, "x"))).code).toBe(code);
  });

  it("does not let a refusal claim a code outside the three it may use", () => {
    const out = translateError(wrapped(refusal("FORBIDDEN", "Nice try")));
    expect(out.code).toBe("INTERNAL_SERVER_ERROR");
    expect(out.message).not.toContain("Nice try");
  });

  it("still answers an unrecognised plain Error with the generic 500, never its text", () => {
    const out = translateError(wrapped(new Error("select * from secrets failed")));
    expect(out.code).toBe("INTERNAL_SERVER_ERROR");
    expect(out.message).not.toContain("secrets");
  });

  it("leaves a deliberately chosen tRPC code alone", () => {
    const forbidden = new TRPCError({ code: "FORBIDDEN", message: "No." });
    expect(translateError(forbidden)).toBe(forbidden);
  });
});
