import { bestEffort, withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  it("passes an un-aborted signal and resolves when work finishes first", async () => {
    const result = await withTimeout(async (signal) => {
      expect(signal.aborted).toBe(false);
      return "ok";
    }, 1_000);
    expect(result).toBe("ok");
  });

  it("aborts the work when the deadline passes", async () => {
    jest.useFakeTimers();
    try {
      const work = withTimeout(
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("Aborted")),
            );
          }),
        1_000,
      );
      const assertion = expect(work).rejects.toThrow("Aborted");
      jest.advanceTimersByTime(1_001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("bestEffort", () => {
  it("resolves when the work settles, even when it fails", async () => {
    await expect(
      bestEffort(Promise.reject(new Error("boom")), 1_000),
    ).resolves.toBeUndefined();
  });

  it("stops waiting after the deadline while the work keeps running", async () => {
    jest.useFakeTimers();
    try {
      const hanging = new Promise<void>(() => {});
      const done = bestEffort(hanging, 2_000);
      jest.advanceTimersByTime(2_001);
      await done;
    } finally {
      jest.useRealTimers();
    }
  });
});
