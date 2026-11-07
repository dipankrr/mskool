import { db } from "@repo/db";
import {
  examClassPublication,
  examComponents,
  examSubjectSchedules,
  exams,
  subjects,
  terms,
} from "@repo/db/schema";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { todayInIst } from "./enrollment-status";
import { resolvePortalChild, type PortalChild } from "./portal-child";
import { refuse } from "./service-error";

/**
 * The family date sheet (ADR-062): `portalExam.schedule.list` / `.detail`.
 *
 * - Exams from `scheduled` onward; a draft is never shown (owner E2: an exam
 *   moved back to draft simply disappears). Mock and class tests are shown
 *   (owner E1).
 * - The child's papers follow ADR-052: a section paper is for that section,
 *   a class-wide paper is for the whole class (sectionless students too).
 *   Should both exist for one subject, the section paper wins.
 * - Hidden: eligibility, pass marks, weightages, whether the exam counts
 *   toward the term, verification and entry progress. No marks here: results
 *   reach families only through published cards (hard rule 8).
 */

export type PortalExamState = "upcoming" | "ongoing" | "marks_being_checked" | "results_out";

type PaperRow = {
  scheduleId: string;
  examId: string;
  sectionId: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  examDate: string;
  startTime: string;
  durationMinutes: number;
  venue: string | null;
};

const CHECKING = new Set(["marks_entry", "under_verification", "published", "locked"]);

function familyState(
  status: string,
  published: boolean,
  firstDate: string | null,
  lastDate: string | null,
  today: string,
): PortalExamState {
  if (published) return "results_out";
  if (CHECKING.has(status)) return "marks_being_checked";
  if (status === "ongoing") return "ongoing";
  if (!firstDate || today < firstDate) return "upcoming";
  if (lastDate && today > lastDate) return "marks_being_checked";
  return "ongoing";
}

/** One paper per subject: the child's section paper over a class-wide one. */
function childPapers(rows: PaperRow[]): PaperRow[] {
  const bySubject = new Map<string, PaperRow>();
  for (const row of rows) {
    const held = bySubject.get(`${row.examId}:${row.subjectId}`);
    if (!held || (held.sectionId == null && row.sectionId != null)) {
      bySubject.set(`${row.examId}:${row.subjectId}`, row);
    }
  }
  return [...bySubject.values()].sort(
    (a, b) => a.examDate.localeCompare(b.examDate) || a.startTime.localeCompare(b.startTime),
  );
}

async function loadPapers(child: PortalChild, examIds?: string[]) {
  const rows = await db
    .select({
      scheduleId: examSubjectSchedules.id,
      examId: examSubjectSchedules.examId,
      sectionId: examSubjectSchedules.sectionId,
      subjectId: examSubjectSchedules.subjectId,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      examDate: examSubjectSchedules.examDate,
      startTime: examSubjectSchedules.startTime,
      durationMinutes: examSubjectSchedules.durationMinutes,
      venue: examSubjectSchedules.venue,
    })
    .from(examSubjectSchedules)
    .innerJoin(exams, eq(exams.id, examSubjectSchedules.examId))
    .innerJoin(subjects, eq(subjects.id, examSubjectSchedules.subjectId))
    .where(
      and(
        eq(examSubjectSchedules.schoolId, child.schoolId),
        eq(examSubjectSchedules.classId, child.classId),
        child.sectionId
          ? or(
              isNull(examSubjectSchedules.sectionId),
              eq(examSubjectSchedules.sectionId, child.sectionId),
            )
          : isNull(examSubjectSchedules.sectionId),
        eq(exams.schoolId, child.schoolId),
        eq(exams.academicYearId, child.academicYearId),
        ne(exams.status, "draft"),
        examIds ? inArray(exams.id, examIds) : undefined,
      ),
    );
  return childPapers(rows);
}

async function loadExams(child: PortalChild, examIds: string[]) {
  if (examIds.length === 0) return [];
  return db
    .select({
      id: exams.id,
      name: exams.name,
      examType: exams.examType,
      status: exams.status,
      termId: exams.termId,
      termName: terms.name,
      published: examClassPublication.id,
    })
    .from(exams)
    .leftJoin(terms, eq(terms.id, exams.termId))
    .leftJoin(
      examClassPublication,
      and(
        eq(examClassPublication.examId, exams.id),
        eq(examClassPublication.classId, child.classId),
      ),
    )
    .where(and(eq(exams.schoolId, child.schoolId), inArray(exams.id, examIds)));
}

function datesOf(papers: PaperRow[]) {
  return {
    firstDate: papers[0]?.examDate ?? null,
    lastDate: papers[papers.length - 1]?.examDate ?? null,
  };
}

class PortalExamScheduleService {
  async list(
    ownedStudentIds: readonly string[],
    input: { studentId: string; academicYearId?: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const today = todayInIst();
    const papers = await loadPapers(child);
    const papersByExam = new Map<string, PaperRow[]>();
    for (const paper of papers) {
      const list = papersByExam.get(paper.examId) ?? [];
      list.push(paper);
      papersByExam.set(paper.examId, list);
    }
    const examRows = await loadExams(child, [...papersByExam.keys()]);

    return examRows
      .map((exam) => {
        const own = papersByExam.get(exam.id) ?? [];
        const { firstDate, lastDate } = datesOf(own);
        return {
          id: exam.id,
          name: exam.name,
          examType: exam.examType,
          term: exam.termId ? { id: exam.termId, name: exam.termName ?? "" } : null,
          firstDate,
          lastDate,
          paperCount: own.length,
          state: familyState(exam.status, exam.published != null, firstDate, lastDate, today),
        };
      })
      .sort((a, b) => (a.firstDate ?? "").localeCompare(b.firstDate ?? "") || a.name.localeCompare(b.name));
  }

  async detail(
    ownedStudentIds: readonly string[],
    input: { studentId: string; examId: string; academicYearId?: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const today = todayInIst();
    const papers = await loadPapers(child, [input.examId]);
    const [exam] = await loadExams(child, papers.length ? [input.examId] : []);
    // A draft, another school's exam, or one with no paper for this child.
    if (!exam) throw refuse("NOT_FOUND", "Exam not found.");

    const parts = await db
      .select({
        scheduleId: examComponents.scheduleId,
        name: examComponents.name,
        maxMarks: examComponents.maxMarks,
      })
      .from(examComponents)
      .where(
        and(
          eq(examComponents.schoolId, child.schoolId),
          inArray(
            examComponents.scheduleId,
            papers.map((p) => p.scheduleId),
          ),
        ),
      )
      .orderBy(asc(examComponents.sequenceNumber), asc(examComponents.name));
    const partsBySchedule = new Map<string, { name: string; maxMarks: string }[]>();
    for (const part of parts) {
      const list = partsBySchedule.get(part.scheduleId) ?? [];
      list.push({ name: part.name, maxMarks: part.maxMarks });
      partsBySchedule.set(part.scheduleId, list);
    }

    const { firstDate, lastDate } = datesOf(papers);
    return {
      id: exam.id,
      name: exam.name,
      examType: exam.examType,
      term: exam.termId ? { id: exam.termId, name: exam.termName ?? "" } : null,
      firstDate,
      lastDate,
      state: familyState(exam.status, exam.published != null, firstDate, lastDate, today),
      papers: papers.map((p) => {
        const own = partsBySchedule.get(p.scheduleId) ?? [];
        const total = own.reduce((sum, part) => sum + Math.round(Number(part.maxMarks) * 100), 0);
        return {
          subjectName: p.subjectName,
          subjectCode: p.subjectCode,
          examDate: p.examDate,
          startTime: p.startTime.slice(0, 5),
          durationMinutes: p.durationMinutes,
          venue: p.venue,
          parts: own,
          maxMarks: own.length ? (total / 100).toFixed(2) : null,
        };
      }),
    };
  }
}

export const portalExamScheduleService = new PortalExamScheduleService();
