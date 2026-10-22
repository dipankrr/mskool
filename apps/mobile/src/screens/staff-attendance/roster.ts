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
  enrollment: { sectionId: string | null; rollNumber: string | null };
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

export function buildRoster(
  rows: readonly EnrollmentPair[],
  sectionId: string,
): RosterEntry[] {
  const entries = rows
    .filter((pair) => pair.enrollment.sectionId === sectionId)
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
