import { bestEffort, withDeadline, withTimeout } from "./with-timeout";

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

describe("withDeadline", () => {
  it("aborts the fused signal when the deadline passes", () => {
    jest.useFakeTimers();
    try {
      const { signal, release } = withDeadline(undefined, 1_000);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(1_001);
      expect(signal.aborted).toBe(true);
      release();
    } finally {
      jest.useRealTimers();
    }
  });

  it("forwards an external abort, and starts aborted when already aborted", () => {
    const external = new AbortController();
    const fused = withDeadline(external.signal, 60_000);
    external.abort();
    expect(fused.signal.aborted).toBe(true);
    fused.release();

    const preAborted = new AbortController();
    preAborted.abort();
    const immediate = withDeadline(preAborted.signal, 60_000);
    expect(immediate.signal.aborted).toBe(true);
    immediate.release();
  });

  it("stops watching the deadline after release", () => {
    jest.useFakeTimers();
    try {
      const { signal, release } = withDeadline(undefined, 1_000);
      release();
      jest.advanceTimersByTime(5_000);
      expect(signal.aborted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
