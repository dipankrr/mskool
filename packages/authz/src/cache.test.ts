import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cache invalidators (ADR-016) had no callers outside the seed until admin
 * endpoints arrive, and a function with no callers and no tests drifts
 * silently until the day something calls it — which for invalidation means a
 * stale permission decision. One test each, while the behaviour is obvious.
 *
 * Both are mocked at the socket boundary: ioredis becomes an in-memory class,
 * the drizzle chain returns fixture rows, and ./env is stubbed so importing
 * this module never needs real credentials.
 */

const delMock = vi.hoisted(() => vi.fn(async (..._keys: string[]) => 1));

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    del = delMock;
    constructor(_url: string) {}
  },
}));

vi.mock("./env", () => ({ env: { REDIS_URL: "redis://test:6379" } }));

vi.mock("@repo/db", () => ({
  db: {
    selectDistinct: () => ({
      from: () => ({
        where: async () => [{ userId: "user-111" }, { userId: "user-222" }],
      }),
    }),
  },
}));

import { invalidateOrgAuthCache, invalidateScopeNode } from "./cache";

describe("cache invalidators", () => {
  beforeEach(() => {
    delMock.mockClear();
  });

  it("invalidateOrgAuthCache drops the user key of every role-holder in the org", async () => {
    await invalidateOrgAuthCache("org-1");

    // One DEL with all keys, not one round-trip per user — the seed runs this
    // after building four users' grants.
    expect(delMock).toHaveBeenCalledTimes(1);
    // mock.calls[0] is the full argument list of that one DEL call.
    const keys = delMock.mock.calls[0];
    expect(keys).toEqual(["authz:user:user-111", "authz:user:user-222"]);
  });

  it("invalidateScopeNode drops exactly that node's key", async () => {
    await invalidateScopeNode("node-9");

    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith("authz:node:node-9");
  });
});
