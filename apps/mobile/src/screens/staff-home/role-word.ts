/**
 * The role word a class card may wear ("Class teacher"), derived only when it
 * can be said truthfully.
 *
 * Two sources, in order:
 *
 * 1. The section's open teacher assignments — exact, but readable only with
 *    `teacher_assignment:read`. `class_teacher` does not hold that permission;
 *    `subject_teacher` does. When rows are available they are authoritative:
 *    no matching class_teacher row means NO word, even if the role union says
 *    otherwise.
 *
 * 2. Without readable rows, the org role union still proves the common case:
 *    roleTypes includes `class_teacher` and exactly one section is visible —
 *    the section the class-teacher scope points at. With more visible
 *    sections the union cannot say which one is owned, so no card wears the
 *    word (an honest blank beats a wrong label).
 */

/** The fields this decision reads from `teacherAssignment.list` rows. */
export type TeacherAssignmentRow = {
  userId: string;
  role: string;
  effectiveTo: string | null;
};

export function deriveRoleWord(input: {
  /** undefined = not readable (or not yet settled); [] = readable, none open. */
  assignmentRows: readonly TeacherAssignmentRow[] | undefined;
  userId: string;
  roleTypes: readonly string[];
  sectionCount: number;
}): "class_teacher" | null {
  const rows = input.assignmentRows;
  if (rows) {
    const owns = rows.some(
      (row) =>
        row.role === "class_teacher" &&
        row.userId === input.userId &&
        row.effectiveTo === null,
    );
    return owns ? "class_teacher" : null;
  }

  if (input.roleTypes.includes("class_teacher") && input.sectionCount === 1) {
    return "class_teacher";
  }
  return null;
}
