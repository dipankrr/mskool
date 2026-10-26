import {
  PaperDraft,
  reopenItems,
  reviewSummary,
  staleItems,
  studentsMatching,
  studentsMatchingReview,
  summarizePaper,
  verifyBatch,
} from "./exam-draft";
import type {
  DraftOptions,
  SaveInput,
  SaveResult,
  ServerEntry,
} from "./exam-draft";

const STUDENT = "stu-1";
const THEORY = "comp-theory";
const PRACTICAL = "comp-practical";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function entry(partial: Partial<ServerEntry> = {}): ServerEntry {
  return {
    id: "row-1",
    studentId: STUDENT,
    componentId: THEORY,
    resultStatus: "entered",
    marksObtained: "15.00",
    gradeObtained: null,
    isAbsent: false,
    isExempted: false,
    updatedAt: "2026-04-06T10:00:00.123Z",
    ...partial,
  };
}

function result(partial: Partial<SaveResult> = {}): SaveResult {
  return {
    id: "row-1",
    resultStatus: "entered",
    marksObtained: "17.00",
    gradeObtained: null,
    isAbsent: false,
    isExempted: false,
    updatedAt: "2026-04-06T10:05:00.456Z",
    ...partial,
  };
}

function setup(
  save: DraftOptions["save"],
  rules: { graded?: boolean; negative?: boolean } = {},
) {
  const onConflict = jest.fn();
  const draft = new PaperDraft({
    save,
    describeError: (cause) => ({
      message: cause instanceof Error ? cause.message : "failed",
      conflict: cause instanceof Error && /typing/.test(cause.message),
    }),
    onConflict,
  });
  draft.configure({
    maxByComponent: new Map([
      [THEORY, 20],
      [PRACTICAL, 10],
    ]),
    isGradedOnly: rules.graded ?? false,
    allowNegative: rules.negative ?? false,
  });
  return { draft, onConflict };
}

/** Let queued microtasks (the awaited save) settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("PaperDraft", () => {
  it("adopts the server's value for a clean cell and shows it without zeros", () => {
    const { draft } = setup(jest.fn());
    draft.sync([entry()]);
    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.text).toBe("15");
    expect(cell?.phase).toBe("idle");
    expect(draft.unsaved()).toHaveLength(0);
  });

  it("does not send anything while typing, and marks the cell unsaved", () => {
    const save = jest.fn();
    const { draft } = setup(save);
    draft.setText(STUDENT, THEORY, "17");
    expect(save).not.toHaveBeenCalled();
    expect(draft.unsaved()).toHaveLength(1);
  });

  it("saves on commit and adopts the echo, only after the server answers", async () => {
    const pending = deferred<SaveResult>();
    const save = jest.fn().mockReturnValue(pending.promise);
    const { draft } = setup(save);
    draft.sync([entry()]);

    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY);

    const sent = save.mock.calls[0]?.[0] as SaveInput;
    expect(sent).toMatchObject({
      studentId: STUDENT,
      componentId: THEORY,
      marks: "17",
      grade: null,
      isAbsent: false,
      isExempted: false,
      // the previous updatedAt, verbatim — milliseconds and all
      expectedUpdatedAt: "2026-04-06T10:00:00.123Z",
    });
    expect(draft.get(`${STUDENT}:${THEORY}`)?.phase).toBe("saving");

    pending.resolve(result());
    await flush();

    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.phase).toBe("idle");
    expect(cell?.base.updatedAt).toBe("2026-04-06T10:05:00.456Z");
    expect(cell?.text).toBe("17");
    expect(draft.unsaved()).toHaveLength(0);
  });

  it("omits expectedUpdatedAt for a cell with no row yet", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save);
    draft.setText(STUDENT, THEORY, "9");
    draft.commit(STUDENT, THEORY);
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty("expectedUpdatedAt");
  });

  it("refuses an over-max value before the wire and keeps what was typed", () => {
    const save = jest.fn();
    const { draft } = setup(save);
    draft.setText(STUDENT, THEORY, "22");
    draft.commit(STUDENT, THEORY);
    expect(save).not.toHaveBeenCalled();
    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.text).toBe("22");
    expect(cell?.problem).toEqual({ kind: "range" });
    expect(draft.unsaved()).toHaveLength(1);
  });

  it("clears a blank value back to a draft (marks null)", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "");
    draft.commit(STUDENT, THEORY);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ marks: null, isAbsent: false });
  });

  it("does not save a cell that already matches the server", () => {
    const save = jest.fn();
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "15.0");
    draft.commit(STUDENT, THEORY);
    expect(save).not.toHaveBeenCalled();
  });

  it("serialises one cell: a second edit waits and chains the fresh updatedAt", async () => {
    const first = deferred<SaveResult>();
    const second = deferred<SaveResult>();
    const save = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { draft } = setup(save);
    draft.sync([entry()]);

    draft.setText(STUDENT, THEORY, "16");
    draft.commit(STUDENT, THEORY);
    expect(save).toHaveBeenCalledTimes(1);

    draft.setText(STUDENT, THEORY, "18");
    draft.commit(STUDENT, THEORY);
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve(result({ marksObtained: "16.00", updatedAt: "2026-04-06T10:06:00.000Z" }));
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      marks: "18",
      expectedUpdatedAt: "2026-04-06T10:06:00.000Z",
    });

    second.resolve(result({ marksObtained: "18.00", updatedAt: "2026-04-06T10:07:00.000Z" }));
    await flush();
    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.text).toBe("18");
    expect(cell?.phase).toBe("idle");
  });

  it("keeps typed work and marks the row failed when the save fails", async () => {
    const save = jest.fn().mockRejectedValue(new Error("Couldn't reach the server."));
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY);
    await flush();

    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.phase).toBe("failed");
    expect(cell?.text).toBe("17");
    expect(cell?.problem).toEqual({
      kind: "server",
      message: "Couldn't reach the server.",
    });
    expect(draft.failed()).toHaveLength(1);
  });

  it("retries a failed cell with the typed value", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error("Couldn't reach the server."))
      .mockResolvedValueOnce(result());
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY);
    await flush();

    draft.retryAll();
    await flush();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({ marks: "17" });
    expect(draft.get(`${STUDENT}:${THEORY}`)?.phase).toBe("idle");
    expect(draft.unsaved()).toHaveLength(0);
  });

  it("flags a conflict, asks for a refetch, and keeps the typed value on sync", async () => {
    const save = jest
      .fn()
      .mockRejectedValue(new Error("Someone else saved this while you were typing."));
    const { draft, onConflict } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY);
    await flush();

    expect(onConflict).toHaveBeenCalledWith(`${STUDENT}:${THEORY}`);
    expect(draft.get(`${STUDENT}:${THEORY}`)?.problem?.kind).toBe("conflict");

    // The refetch brings the other writer's value; typed work is NOT clobbered.
    draft.sync([
      entry({ marksObtained: "12.00", updatedAt: "2026-04-06T10:09:00.000Z" }),
    ]);
    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.text).toBe("17");
    expect(cell?.base.updatedAt).toBe("2026-04-06T10:09:00.000Z");
  });

  it("discard returns a cell to the server's value", async () => {
    const save = jest.fn().mockRejectedValue(new Error("nope"));
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY);
    await flush();
    draft.discard(STUDENT, THEORY);
    const cell = draft.get(`${STUDENT}:${THEORY}`);
    expect(cell?.text).toBe("15");
    expect(cell?.phase).toBe("idle");
    expect(cell?.problem).toBeNull();
  });

  it("merge-on-refetch keeps typed rows and refreshes clean ones", () => {
    const { draft } = setup(jest.fn());
    draft.sync([
      entry(),
      entry({ id: "row-2", studentId: "stu-2", marksObtained: "10.00" }),
    ]);
    draft.setText(STUDENT, THEORY, "19");
    draft.sync([
      entry({ marksObtained: "11.00", updatedAt: "2026-04-06T11:00:00.000Z" }),
      entry({
        id: "row-2",
        studentId: "stu-2",
        marksObtained: "14.00",
        updatedAt: "2026-04-06T11:00:00.000Z",
      }),
    ]);
    expect(draft.get(`${STUDENT}:${THEORY}`)?.text).toBe("19");
    expect(draft.get(`stu-2:${THEORY}`)?.text).toBe("14");
  });

  it("typing a number cancels absent; AB saves immediately and clears the number", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setAbsent(STUDENT, THEORY, true);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      marks: null,
      isAbsent: true,
      isExempted: false,
    });
    expect(draft.get(`${STUDENT}:${THEORY}`)?.text).toBe("");
  });

  it("exempt needs its type and sends it", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save);
    draft.setExempt(STUDENT, THEORY, true, null);
    expect(save).not.toHaveBeenCalled();
    draft.setExempt(STUDENT, THEORY, true, "medical");
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      isExempted: true,
      exemptionType: "medical",
      marks: null,
    });
  });

  it("does not treat an untouched exempt row as unsaved", () => {
    const { draft } = setup(jest.fn());
    draft.sync([
      entry({ isExempted: true, marksObtained: null, resultStatus: "entered" }),
    ]);
    expect(draft.unsaved()).toHaveLength(0);
  });

  it("never edits a verified or published row", () => {
    const save = jest.fn();
    const { draft } = setup(save);
    draft.sync([entry({ resultStatus: "verified" })]);
    draft.setText(STUDENT, THEORY, "19");
    draft.setAbsent(STUDENT, THEORY, true);
    draft.commit(STUDENT, THEORY);
    expect(save).not.toHaveBeenCalled();
    expect(draft.get(`${STUDENT}:${THEORY}`)?.text).toBe("15");
  });

  it("sends grades for a graded-only paper and never marks", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save, { graded: true });
    draft.setText(STUDENT, THEORY, "a+");
    draft.commit(STUDENT, THEORY);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ marks: null, grade: "A+" });
  });

  it("treats each component as its own cell", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save);
    draft.setText(STUDENT, THEORY, "60");
    draft.setText(STUDENT, PRACTICAL, "8");
    draft.commit(STUDENT, PRACTICAL);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ componentId: PRACTICAL, marks: "8" });
    // 60 is over theory's max of 20 — it is only judged when committed.
    draft.commit(STUDENT, THEORY);
    expect(draft.get(`${STUDENT}:${THEORY}`)?.problem).toEqual({ kind: "range" });
  });

  it("limits concurrent saves across cells", async () => {
    const gates = [deferred<SaveResult>(), deferred<SaveResult>(), deferred<SaveResult>(), deferred<SaveResult>()];
    let call = 0;
    const save = jest.fn().mockImplementation(() => gates[call++]!.promise);
    const draft = new PaperDraft({
      save,
      describeError: () => ({ message: "x", conflict: false }),
      maxParallel: 2,
    });
    draft.configure({
      maxByComponent: new Map([[THEORY, 20]]),
      isGradedOnly: false,
      allowNegative: false,
    });
    for (const id of ["a", "b", "c"]) {
      draft.setText(id, THEORY, "5");
      draft.commit(id, THEORY);
    }
    expect(save).toHaveBeenCalledTimes(2);
    gates[0]!.resolve(result({ id: "r-a" }));
    await flush();
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("ignores a refetch that is older than a save which already landed", async () => {
    const save = jest.fn().mockResolvedValue(result());
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY);
    await flush();
    expect(draft.get(`${STUDENT}:${THEORY}`)?.text).toBe("17");

    // A read that left before the save landed arrives late with the old row.
    draft.sync([entry()]);
    expect(draft.get(`${STUDENT}:${THEORY}`)?.text).toBe("17");
    expect(draft.get(`${STUDENT}:${THEORY}`)?.base.updatedAt).toBe(
      "2026-04-06T10:05:00.456Z",
    );
  });

  it("does not send the same value twice when Next and blur both commit", () => {
    const save = jest.fn().mockReturnValue(new Promise(() => {}));
    const { draft } = setup(save);
    draft.sync([entry()]);
    draft.setText(STUDENT, THEORY, "17");
    draft.commit(STUDENT, THEORY); // the Next key
    draft.commit(STUDENT, THEORY); // the blur that follows
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("load creates every cell so rows never read a missing one", () => {
    const { draft } = setup(jest.fn());
    expect(draft.loaded).toBe(false);
    draft.load(
      {
        maxByComponent: new Map([[THEORY, 20]]),
        isGradedOnly: false,
        allowNegative: false,
      },
      ["a", "b"],
      [THEORY],
      [entry({ studentId: "a" })],
    );
    expect(draft.loaded).toBe(true);
    expect(draft.get(`a:${THEORY}`)?.text).toBe("15");
    expect(draft.get(`b:${THEORY}`)?.text).toBe("");
    expect(draft.unsaved()).toHaveLength(0);
  });

  it("gives a row a by-value signature that moves only when its student does", () => {
    const { draft } = setup(jest.fn());
    draft.load(
      {
        maxByComponent: new Map([[THEORY, 20]]),
        isGradedOnly: false,
        allowNegative: false,
      },
      ["a", "b"],
      [THEORY],
      [],
    );
    const before = draft.studentSignature("a");
    const other = draft.studentSignature("b");
    draft.setText("a", THEORY, "7");
    expect(draft.studentSignature("a")).not.toBe(before);
    expect(draft.studentSignature("b")).toBe(other);
    const listener = jest.fn();
    draft.subscribeStudent("a", listener);
    draft.setText("a", THEORY, "8");
    draft.setText("b", THEORY, "9");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("summarises progress from saved values and chips from what is on screen", () => {
    const { draft } = setup(jest.fn());
    draft.load(
      {
        maxByComponent: new Map([[THEORY, 20]]),
        isGradedOnly: false,
        allowNegative: false,
      },
      ["a", "b", "c", "d"],
      [THEORY],
      [
        entry({ studentId: "a", marksObtained: "15.00" }),
        entry({ id: "r2", studentId: "b", marksObtained: "4.00" }),
        entry({ id: "r3", studentId: "c", marksObtained: null, isAbsent: true }),
      ],
    );
    draft.setText("d", THEORY, "6"); // typed, not saved
    const components = [{ id: THEORY, pass: 7 }];
    const summary = summarizePaper(draft, ["a", "b", "c", "d"], components, THEORY, 0);
    expect(summary).toEqual({
      total: 4,
      entered: 3, // a, b, c are on the server; d is only typed
      missing: 0, // d has typed text, so nothing is left blank
      absent: 1,
      below: 2, // b (4) and d (6) are under the pass mark of 7
    });
    expect(
      [...studentsMatching(draft, ["a", "b", "c", "d"], THEORY, 7, "below")].sort(),
    ).toEqual(["b", "d"]);
    expect([...studentsMatching(draft, ["a", "b", "c", "d"], THEORY, 7, "absent")]).toEqual([
      "c",
    ]);
  });

  it("counts a whole multi-component student as entered only when every part is", () => {
    const { draft } = setup(jest.fn());
    draft.load(
      {
        maxByComponent: new Map([
          [THEORY, 20],
          [PRACTICAL, 10],
        ]),
        isGradedOnly: false,
        allowNegative: false,
      },
      ["a"],
      [THEORY, PRACTICAL],
      [entry({ studentId: "a" })],
    );
    const components = [
      { id: THEORY, pass: 7 },
      { id: PRACTICAL, pass: 4 },
    ];
    expect(summarizePaper(draft, ["a"], components, PRACTICAL, 0).entered).toBe(0);
    expect(summarizePaper(draft, ["a"], components, PRACTICAL, 0).missing).toBe(1);
  });

  it("reports one status line: saving, failed and typing, and their total", async () => {
    const save = jest
      .fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockRejectedValueOnce(new Error("nope"));
    const { draft } = setup(save);
    draft.load(
      {
        maxByComponent: new Map([[THEORY, 20]]),
        isGradedOnly: false,
        allowNegative: false,
      },
      ["a", "b", "c"],
      [THEORY],
      [],
    );
    expect(draft.status()).toEqual({ saving: 0, failed: 0, typing: 0, total: 0 });
    draft.setText("a", THEORY, "5");
    draft.commit("a", THEORY); // in flight
    draft.setText("b", THEORY, "6");
    draft.commit("b", THEORY);
    await flush(); // b fails
    draft.setText("c", THEORY, "7"); // typed only
    expect(draft.status()).toEqual({ saving: 1, failed: 1, typing: 1, total: 3 });
  });

  it("notifies a cell's own listeners without waking the whole list on a keystroke", () => {
    const { draft } = setup(jest.fn());
    draft.sync([entry()]);
    const cellListener = jest.fn();
    const globalListener = jest.fn();
    draft.subscribeCell(`${STUDENT}:${THEORY}`, cellListener);
    draft.subscribe(globalListener);

    draft.setText(STUDENT, THEORY, "1");
    // clean → dirty is structural (the unsaved guard and counts care)
    expect(globalListener).toHaveBeenCalledTimes(1);
    draft.setText(STUDENT, THEORY, "16");
    // dirty → dirty is only that row's business
    expect(globalListener).toHaveBeenCalledTimes(1);
    expect(cellListener).toHaveBeenCalledTimes(2);
  });
});

describe("PaperDraft review (7B)", () => {
  const RULES = {
    maxByComponent: new Map([
      [THEORY, 20],
      [PRACTICAL, 10],
    ]),
    isGradedOnly: false,
    allowNegative: false,
  };

  function loaded(entries: ServerEntry[], students = ["a", "b", "c"], components = [THEORY]) {
    const { draft } = setup(jest.fn());
    draft.load(RULES, students, components, entries);
    return draft;
  }

  it("never flags the first load, flags a value that later moves, and acknowledge clears it", () => {
    const draft = loaded([entry({ studentId: "a" })]);
    expect(draft.get(`a:${THEORY}`)?.remoteChange).toBe(false);

    draft.sync([
      entry({ studentId: "a", marksObtained: "18.00", updatedAt: "2026-04-06T11:00:00.000Z" }),
    ]);
    const cell = draft.get(`a:${THEORY}`);
    expect(cell?.text).toBe("18");
    expect(cell?.remoteChange).toBe(true);

    draft.acknowledge("a", THEORY);
    expect(draft.get(`a:${THEORY}`)?.remoteChange).toBe(false);
  });

  it("does not flag a newer row with the same value, or a plain verification", () => {
    const draft = loaded([entry({ studentId: "a" })]);
    draft.sync([entry({ studentId: "a", updatedAt: "2026-04-06T11:00:00.000Z" })]);
    expect(draft.get(`a:${THEORY}`)?.remoteChange).toBe(false);
    draft.sync([
      entry({ studentId: "a", resultStatus: "verified", updatedAt: "2026-04-06T12:00:00.000Z" }),
    ]);
    expect(draft.get(`a:${THEORY}`)?.remoteChange).toBe(false);
    expect(draft.get(`a:${THEORY}`)?.base.status).toBe("verified");
  });

  it("flags a mark that appears on a blank cell after the screen showed it blank", () => {
    const draft = loaded([]);
    draft.sync([entry({ studentId: "b", updatedAt: "2026-04-06T11:00:00.000Z" })]);
    expect(draft.get(`b:${THEORY}`)?.remoteChange).toBe(true);
  });

  it("acknowledgeAll clears every flag", () => {
    const draft = loaded([entry({ studentId: "a" }), entry({ id: "r2", studentId: "b" })]);
    draft.sync([
      entry({ studentId: "a", marksObtained: "1.00", updatedAt: "2026-04-06T11:00:00.000Z" }),
      entry({ id: "r2", studentId: "b", marksObtained: "2.00", updatedAt: "2026-04-06T11:00:00.000Z" }),
    ]);
    expect(draft.all().filter((c) => c.remoteChange)).toHaveLength(2);
    draft.acknowledgeAll();
    expect(draft.all().filter((c) => c.remoteChange)).toHaveLength(0);
  });

  const mixed = () =>
    loaded(
      [
        entry({ id: "r1", studentId: "a", resultStatus: "verified" }),
        entry({ id: "r2", studentId: "b", resultStatus: "entered" }),
        entry({ id: "r3", studentId: "c", resultStatus: "entered", marksObtained: null, isAbsent: true }),
        entry({ id: "r4", studentId: "d", resultStatus: "draft", marksObtained: null }),
      ],
      ["a", "b", "c", "d", "e"],
    );

  it("summarises review counts in cells and in students", () => {
    const draft = mixed();
    const summary = reviewSummary(draft, ["a", "b", "c", "d", "e"], [THEORY], 0);
    expect(summary).toEqual({
      cells: 5,
      verified: 1,
      toVerify: 2,
      missing: 2, // d (a draft row) and e (no row at all)
      changed: 0,
      students: 5,
      studentsToVerify: 2,
      studentsVerified: 1,
      studentsMissing: 2,
      studentsAbsent: 1,
    });
  });

  it("selects students for each review chip", () => {
    const draft = mixed();
    const ids = ["a", "b", "c", "d", "e"];
    const pick = (f: "toVerify" | "verified" | "missing" | "absent") =>
      [...studentsMatchingReview(draft, ids, [THEORY], f)].sort();
    expect(pick("toVerify")).toEqual(["b", "c"]);
    expect(pick("verified")).toEqual(["a"]);
    expect(pick("missing")).toEqual(["d", "e"]);
    expect(pick("absent")).toEqual(["c"]);
  });

  it("builds the verify batch from the server's entered rows only", () => {
    const draft = mixed();
    const batch = verifyBatch(draft, ["a", "b", "c", "d", "e"], [THEORY]);
    expect(batch.items.map((i) => i.rowId).sort()).toEqual(["r2", "r3"]);
    expect(batch.students).toBe(2);
    expect(batch.missingStudents).toBe(2);
    expect(batch.changedEntries).toBe(0);
    expect(batch.items[0]).toMatchObject({ updatedAt: "2026-04-06T10:00:00.123Z" });
  });

  it("holds back a changed row and a row with typed-but-unsaved work", () => {
    const draft = mixed();
    draft.sync([
      entry({ id: "r2", studentId: "b", resultStatus: "entered", marksObtained: "3.00", updatedAt: "2026-04-06T11:00:00.000Z" }),
    ]);
    draft.setText("c", THEORY, "9"); // typed over an entered, absent row
    const batch = verifyBatch(draft, ["a", "b", "c"], [THEORY]);
    expect(batch.items).toHaveLength(0);
    expect(batch.changedEntries).toBe(1);
  });

  it("counts a multi-component student as missing when any part has no mark", () => {
    const draft = loaded(
      [entry({ id: "r1", studentId: "a", componentId: THEORY, resultStatus: "entered" })],
      ["a"],
      [THEORY, PRACTICAL],
    );
    const batch = verifyBatch(draft, ["a"], [THEORY, PRACTICAL]);
    expect(batch.items).toHaveLength(1);
    expect(batch.missingStudents).toBe(1);
    expect(reviewSummary(draft, ["a"], [THEORY, PRACTICAL], 0)).toMatchObject({
      cells: 2,
      toVerify: 1,
      missing: 1,
      studentsToVerify: 1,
      studentsVerified: 0,
    });
  });

  it("finds rows whose value moved, status changed or vanished since the batch was built", () => {
    const draft = mixed();
    const batch = verifyBatch(draft, ["b", "c"], [THEORY]);
    const fresh: ServerEntry[] = [
      entry({ id: "r2", studentId: "b", resultStatus: "entered", updatedAt: "2026-04-06T10:00:00.123Z" }),
      entry({ id: "r3", studentId: "c", resultStatus: "verified", updatedAt: "2026-04-06T10:00:00.123Z" }),
    ];
    expect(staleItems(batch.items, fresh)).toEqual([`c:${THEORY}`]);
    expect(
      staleItems(batch.items, [
        entry({ id: "r2", studentId: "b", updatedAt: "2026-04-06T11:00:00.000Z" }),
      ]).sort(),
    ).toEqual([`b:${THEORY}`, `c:${THEORY}`]);
  });

  it("lists a student's verified cells for a reopen", () => {
    const draft = mixed();
    expect(reopenItems(draft, ["a", "b"], [THEORY]).map((i) => i.rowId)).toEqual(["r1"]);
  });

  it("merges a verify response into the cells without flagging them", () => {
    const draft = mixed();
    draft.sync([
      entry({ id: "r2", studentId: "b", resultStatus: "verified", updatedAt: "2026-04-06T12:00:00.000Z" }),
    ]);
    const cell = draft.get(`b:${THEORY}`);
    expect(cell?.base.status).toBe("verified");
    expect(cell?.remoteChange).toBe(false);
    // verified cells can no longer be typed into
    draft.setText("b", THEORY, "19");
    expect(draft.get(`b:${THEORY}`)?.text).toBe("15");
  });
});
