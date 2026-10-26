import { StudentFeeDeskScreen } from "../../../../screens/fees/student-desk";

/**
 * One student's fee desk. Reached from the dues list, which passes the
 * admission number so the desk can find its matrix row without a
 * studentId-keyed matrix filter.
 */
export default function StudentFeeDeskRoute() {
  return <StudentFeeDeskScreen />;
}
