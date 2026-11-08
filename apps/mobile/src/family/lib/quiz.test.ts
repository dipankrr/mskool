import { answerText, isAnswered, quizScore } from "./quiz";

const OPTIONS = [
  { id: 1, text: "Reflected" },
  { id: 2, text: "Blocked" },
];

describe("quiz answers", () => {
  it("knows when a question has an answer", () => {
    expect(isAnswered("mcq_single", { option_ids: [2] })).toBe(true);
    expect(isAnswered("mcq_multi", { option_ids: [] })).toBe(false);
    expect(isAnswered("true_false", { value: false })).toBe(true);
    expect(isAnswered("numeric", { value: null })).toBe(false);
    expect(isAnswered("short_answer", { text: "  " })).toBe(false);
    expect(isAnswered("short_answer", null)).toBe(false);
  });

  it("reads an answer as words", () => {
    expect(answerText("mcq_single", { option_ids: [2] }, OPTIONS)).toBe("B. Blocked");
    expect(answerText("true_false", { value: true }, null, { yes: "Yes", no: "No" })).toBe("Yes");
    expect(answerText("numeric", { value: 42 })).toBe("42");
    expect(answerText("fill_blank", { text: "Sun" })).toBe("Sun");
  });

  it("counts right answers and those waiting for the teacher", () => {
    expect(quizScore({ answers: [{ isCorrect: true }, { isCorrect: false }, { isCorrect: null }] })).toEqual({ right: 1, pending: 1 });
  });
});
