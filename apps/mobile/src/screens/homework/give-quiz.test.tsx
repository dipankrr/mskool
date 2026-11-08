import { render, screen } from "@testing-library/react-native";

import { emptyQuestionDraft } from "../../lib/homework-questions";
import { QuizWorkStep } from "./give-quiz";

jest.mock("./bank-picker-sheet", () => ({ HomeworkBankPickerSheet: () => null }));
jest.mock("./question-composer", () => ({ QuestionComposerSheet: () => null }));

describe("QuizWorkStep", () => {
  it("lists a saved question with its number, text and marks", async () => {
    const draft = { ...emptyQuestionDraft("mcq_single"), body: "What is 2 + 2?", marks: "2" };
    await render(
      <QuizWorkStep
        subjectId="s"
        subjectName="Maths"
        title="Quick quiz"
        onTitle={() => {}}
        questions={[draft]}
        onQuestions={() => {}}
      />,
    );
    expect(screen.getByText("What is 2 + 2?")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });
});
