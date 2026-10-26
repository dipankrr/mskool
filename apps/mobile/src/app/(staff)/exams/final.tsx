import { FinalResultsScreen } from "../../../screens/exams/final-results";

/**
 * The year's final results — a static segment, so it wins over
 * `/exams/[examId]` for the literal path `/exams/final`.
 */
export default function ExamFinalResultsRoute() {
  return <FinalResultsScreen />;
}
