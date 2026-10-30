import { FinalResultsScreen } from "../../../screens/exams/annual/final";

/**
 * The year's final results (7G): one row per class. A static segment, so it
 * wins over `/exams/[examId]` for the literal path `/exams/final`.
 */
export default function ExamFinalResultsRoute() {
  return <FinalResultsScreen />;
}
