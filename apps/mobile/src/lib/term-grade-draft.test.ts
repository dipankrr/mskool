import {
  GRADE_MAX,
  TermGradeDraft,
  sanitizeGrade,
  sanitizeRemarks,
} from "./term-grade-draft";
import type {
  ServerTermGrade,
  TermGradeDraftOptions,
  TermGradeSaveInput,
  TermGradeSaveResult,
} from "./term-grade-draft";

const A = "stu-a";
const B = "stu-b";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function row(partial: Partial<ServerTermGrade> = {}): ServerTermGrade {
  return {
    studentId: A,
    rowId: "row-a",
    grade: "A",
    remarks: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...partial,
  };
}

function saved(
  input: TermGradeSaveInput,
  partial: Partial<TermGradeSaveResult> = {},
): TermGradeSaveResult {
  return {
    rowId: `row-${input.studentId}`,
    grade: input.grade,
    remarks: input.remarks,
    updatedAt: "2026-10-01T10:05:00.000Z",
    ...partial,
  };
}

function setup(save: TermGradeDraftOptions["save"] = jest.fn()) {
  const onConflict = jest.fn();
  const draft = new TermGradeDraft({
    save,
    describeError: (cause) => ({
      message: cause instanceof Error ? cause.message : "failed",
      conflict: cause instanceof Error && /conflict/.test(cause.message),
    }),
    onConflict,
  });
  return { draft, onConflict };
}

/** Let queued microtasks (the awaited save) settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("sanitizeGrade", () => {
  it("upper-cases, collapses spaces and caps the contract length", () => {
    expect(sanitizeGrade("  a   plus ")).toBe(" A PLUS ");
    expect(sanitizeGrade("x".repeat(GRADE_MAX + 5))).toHaveLength(GRADE_MAX);
  });

  it("caps remarks at 500 characters without touching line breaks", () => {
    expect(sanitizeRemarks("one\ntwo")).toBe("one\ntwo");
    expect(sanitizeRemarks("x".repeat(600))).toHaveLength(500);
  });
});

describe("TermGradeDraft", () => {
  it("adopts the server's rows and counts them as graded", () => {
    const { draft } = setup();
    draft.load([A, B], [row(), row({ studentId: B, rowId: "row-b", grade: null })]);

    expect(draft.get(A)?.grade).toBe("A");
    expect(draft.get(A)?.base.rowId).toBe("row-a");
    expect(draft.get(B)?.grade).toBe("");
    expect(draft.status().graded).toBe(1);
    expect(draft.loaded).toBe(true);
  });

  it("keeps typed work when a refetch lands, and never flags a first load", () => {
    const { draft } = setup();
    draft.load([A], [row()]);
    draft.setGrade(A, "b+");
    expect(draft.get(A)?.remoteChange).toBe(false);

    draft.sync([
      row({ grade: "A-", updatedAt: "2026-10-01T10:10:00.000Z" }),
    ]);
    expect(draft.get(A)?.grade).toBe("B+");
    expect(draft.get(A)?.base.grade).toBe("A-");
    expect(draft.isDirty(draft.get(A)!)).toBe(true);
  });

  it("flags a clean value that moved on the server after the first load", () => {
    const { draft } = setup();
    draft.load([A], [row()]);
    draft.sync([
      row({ grade: "A+", updatedAt: "2026-10-01T10:10:00.000Z" }),
    ]);
    expect(draft.get(A)?.grade).toBe("A+");
    expect(draft.get(A)?.remoteChange).toBe(true);
    draft.acknowledge(A);
    expect(draft.get(A)?.remoteChange).toBe(false);
  });

  it("ignores a refetch older than the base", () => {
    const { draft } = setup();
    draft.load([A], [row({ updatedAt: "2026-10-01T10:10:00.000Z" })]);
    draft.sync([row({ grade: "Z", updatedAt: "2026-10-01T09:00:00.000Z" })]);
    expect(draft.get(A)?.grade).toBe("A");
  });

  it("commits a grade and adopts the server's echo", async () => {
    const save = jest.fn(async (input: TermGradeSaveInput) => saved(input));
    const { draft } = setup(save);
    draft.load([A], [row({ grade: null, rowId: null })]);

    draft.setGrade(A, "a1");
    draft.commit(A);
    await flush();

    expect(save).toHaveBeenCalledWith({ studentId: A, grade: "A1", remarks: null });
    expect(draft.get(A)?.phase).toBe("idle");
    expect(draft.get(A)?.base.grade).toBe("A1");
    expect(draft.status().total).toBe(0);
    expect(draft.status().graded).toBe(1);
  });

  it("saves remarks with the grade", async () => {
    const save = jest.fn(async (input: TermGradeSaveInput) => saved(input));
    const { draft } = setup(save);
    draft.load([A], [row({ grade: null, rowId: null })]);

    draft.setGrade(A, "B");
    draft.setRemarks(A, "Needs practice in rhythm.");
    draft.commit(A);
    await flush();

    expect(save).toHaveBeenCalledWith({
      studentId: A,
      grade: "B",
      remarks: "Needs practice in rhythm.",
    });
    expect(draft.get(A)?.base.remarks).toBe("Needs practice in rhythm.");
  });

  it("refuses to clear a saved grade and sends nothing", async () => {
    const save = jest.fn();
    const { draft } = setup(save);
    draft.load([A], [row()]);

    draft.setGrade(A, "");
    draft.commit(A);

    expect(save).not.toHaveBeenCalled();
    expect(draft.get(A)?.problem?.kind).toBe("empty");
    expect(draft.status().typing).toBe(1);
    expect(draft.status().graded).toBe(1);
  });

  it("treats emptying a never-saved field as clean", () => {
    const { draft } = setup();
    draft.load([A], [row({ grade: null, rowId: null })]);
    draft.setGrade(A, "A");
    draft.setGrade(A, "");
    draft.commit(A);
    expect(draft.status().total).toBe(0);
    expect(draft.get(A)?.problem).toBeNull();
  });

  it("serializes one student's saves and re-saves the newer text", async () => {
    const first = deferred<TermGradeSaveResult>();
    const save = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (input: TermGradeSaveInput) => saved(input));
    const { draft } = setup(save);
    draft.load([A], [row({ grade: null, rowId: null })]);

    draft.setGrade(A, "A");
    draft.commit(A);
    draft.setGrade(A, "B");
    draft.commit(A);
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve(saved({ studentId: A, grade: "A", remarks: null }));
    await flush();
    await flush();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({
      studentId: A,
      grade: "B",
      remarks: null,
    });
    expect(draft.get(A)?.phase).toBe("idle");
    expect(draft.get(A)?.base.grade).toBe("B");
  });

  it("keeps failed work, reports it, and retries on demand", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (input: TermGradeSaveInput) => saved(input));
    const { draft } = setup(save);
    draft.load([A], [row({ grade: null, rowId: null })]);

    draft.setGrade(A, "A");
    draft.commit(A);
    await flush();

    expect(draft.get(A)?.phase).toBe("failed");
    expect(draft.get(A)?.problem?.message).toBe("offline");
    expect(draft.get(A)?.grade).toBe("A");
    expect(draft.status().failed).toBe(1);

    draft.retryAll();
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(draft.get(A)?.phase).toBe("idle");
    expect(draft.get(A)?.base.grade).toBe("A");
  });

  it("re-reads on conflict and keeps typed work", async () => {
    const save = jest.fn().mockRejectedValue(
      new Error("conflict: someone saved this row"),
    );
    const { draft, onConflict } = setup(save);
    draft.load([A], [row({ grade: null, rowId: null })]);

    draft.setGrade(A, "A");
    draft.commit(A);
    await flush();

    expect(onConflict).toHaveBeenCalledWith(A);
    expect(draft.get(A)?.problem?.kind).toBe("conflict");
    expect(draft.get(A)?.grade).toBe("A");
  });

  it("discards typed changes back to the saved values", () => {
    const { draft } = setup();
    draft.load([A], [row()]);
    draft.setGrade(A, "C");
    draft.setRemarks(A, "draft note");
    draft.discard(A);
    expect(draft.get(A)?.grade).toBe("A");
    expect(draft.get(A)?.remarks).toBe("");
    expect(draft.status().total).toBe(0);
  });

  it("saves one student without touching another's typed work", async () => {
    const save = jest.fn(async (input: TermGradeSaveInput) => saved(input));
    const { draft } = setup(save);
    draft.load([A, B], [row(), row({ studentId: B, rowId: "row-b", grade: null })]);

    draft.setGrade(B, "c");
    draft.setGrade(A, "a+");
    draft.commit(A);
    await flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ studentId: A, grade: "A+", remarks: null });
    expect(draft.get(B)?.grade).toBe("C");
    expect(draft.status().typing).toBe(1);
  });
});
