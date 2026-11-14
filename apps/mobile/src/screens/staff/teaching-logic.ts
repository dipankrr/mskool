/**
 * Pure helpers for the Teaching screens and Home's teaching line (ADR-068).
 * No React, no network: unit-tested in teaching-logic.test.ts.
 */

export type MyTeachingRow = {
  role: "class_teacher" | "subject_teacher";
  sectionName: string;
  className: string;
  subjectName: string | null;
};

/** "6-A" from class "Class 6" and section "A"; keeps names that already join. */
export function sectionLabel(className: string, sectionName: string): string {
  const cls = className.replace(/^class\s+/i, "").trim();
  if (!sectionName) return cls;
  if (sectionName.toLowerCase().startsWith(cls.toLowerCase())) return sectionName;
  return `${cls}-${sectionName}`;
}

/**
 * Groups what someone teaches for the welcome card and Home: the class
 * teacher section, then each subject with its sections in order.
 */
export function groupMyTeaching(rows: readonly MyTeachingRow[]) {
  const classTeacherRow = rows.find((row) => row.role === "class_teacher");
  const bySubject = new Map<string, string[]>();
  for (const row of rows) {
    if (row.role !== "subject_teacher" || !row.subjectName) continue;
    const list = bySubject.get(row.subjectName) ?? [];
    const label = sectionLabel(row.className, row.sectionName);
    if (!list.includes(label)) list.push(label);
    bySubject.set(row.subjectName, list);
  }
  const subjects = [...bySubject.entries()].map(([name, sections]) => ({ name, sections }));
  const count = subjects.reduce((n, s) => n + s.sections.length, 0) + (classTeacherRow ? 1 : 0);
  return {
    classTeacher: classTeacherRow
      ? sectionLabel(classTeacherRow.className, classTeacherRow.sectionName)
      : null,
    subjects,
    count,
  };
}

/** Home's one line: "Class teacher of 6-A · Maths in 6-A, 6-B · Science in 8-A". */
export function teachingLine(rows: readonly MyTeachingRow[]): string | null {
  const groups = groupMyTeaching(rows);
  const parts: string[] = [];
  if (groups.classTeacher) parts.push(`Class teacher of ${groups.classTeacher}`);
  for (const subject of groups.subjects) {
    parts.push(`${subject.name} in ${subject.sections.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "38 of 47 filled" → the share as a whole percent (0 when nothing to fill). */
export function filledPercent(filled: number, slots: number): number {
  return slots > 0 ? Math.round((filled / slots) * 100) : 0;
}

/**
 * The exclusive end the server stores for a substitute "until" day
 * (ADR-068): the day after their last day, as YYYY-MM-DD.
 */
export function exclusiveEnd(lastDay: string): string {
  const d = new Date(`${lastDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The last day shown for a stored exclusive end. */
export function lastDayOf(exclusive: string): string {
  const d = new Date(`${exclusive}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
