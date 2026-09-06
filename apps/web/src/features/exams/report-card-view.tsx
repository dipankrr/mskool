"use client";

import { useMemo } from "react";
import type { z } from "zod";

import { reportCardSnapshotV1 } from "@repo/contracts";

import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";

/**
 * THE NARRATIVE CARD (S5) — a report about a child, not a row of columns.
 *
 * Renders `reportCardSnapshotV1` (client-validated before anything shows):
 * the school's OWN widget sequence groups the subjects (ADR-032's subject
 * types — "Main Subjects", "Co-curricular" — are the school's words, not
 * ours); scoring subjects show mark/max, graded areas show letters, and
 * the term-grade areas close the card as remarks. Totals, rank, and
 * attendance finish the story. Every number is a frozen photograph —
 * nothing here is computed live, by design.
 */

export type ReportCardSnapshot = z.infer<typeof reportCardSnapshotV1>;

/** Parse the stored JSONB; a card that fails validation renders as an error, never as wrong numbers. */
export function parseCardSnapshot(data: unknown): ReportCardSnapshot | null {
  const result = reportCardSnapshotV1.safeParse(data);
  return result.success ? result.data : null;
}

export function ReportCardView({ snapshot }: { snapshot: ReportCardSnapshot }) {
  const widgets = useMemo(() => {
    const groups = new Map<string, ReportCardSnapshot["subjects"]>();
    for (const subject of snapshot.subjects) {
      const key = subject.widgetName ?? "—";
      const list = groups.get(key) ?? [];
      list.push(subject);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([, a], [, b]) => {
      const seqA = a[0]?.widgetSequence ?? 999;
      const seqB = b[0]?.widgetSequence ?? 999;
      return seqA - seqB;
    });
  }, [snapshot]);

  const totals = snapshot.totals;

  return (
    <article className="mx-auto w-full max-w-3xl flex flex-col gap-5 rounded-lg border p-6">
      <header className="flex flex-col gap-1 border-b pb-4 text-center">
        <h2 className="font-heading text-xl font-semibold">{snapshot.school.name}</h2>
        <p className="text-muted-foreground text-sm">
          {snapshot.term ? snapshot.term.name : copy.exams.card.annualTerm} ·{" "}
          {snapshot.academicYear.name}
        </p>
        <p className="mt-2 font-medium">
          {snapshot.student.name}{" "}
          <span className="text-muted-foreground font-normal text-sm">
            ({snapshot.student.admissionNumber})
          </span>
        </p>
        <p className="text-muted-foreground text-sm">
          {snapshot.student.className}
          {snapshot.student.sectionName ? ` — ${snapshot.student.sectionName}` : ""}
          {snapshot.student.rollNumber ? ` · ${copy.exams.card.roll} ${snapshot.student.rollNumber}` : ""}
        </p>
      </header>

      {widgets.map(([widgetName, subjects]) => (
        <section key={widgetName} aria-label={widgetName} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{widgetName}</h3>
          <table className="w-full text-sm">
            <caption className="sr-only">{widgetName}</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {copy.exams.card.subject}
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  {copy.exams.card.marks}
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  {copy.exams.card.grade}
                </th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.subjectId} className="border-b last:border-b-0">
                  <td className="py-1 pr-3">{subject.subjectName}</td>
                  <td className="py-1 pr-3 text-right">
                    {subject.isExempted
                      ? copy.exams.results.exempt
                      : subject.isAbsent
                        ? copy.exams.results.absent
                        : subject.marksObtained != null
                          ? `${Number(subject.marksObtained)} / ${subject.maxMarks != null ? Number(subject.maxMarks) : "—"}`
                          : (subject.grade ?? "—")}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {subject.grade ?? (subject.countsTowardResult ? "" : copy.exams.results.notCounted)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section aria-label={copy.exams.card.summary} className="flex flex-col gap-1 border-t pt-4 text-sm">
        <h3 className="text-sm font-semibold">{copy.exams.card.summary}</h3>
        <div className="flex flex-wrap gap-2">
          {totals.totalMarks != null ? (
            <Badge variant="outline">
              {copy.exams.results.total}: {Number(totals.totalMarks)}
              {totals.maxMarks != null ? ` / ${Number(totals.maxMarks)}` : ""}
            </Badge>
          ) : null}
          {totals.percentage != null ? (
            <Badge variant="outline">
              {copy.exams.results.percent}: {totals.percentage}
            </Badge>
          ) : null}
          {totals.grade ? <Badge variant="outline">{totals.grade}</Badge> : null}
          {totals.isPassed != null ? (
            <Badge variant={totals.isPassed ? "secondary" : "destructive"}>
              {totals.isPassed ? copy.exams.results.passed : copy.exams.results.failed}
            </Badge>
          ) : null}
          {totals.rankInClass != null ? (
            <Badge variant="outline">
              {copy.exams.card.rankInClass}: {totals.rankInClass}
            </Badge>
          ) : null}
          {totals.rankInSection != null ? (
            <Badge variant="outline">
              {copy.exams.card.rankInSection}: {totals.rankInSection}
            </Badge>
          ) : null}
        </div>
        {snapshot.attendance ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {copy.exams.card.attendance}: {snapshot.attendance.daysPresent}/
            {snapshot.attendance.workingDays}
            {snapshot.attendance.percentage ? ` (${snapshot.attendance.percentage}%)` : ""}
          </p>
        ) : null}
      </section>

      {snapshot.termAssessments.length > 0 ? (
        <section aria-label={copy.exams.card.areas} className="flex flex-col gap-1 text-sm">
          <h3 className="text-sm font-semibold">{copy.exams.card.areas}</h3>
          <ul className="flex flex-col gap-1">
            {snapshot.termAssessments.map((assessment) => (
              <li key={assessment.mappingId} className="flex justify-between gap-3">
                <span>{assessment.areaName}</span>
                <span className="text-muted-foreground text-right">
                  {assessment.grade ?? assessment.remarks ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="text-muted-foreground border-t pt-3 text-xs">
        {copy.exams.card.issuedNote}
      </footer>
    </article>
  );
}
