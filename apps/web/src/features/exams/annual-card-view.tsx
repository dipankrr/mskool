"use client";

import { useMemo } from "react";
import type { z } from "zod";

import { reportCardSnapshot, reportCardSnapshotV2 } from "@repo/contracts";

import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import { ReportCardView } from "./report-card-view";

/**
 * THE ANNUAL CARD (ADR-053, `snapshotVersion: 2`) and the one place that
 * knows both card versions. A stored card is parsed against the union; one
 * that matches neither (a version this build does not know) renders as an
 * honest "cannot be shown", never as a half-drawn card. Version 1 keeps its
 * own renderer untouched - a duplicate marksheet prints exactly what was
 * handed over.
 */

export type AnnualCardSnapshot = z.infer<typeof reportCardSnapshotV2>;
export type AnyCardSnapshot = z.infer<typeof reportCardSnapshot>;

export function parseAnyCardSnapshot(data: unknown): AnyCardSnapshot | null {
  const result = reportCardSnapshot.safeParse(data);
  return result.success ? result.data : null;
}

/** "83.00" -> "83": a percentage as a person would write it. */
const pct = (value: string | null | undefined) =>
  value == null ? "—" : value.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");

const VERDICT = {
  promoted: "Promoted",
  compartment: "Compartment",
  detained: "Detained",
} as const;

export function AnyReportCardView({ snapshot }: { snapshot: AnyCardSnapshot }) {
  return snapshot.snapshotVersion === 2 ? (
    <AnnualReportCardView snapshot={snapshot} />
  ) : (
    <ReportCardView snapshot={snapshot} />
  );
}

export function AnnualReportCardView({ snapshot }: { snapshot: AnnualCardSnapshot }) {
  const widgets = useMemo(() => {
    const groups = new Map<string, AnnualCardSnapshot["subjects"]>();
    for (const subject of snapshot.subjects) {
      const key = subject.widgetName ?? "—";
      groups.set(key, [...(groups.get(key) ?? []), subject]);
    }
    return [...groups.entries()].sort(
      ([, a], [, b]) => (a[0]?.widgetSequence ?? 999) - (b[0]?.widgetSequence ?? 999),
    );
  }, [snapshot]);

  const { totals, verdict } = snapshot;
  const showSum = snapshot.policy.totalDisplay === "sum";

  return (
    <article className="mx-auto w-full max-w-3xl flex flex-col gap-5 rounded-lg border p-6">
      <header className="flex flex-col gap-1 border-b pb-4 text-center">
        <h2 className="font-heading text-xl font-semibold">{snapshot.school.name}</h2>
        <p className="text-muted-foreground text-sm">
          {copy.exams.card.annualTerm} · {snapshot.academicYear.name}
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
        <p className="text-muted-foreground mt-1 text-xs">{snapshot.policy.summary}</p>
      </header>

      <section aria-label="Terms" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Terms</h3>
        <table className="w-full text-sm">
          <caption className="sr-only">How each term stood</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-1 pr-3 font-medium">Term</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Percentage</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">{copy.exams.card.grade}</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">{copy.exams.card.rankInClass}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.terms.map((term) => (
              <tr key={term.termId} className="border-b last:border-b-0">
                <td className="py-1 pr-3">
                  {term.name}
                  {term.nominalWeight ? (
                    <span className="text-muted-foreground"> · weight {pct(term.nominalWeight)}%</span>
                  ) : null}
                </td>
                <td className="py-1 pr-3 text-right">{term.percentage ? `${pct(term.percentage)}%` : "—"}</td>
                <td className="py-1 pr-3 text-right">{term.grade ?? "—"}</td>
                <td className="py-1 pr-3 text-right">{term.rankInClass ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {widgets.map(([widgetName, subjects]) => (
        <section key={widgetName} aria-label={widgetName} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{widgetName}</h3>
          <table className="w-full text-sm">
            <caption className="sr-only">{widgetName}</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1 pr-3 font-medium">{copy.exams.card.subject}</th>
                {snapshot.terms.map((term) => (
                  <th key={term.termId} scope="col" className="py-1 pr-3 text-right font-medium">
                    {term.name.replace(/^Term\s*/i, "T")}
                  </th>
                ))}
                <th scope="col" className="py-1 pr-3 text-right font-medium">Year</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.subjectId} className="border-b last:border-b-0">
                  <td className="py-1 pr-3">{subject.subjectName}</td>
                  {snapshot.terms.map((term) => {
                    const cell = subject.byTerm.find((t) => t.termId === term.termId);
                    const text = cell?.score ? pct(cell.score) : (cell?.grade ?? "—");
                    return (
                      <td
                        key={term.termId}
                        className={`py-1 pr-3 text-right ${cell?.used ? "font-medium" : "text-muted-foreground"}`}
                        title={cell && !cell.used ? `${term.name} was not counted` : undefined}
                      >
                        {text}
                      </td>
                    );
                  })}
                  <td className="py-1 pr-3 text-right font-semibold">
                    {subject.isExempted
                      ? copy.exams.results.exempt
                      : showSum && subject.displayMarks
                        ? `${pct(subject.displayMarks)} / ${pct(subject.displayMax)}`
                        : subject.percentage
                          ? `${pct(subject.percentage)}${subject.grade ? ` · ${subject.grade}` : ""}`
                          : (subject.grade ?? "—")}
                    {!subject.isExempted && !subject.isPassed ? (
                      <span className="text-destructive"> ✕</span>
                    ) : null}
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
          <Badge variant={verdict.promotionStatus === "detained" ? "destructive" : "secondary"}>
            {VERDICT[verdict.promotionStatus]}
          </Badge>
          {totals.percentage != null ? (
            <Badge variant="outline">
              {copy.exams.results.percent}: {pct(totals.percentage)}
            </Badge>
          ) : null}
          {totals.grade ? <Badge variant="outline">{totals.grade}</Badge> : null}
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
        {verdict.failedSubjects.length > 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {verdict.promotionStatus === "compartment" ? "Compartment in" : "Not passed"}:{" "}
            {(verdict.promotionStatus === "compartment"
              ? verdict.compartmentSubjects
              : verdict.failedSubjects
            )
              .map((s) => s.subjectName)
              .join(", ")}
          </p>
        ) : null}
        {verdict.renormalized ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Some subjects were counted from fewer terms than the school&apos;s rule selects.
          </p>
        ) : null}
        {snapshot.attendance ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {copy.exams.card.attendance}: {snapshot.attendance.daysPresent}/{snapshot.attendance.workingDays}
            {snapshot.attendance.percentage ? ` (${pct(snapshot.attendance.percentage)}%)` : ""}
          </p>
        ) : null}
      </section>

      <footer className="text-muted-foreground border-t pt-3 text-xs">{copy.exams.card.issuedNote}</footer>
    </article>
  );
}
