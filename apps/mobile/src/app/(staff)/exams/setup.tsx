import { GradingHubScreen } from "../../../screens/exams/grading/hub";

/**
 * Grading setup (7F) — the hub behind the Exams list's "Grading setup" row.
 * A static segment, so it wins over `/exams/[examId]` for this literal path.
 */
export default function ExamGradingHubRoute() {
  return <GradingHubScreen />;
}
