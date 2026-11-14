/**
 * The "By teacher" grid (ADR-068, frame 12) as pure functions: what one
 * teacher holds across the session's sections, and the save plan for the
 * chips someone toggled. Unit-tested in teacher-grid.test.ts.
 */
import { sectionLabel } from "../staff/teaching-logic";

type TeacherRef = { assignmentId: string; staffId: string; name: string };

export type OverviewLike = {
  sections: {
    sectionId: string;
    sectionName: string;
    className: string;
    classTeacher: TeacherRef | null;
    subjects: { subjectId: string; subjectName: string; teachers: TeacherRef[] }[];
  }[];
};

export type GridSection = {
  key: string;
  sectionId: string;
  label: string;
  mine: boolean;
  /** This teacher's assignment, when `mine`. */
  assignmentId: string | null;
  others: string[];
};

export type TeacherGrid = ReturnType<typeof teacherGrid>;

/**
 * Subjects this teacher teaches (plus any picked with "Add a subject"), each
 * with every section whose class takes it, grouped by class in order.
 */
export function teacherGrid(overview: OverviewLike, staffId: string, extraSubjects: string[] = []) {
  const subjectIds = new Set<string>();
  const subjectNames = new Map<string, string>();
  for (const section of overview.sections) {
    for (const subject of section.subjects) {
      subjectNames.set(subject.subjectId, subject.subjectName);
      if (subject.teachers.some((t) => t.staffId === staffId)) subjectIds.add(subject.subjectId);
    }
  }
  // Picked with "Add a subject": after the ones they already teach.
  for (const id of extraSubjects) subjectIds.add(id);

  const subjects = [...subjectIds]
    .filter((id) => subjectNames.has(id))
    .map((subjectId) => {
      const classes: { className: string; sections: GridSection[] }[] = [];
      for (const section of overview.sections) {
        const subject = section.subjects.find((s) => s.subjectId === subjectId);
        if (!subject) continue;
        const mineRow = subject.teachers.find((t) => t.staffId === staffId);
        const cell: GridSection = {
          key: `${subjectId}:${section.sectionId}`,
          sectionId: section.sectionId,
          label: sectionLabel(section.className, section.sectionName),
          mine: Boolean(mineRow),
          assignmentId: mineRow?.assignmentId ?? null,
          others: subject.teachers.filter((t) => t.staffId !== staffId).map((t) => t.name),
        };
        const group = classes.find((c) => c.className === section.className);
        if (group) group.sections.push(cell);
        else classes.push({ className: section.className, sections: [cell] });
      }
      return { subjectId, subjectName: subjectNames.get(subjectId)!, classes };
    });

  const ctSection = overview.sections.find((s) => s.classTeacher?.staffId === staffId) ?? null;
  const cells = subjects.flatMap((s) => s.classes.flatMap((c) => c.sections)).filter((c) => c.mine);
  return {
    subjects,
    otherSubjects: [...subjectNames.entries()]
      .filter(([id]) => !subjectIds.has(id))
      .map(([subjectId, subjectName]) => ({ subjectId, subjectName }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    sections: overview.sections.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      className: s.className,
      classTeacherName: s.classTeacher?.name ?? null,
    })),
    classTeacherOf: ctSection
      ? {
          sectionId: ctSection.sectionId,
          sectionName: ctSection.sectionName,
          className: ctSection.className,
          assignmentId: ctSection.classTeacher!.assignmentId,
        }
      : null,
    slotCount: cells.length + (ctSection ? 1 : 0),
    sectionCount: new Set([...cells.map((c) => c.sectionId), ...(ctSection ? [ctSection.sectionId] : [])]).size,
  };
}

/**
 * The save plan: toggled chips that were off become new subject rows; ones
 * that were on end their row. `ctChoice` undefined leaves the class teacher
 * alone, null removes it, a section id moves it there.
 */
export function planTeacherChanges(
  grid: TeacherGrid,
  toggled: ReadonlySet<string>,
  ctChoice: string | null | undefined,
) {
  const add: { sectionId: string; role: "class_teacher" | "subject_teacher"; subjectId: string | null }[] = [];
  const end: string[] = [];
  for (const subject of grid.subjects) {
    for (const cls of subject.classes) {
      for (const cell of cls.sections) {
        if (!toggled.has(cell.key)) continue;
        if (cell.mine && cell.assignmentId) end.push(cell.assignmentId);
        else if (!cell.mine) add.push({ sectionId: cell.sectionId, role: "subject_teacher", subjectId: subject.subjectId });
      }
    }
  }
  const current = grid.classTeacherOf;
  if (ctChoice !== undefined && ctChoice !== (current?.sectionId ?? null)) {
    if (current) end.push(current.assignmentId);
    if (ctChoice) add.push({ sectionId: ctChoice, role: "class_teacher", subjectId: null });
  }
  return { add, end };
}
