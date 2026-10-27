import { ExamFormScreen } from "../../../screens/exams/exam-form";

/**
 * The exam form — a static segment, so `/exams/exam-form` wins over
 * `/exams/[examId]` for this literal path. Create when opened bare; edit
 * when opened with an examId param.
 */
export default function ExamFormRoute() {
  return <ExamFormScreen />;
}
