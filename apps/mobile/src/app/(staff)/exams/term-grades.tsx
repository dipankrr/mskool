import { TermGradesScreen } from "../../../screens/exams/term-grades";

/**
 * Term grades — the term_grade pipeline's entry screen. A static segment, so
 * it wins over `/exams/[examId]` for the literal path `/exams/term-grades`.
 */
export default function ExamTermGradesRoute() {
  return <TermGradesScreen />;
}
