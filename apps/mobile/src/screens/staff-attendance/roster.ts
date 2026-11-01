/**
 * The section roster — the one shape both the marking panel and the summary
 * panel read: student id, display name, roll. Extracted from the marking
 * screen when the summary panel became its second consumer; the order rule is
 * the web page's ported in chunk 1: numbered rolls keep numeric order,
 * un-numbered admissions sort after them by name.
 *
 * Structurally typed on purpose: the tRPC enrollment rows satisfy it, and unit
 * tests can build plain objects without a router type import.
 */

export type EnrollmentPair = {
  enrollment: {
    sectionId: string | null;
    rollNumber: string | null;
    enrollmentStatus?: string;
    leftOn?: string | null;
  };
  student: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
  };
};

export type RosterEntry = {
  studentId: string;
  name: string;
  roll: string | null;
};

/**
 * Who was at the school on this date. Someone who left stays on earlier days, so
 * a past day can still be corrected; a row with no date of leaving hasn't left.
 */
function onRollOn(enrollment: EnrollmentPair["enrollment"], date: string): boolean {
  const { enrollmentStatus: status, leftOn } = enrollment;
  if (status === "studying" || status === "completed" || status === undefined) return true;
  return Boolean(leftOn && leftOn > date);
}

export function buildRoster(
  rows: readonly EnrollmentPair[],
  sectionId: string,
  /** Omit for everyone who has been in the section, such as a month's summary. */
  date?: string,
): RosterEntry[] {
  const entries = rows
    .filter(
      (pair) =>
        pair.enrollment.sectionId === sectionId &&
        (date === undefined || onRollOn(pair.enrollment, date)),
    )
    .map((pair) => ({
      studentId: pair.student.id,
      name: [pair.student.firstName, pair.student.middleName, pair.student.lastName]
        .filter(Boolean)
        .join(" "),
      roll: pair.enrollment.rollNumber,
    }));

  entries.sort((a, b) => {
    if (a.roll === null && b.roll === null) return a.name.localeCompare(b.name);
    if (a.roll === null) return 1;
    if (b.roll === null) return -1;
    return a.roll.localeCompare(b.roll, undefined, { numeric: true });
  });

  return entries;
}
