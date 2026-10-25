import {
  blankHomeworkForm,
  checkHomeworkForm,
  createPayload,
  formFromDetail,
  isHomeworkFormDirty,
  MAX_TITLE,
  updatePayload,
  updatePayloadIsEmpty,
} from "./form-logic";
import type { HomeworkFormState } from "./form-logic";
import { composeTimestamp } from "../../lib/homework";
import type { HomeworkDetail } from "./types";

/**
 * The form's contract with the API, pinned. These tests exist because the
 * create and edit paths differ in ways that are invisible on screen: what may
 * be omitted, what must be preserved, and which fields the update contract
 * silently refuses.
 */

function validForm(): HomeworkFormState {
  return {
    ...blankHomeworkForm("2026-10-25"),
    sectionId: "section-1",
    subjectId: "subject-1",
    title: "Fractions worksheet 3",
  };
}

function detail(overrides: Partial<HomeworkDetail> = {}): HomeworkDetail {
  const dueAt = new Date(2026, 9, 26, 8, 0);
  const closeAt = new Date(2026, 9, 28, 8, 0);
  const base = {
    id: "assignment-1",
    targets: [{ targetType: "section", sectionId: "section-1" }],
    subjectId: "subject-1",
    kind: "homework",
    title: "Fractions worksheet 3",
    description: "Do sums 1 to 10.",
    topic: null,
    estimatedMinutes: 30,
    dueAt: dueAt.toISOString(),
    closeAt: closeAt.toISOString(),
    latePolicy: "allowed",
    allowResubmission: true,
    maxSubmissions: null,
    submissionTypes: ["offline"],
    gradingMode: "completion",
    maxMarks: null,
  };
  return { ...base, ...overrides } as unknown as HomeworkDetail;
}

describe("blankHomeworkForm", () => {
  it("starts on tomorrow at 08:00 with the everyday classroom defaults", () => {
    const form = blankHomeworkForm("2026-10-25");
    expect(form.dueDay).toBe("2026-10-26");
    expect(form.dueTime).toBe("08:00");
    expect(form.kind).toBe("homework");
    expect(form.gradingMode).toBe("completion");
    expect(form.submissions).toEqual(["offline"]);
    expect(form.late).toBe("default");
    expect(form.allowResubmission).toBe(true);
    expect(form.maxSubmissions).toBe("");
  });
});

describe("checkHomeworkForm", () => {
  it("asks for a class, a subject and a title", () => {
    const check = checkHomeworkForm(blankHomeworkForm("2026-10-25"), "create");
    expect(check.valid).toBe(false);
    expect(check.errors.sectionId).toBeTruthy();
    expect(check.errors.subjectId).toBeTruthy();
    expect(check.errors.title).toBeTruthy();
    expect(check.dueAt).not.toBeNull();
  });

  it("accepts the minimum complete form", () => {
    const check = checkHomeworkForm(validForm(), "create");
    expect(check.errors).toEqual({});
    expect(check.valid).toBe(true);
  });

  it("rejects a title over the contract limit and a blank submission set", () => {
    const form: HomeworkFormState = {
      ...validForm(),
      title: "x".repeat(MAX_TITLE + 1),
      submissions: [],
    };
    const check = checkHomeworkForm(form, "create");
    expect(check.errors.title).toBeTruthy();
    expect(check.errors.submissions).toBeTruthy();
  });

  it("keeps half a due time invalid", () => {
    const check = checkHomeworkForm(
      { ...validForm(), dueTime: null },
      "create",
    );
    expect(check.errors.due).toBeTruthy();
    expect(check.dueAt).toBeNull();
  });

  it("warns, but does not block, when the due moment has passed", () => {
    const now = new Date(2026, 9, 27, 12, 0);
    const check = checkHomeworkForm(
      { ...validForm(), dueDay: "2026-10-26", dueTime: "08:00" },
      "create",
      now,
    );
    expect(check.valid).toBe(true);
    expect(check.pastDue).toBe(true);
  });

  it("requires marks when grading by marks, and only then", () => {
    const missing = checkHomeworkForm(
      { ...validForm(), gradingMode: "marks", maxMarks: "" },
      "create",
    );
    expect(missing.errors.maxMarks).toBeTruthy();

    const graded = checkHomeworkForm(
      { ...validForm(), gradingMode: "marks", maxMarks: "25" },
      "create",
    );
    expect(graded.errors.maxMarks).toBeUndefined();
    expect(graded.maxMarks).toBe("25");

    const completion = checkHomeworkForm(
      { ...validForm(), gradingMode: "completion", maxMarks: "" },
      "create",
    );
    expect(completion.errors.maxMarks).toBeUndefined();
    expect(completion.maxMarks).toBeNull();
  });

  it("bounds the estimate and the attempt count", () => {
    const form = { ...validForm(), estimated: "601", maxSubmissions: "11" };
    const check = checkHomeworkForm(form, "create");
    expect(check.errors.estimated).toBeTruthy();
    expect(check.errors.maxSubmissions).toBeTruthy();
  });

  it("treats a blank estimate as unchanged on edit but absent on create", () => {
    const create = checkHomeworkForm(
      { ...validForm(), estimated: "" },
      "create",
    );
    expect(create.estimatedMinutes).toBeNull();

    const edit = checkHomeworkForm(
      { ...formFromDetail(detail()), estimated: "" },
      "edit",
    );
    expect(edit.estimatedMinutes).toBeNull();
  });
});

describe("createPayload", () => {
  it("omits what the teacher left alone", () => {
    const form = validForm();
    const check = checkHomeworkForm(form, "create");
    const payload = createPayload(form, check, "year-1");

    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      academicYearId: "year-1",
      sectionId: "section-1",
      subjectId: "subject-1",
      kind: "homework",
      title: "Fractions worksheet 3",
      submissionTypes: ["offline"],
      gradingMode: "completion",
      allowResubmission: true,
      dueAt: composeTimestamp("2026-10-26", "08:00"),
    });
    // The school resolves the late window for us.
    expect(payload).not.toHaveProperty("latePolicy");
    expect(payload).not.toHaveProperty("closeAt");
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("topic");
    expect(payload).not.toHaveProperty("estimatedMinutes");
    expect(payload).not.toHaveProperty("maxMarks");
    expect(payload).not.toHaveProperty("maxSubmissions");
  });

  it("sends an explicit late choice and marks", () => {
    const form: HomeworkFormState = {
      ...validForm(),
      late: "not_allowed",
      gradingMode: "marks",
      maxMarks: "20",
      submissions: ["offline", "text"],
    };
    const check = checkHomeworkForm(form, "create");
    const payload = createPayload(form, check, "year-1");
    expect(payload).toMatchObject({
      latePolicy: "not_allowed",
      gradingMode: "marks",
      maxMarks: "20",
      submissionTypes: ["offline", "text"],
    });
  });

  it("refuses to build a payload from an invalid form", () => {
    const form = { ...validForm(), title: "" };
    const check = checkHomeworkForm(form, "create");
    expect(createPayload(form, check, "year-1")).toBeNull();
  });
});

describe("updatePayload", () => {
  it("sends nothing but the identity of an untouched draft", () => {
    const row = detail();
    const form = formFromDetail(row);
    const check = checkHomeworkForm(form, "edit");
    const payload = updatePayload(form, check, row);

    expect(payload).not.toBeNull();
    expect(updatePayloadIsEmpty(payload!)).toBe(true);
  });

  it("sends only the fields the teacher changed", () => {
    const row = detail();
    const form = { ...formFromDetail(row), title: "Fractions worksheet 4" };
    const check = checkHomeworkForm(form, "edit");
    const payload = updatePayload(form, check, row);

    expect(payload).toMatchObject({
      id: "assignment-1",
      sectionId: "section-1",
      subjectId: "subject-1",
      title: "Fractions worksheet 4",
    });
    expect(payload).not.toHaveProperty("dueAt");
    expect(payload).not.toHaveProperty("closeAt");
    expect(payload).not.toHaveProperty("submissionTypes");
  });

  it("preserves the existing late window when the due moment moves", () => {
    const row = detail();
    const form = { ...formFromDetail(row), dueDay: "2026-10-27" };
    const check = checkHomeworkForm(form, "edit");
    const payload = updatePayload(form, check, row);

    const nextDue = composeTimestamp("2026-10-27", "08:00");
    expect(nextDue).not.toBeNull();
    expect(payload?.dueAt).toBe(nextDue);
    // The row's window was 48 hours; the new close moment keeps all of it.
    expect(
      new Date(payload!.closeAt!).getTime() - new Date(nextDue!).getTime(),
    ).toBe(48 * 60 * 60 * 1000);
  });

  it("keeps a no-late-work row closing on its new due moment", () => {
    const dueAt = new Date(2026, 9, 26, 8, 0);
    const row = detail({
      latePolicy: "not_allowed",
      closeAt: dueAt.toISOString(),
    });
    const form = { ...formFromDetail(row), dueDay: "2026-10-27" };
    const check = checkHomeworkForm(form, "edit");
    const payload = updatePayload(form, check, row);

    expect(payload?.dueAt).toBe(composeTimestamp("2026-10-27", "08:00"));
    expect(payload?.closeAt).toBe(payload?.dueAt);
  });

  it("never tries to update a cleared estimate", () => {
    const row = detail();
    const form = { ...formFromDetail(row), estimated: "" };
    const check = checkHomeworkForm(form, "edit");
    const payload = updatePayload(form, check, row);

    expect(payload).not.toHaveProperty("estimatedMinutes");
  });

  it("nulls the attempt cap only when the teacher removed it", () => {
    const row = detail({ maxSubmissions: 3 });
    const form = { ...formFromDetail(row), maxSubmissions: "" };
    const check = checkHomeworkForm(form, "edit");
    const payload = updatePayload(form, check, row);

    expect(payload?.maxSubmissions).toBeNull();
  });
});

describe("isHomeworkFormDirty", () => {
  it("ignores submission order, which carries no meaning", () => {
    const initial: HomeworkFormState = {
      ...validForm(),
      submissions: ["offline", "text"],
    };
    const state: HomeworkFormState = {
      ...initial,
      submissions: ["text", "offline"],
    };
    expect(isHomeworkFormDirty(state, initial)).toBe(false);
  });

  it("notices text, date and policy changes", () => {
    const initial = validForm();
    expect(isHomeworkFormDirty({ ...initial, title: `${initial.title} ` }, initial)).toBe(
      true,
    );
    expect(isHomeworkFormDirty({ ...initial, dueTime: "09:00" }, initial)).toBe(
      true,
    );
    expect(
      isHomeworkFormDirty({ ...initial, late: "allowed" }, initial),
    ).toBe(true);
    expect(
      isHomeworkFormDirty(
        { ...initial, submissions: ["offline", "text"] },
        initial,
      ),
    ).toBe(true);
  });

  it("is false for an identical edit state", () => {
    const row = detail();
    const form = formFromDetail(row);
    expect(isHomeworkFormDirty(form, formFromDetail(row))).toBe(false);
  });
});
