import {
  answerKeySummary,
  answerSummary,
  checkQuestionDraft,
  draftFromSnapshot,
  emptyQuestionDraft,
  hasAutomaticKey,
  isAuthorableQuestionType,
  isOptionType,
  isQuestionType,
  isValidAnswerMarks,
  moveItem,
  newOptionKey,
  optionLetter,
  parseAcceptedAnswers,
  snapshotFromBankItem,
  switchQuestionType,
  toSnapshotQuestion,
  totalQuestionMarks,
  trimDecimal,
} from "./homework-questions";import type { QuestionDraft } from "./homework-questions";

function draft(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  const base = emptyQuestionDraft("mcq_single");
  return {
    ...base,
    body: "Which fraction is greater than 3/4?",
    options: [
      { key: newOptionKey(), text: "2/3", isCorrect: false },
      { key: newOptionKey(), text: "4/5", isCorrect: true },
    ],
    ...overrides,
  };
}

describe("question vocabulary", () => {
  it("recognises every wire type and the authorable subset", () => {
    expect(isQuestionType("mcq_single")).toBe(true);
    expect(isQuestionType("file_upload")).toBe(true);
    expect(isQuestionType("essay")).toBe(false);
    expect(isAuthorableQuestionType("match")).toBe(false);
    expect(isAuthorableQuestionType("long_answer")).toBe(true);
    expect(isOptionType("mcq_multi")).toBe(true);
    expect(isOptionType("true_false")).toBe(false);
    expect(hasAutomaticKey("fill_blank")).toBe(true);
    expect(hasAutomaticKey("short_answer")).toBe(false);
  });

  it("starts a choice question with two options and one right answer", () => {
    const base = emptyQuestionDraft("mcq_single");
    expect(base.options).toHaveLength(2);
    expect(base.options.filter((option) => option.isCorrect)).toHaveLength(1);
    expect(base.marks).toBe("1");
    expect(emptyQuestionDraft("short_answer").options).toHaveLength(0);
  });

  it("keeps shared fields when the type changes and re-settles the key", () => {
    const typed = switchQuestionType(
      {
        ...draft({ questionType: "mcq_multi" }),
        options: [
          { key: newOptionKey(), text: "2/3", isCorrect: true },
          { key: newOptionKey(), text: "4/5", isCorrect: true },
        ],
      },
      "mcq_single",
    );
    expect(typed.options.filter((option) => option.isCorrect)).toHaveLength(1);

    const multi = switchQuestionType(typed, "mcq_multi");
    expect(multi.body).toBe(typed.body);
    expect(multi.options).toHaveLength(2);

    const numeric = switchQuestionType(multi, "numeric");
    expect(numeric.options).toHaveLength(2);
    expect(numeric.body).toBe(typed.body);
  });

  it("returns the draft unchanged for the same type", () => {
    const base = draft();
    expect(switchQuestionType(base, "mcq_single")).toBe(base);
  });
});

describe("checkQuestionDraft", () => {
  it("accepts a complete single-choice question", () => {
    expect(checkQuestionDraft(draft()).valid).toBe(true);
  });

  it("requires the body, positive marks, and two filled options", () => {
    const check = checkQuestionDraft({
      ...draft(),
      body: "   ",
      marks: "0",
      options: [{ key: "a", text: "2/3", isCorrect: true }],
    });
    expect(check.valid).toBe(false);
    expect(check.errors.body).toBeDefined();
    expect(check.errors.marks).toBeDefined();
    expect(check.errors.options).toBeDefined();
  });

  it("rejects a malformed or oversized mark string", () => {
    expect(checkQuestionDraft(draft({ marks: "1.234" })).errors.marks).toBeDefined();
    expect(checkQuestionDraft(draft({ marks: "100000" })).errors.marks).toBeDefined();
    expect(checkQuestionDraft(draft({ marks: "-1" })).errors.marks).toBeDefined();
    expect(checkQuestionDraft(draft({ marks: "0.5" })).valid).toBe(true);
  });

  it("rejects blank and duplicated options", () => {
    expect(
      checkQuestionDraft(
        draft({
          options: [
            { key: "a", text: "2/3", isCorrect: true },
            { key: "b", text: "  ", isCorrect: false },
          ],
        }),
      ).errors.options,
    ).toBeDefined();
    expect(
      checkQuestionDraft(
        draft({
          options: [
            { key: "a", text: "2/3", isCorrect: true },
            { key: "b", text: " 2/3 ", isCorrect: false },
          ],
        }),
      ).errors.options,
    ).toBeDefined();
  });

  it("enforces one correct answer for single and at least one for multi", () => {
    const both = [
      { key: "a", text: "2/3", isCorrect: true },
      { key: "b", text: "4/5", isCorrect: true },
    ];
    expect(
      checkQuestionDraft(draft({ options: both })).errors.options,
    ).toBeDefined();
    expect(
      checkQuestionDraft(draft({ questionType: "mcq_multi", options: both }))
        .valid,
    ).toBe(true);
    expect(
      checkQuestionDraft(
        draft({
          questionType: "mcq_multi",
          options: both.map((option) => ({ ...option, isCorrect: false })),
        }),
      ).errors.options,
    ).toBeDefined();
  });

  it("requires a true/false choice", () => {
    expect(
      checkQuestionDraft(
        draft({ questionType: "true_false", trueFalse: "" }),
      ).errors.trueFalse,
    ).toBeDefined();
    expect(
      checkQuestionDraft(
        draft({ questionType: "true_false", trueFalse: "false" }),
      ).valid,
    ).toBe(true);
  });

  it("checks the numeric value and tolerance", () => {
    expect(
      checkQuestionDraft(draft({ questionType: "numeric", numericValue: "" }))
        .errors.numericValue,
    ).toBeDefined();
    expect(
      checkQuestionDraft(
        draft({ questionType: "numeric", numericValue: "nine" }),
      ).errors.numericValue,
    ).toBeDefined();
    expect(
      checkQuestionDraft(
        draft({
          questionType: "numeric",
          numericValue: "-9.8",
          numericTolerance: "0.1",
        }),
      ).valid,
    ).toBe(true);
    expect(
      checkQuestionDraft(
        draft({
          questionType: "numeric",
          numericValue: "9.8",
          numericTolerance: "-0.1",
        }),
      ).errors.numericTolerance,
    ).toBeDefined();
  });

  it("needs at least one accepted answer for fill-in-the-blank", () => {
    expect(
      checkQuestionDraft(
        draft({ questionType: "fill_blank", acceptedAnswers: " \n " }),
      ).errors.acceptedAnswers,
    ).toBeDefined();
    expect(
      checkQuestionDraft(
        draft({
          questionType: "fill_blank",
          acceptedAnswers: "photosynthesis\nPhotosynthesis",
        }),
      ).valid,
    ).toBe(true);
  });

  it("caps the explanation", () => {
    expect(
      checkQuestionDraft(draft({ explanation: "x".repeat(5001) })).errors
        .explanation,
    ).toBeDefined();
  });
});

describe("toSnapshotQuestion", () => {
  it("maps choice options with their order", () => {
    const snapshot = toSnapshotQuestion(
      draft({
        marks: "2.00",
        options: [
          { key: "a", text: "2/3", isCorrect: false },
          { key: "b", text: "4/5", isCorrect: true },
          { key: "c", text: "1/2", isCorrect: false },
        ],
      }),
      3,
      "bank-1",
    );
    expect(snapshot.position).toBe(3);
    expect(snapshot.marks).toBe("2");
    expect(snapshot.sourceQuestionId).toBe("bank-1");
    expect(snapshot.options).toEqual([
      { optionText: "2/3", isCorrect: false, sortOrder: 0 },
      { optionText: "4/5", isCorrect: true, sortOrder: 1 },
      { optionText: "1/2", isCorrect: false, sortOrder: 2 },
    ]);
    expect(snapshot.correctAnswer).toBeUndefined();
  });

  it("maps non-option keys into the stored JSON", () => {
    expect(
      toSnapshotQuestion(
        draft({ questionType: "true_false", trueFalse: "true" }),
        1,
      ).correctAnswer,
    ).toEqual({ value: true });
    expect(
      toSnapshotQuestion(
        draft({
          questionType: "numeric",
          numericValue: "9.8",
          numericTolerance: "0.1",
        }),
        1,
      ).correctAnswer,
    ).toEqual({ value: 9.8, tolerance: 0.1 });
    expect(
      toSnapshotQuestion(
        draft({
          questionType: "fill_blank",
          acceptedAnswers: "photosynthesis\nPhotosynthesis",
          caseSensitive: true,
        }),
        1,
      ).correctAnswer,
    ).toEqual({
      accepted: ["photosynthesis", "Photosynthesis"],
      case_sensitive: true,
    });
  });

  it("omits the key and a blank explanation for manual types", () => {
    const snapshot = toSnapshotQuestion(
      draft({ questionType: "long_answer", explanation: "  " }),
      1,
    );
    expect(snapshot.correctAnswer).toBeUndefined();
    expect(snapshot.explanation).toBeUndefined();
    expect(snapshot.options).toBeUndefined();
  });
});

describe("draftFromSnapshot", () => {
  it("rebuilds every authorable type", () => {
    const choice = draftFromSnapshot({
      questionType: "mcq_multi",
      body: "Pick the prime numbers",
      marks: "3.00",
      explanation: "2 and 3 are prime.",
      options: [
        { id: 1, text: "2", isCorrect: true },
        { id: 2, text: "4", isCorrect: false },
        { id: 3, text: "3", isCorrect: true },
      ],
      correctAnswer: null,
    });
    expect(choice?.questionType).toBe("mcq_multi");
    expect(choice?.marks).toBe("3");
    expect(choice?.options.filter((option) => option.isCorrect)).toHaveLength(2);

    const tf = draftFromSnapshot({
      questionType: "true_false",
      body: "The earth is flat.",
      marks: "1",
      explanation: null,
      options: null,
      correctAnswer: { value: false },
    });
    expect(tf?.trueFalse).toBe("false");

    const numeric = draftFromSnapshot({
      questionType: "numeric",
      body: "Value of g",
      marks: "1",
      explanation: null,
      options: null,
      correctAnswer: { value: 9.8, tolerance: 0.1 },
    });
    expect(numeric?.numericValue).toBe("9.8");
    expect(numeric?.numericTolerance).toBe("0.1");

    const blank = draftFromSnapshot({
      questionType: "fill_blank",
      body: "Gas plants release",
      marks: "1",
      explanation: null,
      options: null,
      correctAnswer: {
        accepted: ["oxygen", "O2"],
        case_sensitive: false,
      },
    });
    expect(blank?.acceptedAnswers).toBe("oxygen\nO2");
  });

  it("refuses a type this build cannot author", () => {
    expect(
      draftFromSnapshot({
        questionType: "match",
        body: "Match the columns",
        marks: "2",
        explanation: null,
        options: null,
        correctAnswer: { pairs: [["A", "2"]] },
      }),
    ).toBeNull();
  });
});

describe("snapshotFromBankItem", () => {
  it("copies a bank row with ordered options and provenance", () => {
    const snapshot = snapshotFromBankItem(
      {
        id: "bank-9",
        questionType: "mcq_single",
        body: "Capital of India?",
        correctAnswer: null,
        explanation: "New Delhi.",
        defaultMarks: "2.00",
        options: [
          { optionText: "Mumbai", isCorrect: false, sortOrder: 2 },
          { optionText: "New Delhi", isCorrect: true, sortOrder: 1 },
        ],
      },
      4,
    );
    expect(snapshot.sourceQuestionId).toBe("bank-9");
    expect(snapshot.position).toBe(4);
    expect(snapshot.marks).toBe("2");
    expect(snapshot.options).toEqual([
      { optionText: "New Delhi", isCorrect: true, sortOrder: 0 },
      { optionText: "Mumbai", isCorrect: false, sortOrder: 1 },
    ]);
  });

  it("keeps an unknown type visible instead of dropping the row", () => {
    const snapshot = snapshotFromBankItem(
      {
        id: "bank-10",
        questionType: "essay",
        body: "Write an essay",
        correctAnswer: null,
        explanation: null,
        defaultMarks: "5",
        options: [],
      },
      1,
    );
    expect(snapshot.questionType).toBe("short_answer");
  });
});

describe("list maths", () => {
  it("moves within bounds and clamps at the edges", () => {
    const rows = ["a", "b", "c"];
    expect(moveItem(rows, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(rows, 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(rows, 0, -1)).toEqual(["a", "b", "c"]);
    expect(rows).toEqual(["a", "b", "c"]);
  });

  it("adds decimal marks without float drift", () => {
    expect(totalQuestionMarks(["0.1", "0.2"])).toBe("0.3");
    expect(totalQuestionMarks(["2.50", "1"])).toBe("3.5");
    expect(totalQuestionMarks([])).toBe("0");
    expect(totalQuestionMarks(["", "x"])).toBe("0");
  });

  it("trims stored decimals and letters options", () => {
    expect(trimDecimal("8.00")).toBe("8");
    expect(trimDecimal("8.50")).toBe("8.5");
    expect(trimDecimal("abc")).toBe("abc");
    expect(optionLetter(0)).toBe("A");
    expect(optionLetter(25)).toBe("Z");
    expect(optionLetter(26)).toBe("#27");
  });

  it("accepts zero answer marks but not more than the question", () => {
    expect(isValidAnswerMarks("0", 5)).toBe(true);
    expect(isValidAnswerMarks("2.5", 5)).toBe(true);
    expect(isValidAnswerMarks("5", 5)).toBe(true);
    expect(isValidAnswerMarks("5.01", 5)).toBe(false);
    expect(isValidAnswerMarks("-1", 5)).toBe(false);
    expect(isValidAnswerMarks("", 5)).toBe(false);
    expect(isValidAnswerMarks("1.234", 5)).toBe(false);
    expect(isValidAnswerMarks("42", null)).toBe(true);
  });
});

describe("answer summaries", () => {
  const options = [
    { id: 1, text: "2/3" },
    { id: 2, text: "4/5" },
    { id: 3, text: "1/2" },
  ];

  it("reads a choice answer by its option text", () => {
    expect(
      answerSummary("mcq_multi", { option_ids: [3, 1] }, options),
    ).toBe("A. 2/3 · C. 1/2");
    expect(answerSummary("mcq_single", { option_ids: [9] }, options)).toBe(
      "Option 9",
    );
    expect(answerSummary("mcq_single", { option_ids: [] }, options)).toBeNull();
  });

  it("reads the other stored shapes", () => {
    expect(answerSummary("true_false", { value: true }, null)).toBe("True");
    expect(answerSummary("true_false", { value: "false" }, null)).toBe("False");
    expect(answerSummary("numeric", { value: 9.8 }, null)).toBe("9.8");
    expect(answerSummary("fill_blank", { text: "New Delhi" }, null)).toBe(
      "New Delhi",
    );
    expect(
      answerSummary("match", { pairs: [["A", "2"], ["B", "1"]] }, null),
    ).toBe("A → 2 · B → 1");
    expect(answerSummary("short_answer", { text: "  Because  " }, null)).toBe(
      "Because",
    );
    expect(answerSummary("long_answer", "Plain string", null)).toBe(
      "Plain string",
    );
  });

  it("returns null for a blank or unreadable answer", () => {
    expect(answerSummary("mcq_single", null, options)).toBeNull();
    expect(answerSummary("short_answer", { text: "  " }, null)).toBeNull();
    expect(answerSummary("numeric", { value: "many" }, null)).toBe("many");
    expect(answerSummary("true_false", { value: "maybe" }, null)).toBeNull();
  });

  it("builds the teacher's key from the snapshot", () => {
    expect(
      answerKeySummary({
        questionType: "mcq_single",
        options: [
          { id: 1, text: "2/3", isCorrect: false },
          { id: 2, text: "4/5", isCorrect: true },
        ],
        correctAnswer: null,
      }),
    ).toBe("B. 4/5");
    expect(
      answerKeySummary({
        questionType: "fill_blank",
        correctAnswer: { accepted: ["Delhi", "New Delhi"] },
      }),
    ).toBe("Delhi, New Delhi");
    expect(
      answerKeySummary({ questionType: "long_answer", correctAnswer: null }),
    ).toBeNull();
  });
});

describe("accepted answers", () => {
  it("splits on newlines, trims and dedupes", () => {
    expect(parseAcceptedAnswers(" Delhi \n\nNew Delhi\nDelhi\n")).toEqual([
      "Delhi",
      "New Delhi",
    ]);
  });
});
