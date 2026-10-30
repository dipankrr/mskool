import type { ReportCardSnapshotV2 } from "@repo/contracts";

import { annualCopy } from "./annual-copy";
import { canonicalPercent, formatPercent, hundredthsOf } from "./grading-scale";

/**
 * ANNUAL RESULTS (chunk 7G, ADR-053) - the pure logic behind the year-end
 * screens: the rule editor's draft, its validation, the live "In short"
 * sentences, the payload the server expects, and the words a student's
 * verdict is explained in. The server owns every number; nothing here
 * computes a result.
 */

const c = annualCopy;

// ---------------------------------------------------------------------------
// The rule draft
// ---------------------------------------------------------------------------

export type AnnualPreset = "weighted" | "average" | "sum" | "single" | "best";
export const ANNUAL_PRESETS: readonly AnnualPreset[] = [
  "weighted",
  "average",
  "sum",
  "single",
  "best",
];

export type TermLite = { id: string; name: string; sequenceNumber: number };

export type OwnRulesDraft = {
  /** Blank = every counted subject. */
  minSubjectsToPass: string;
  mandatoryPassSubjectIds: string[];
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: string;
  minAttendancePct: string;
};

export type AnnualDraft = {
  preset: AnnualPreset;
  /** Picked term ids (exactly one for "single"). */
  picked: string[];
  /** termId -> percent text, read only by "weighted". */
  weights: Record<string, string>;
  bestN: string;
  passPercent: string;
  useOwnRules: boolean;
  rules: OwnRulesDraft;
};

export type AnnualPolicyRowLike = {
  id: string;
  classId: string | null;
  method: "weighted" | "single_term" | "best_n";
  bestN: number | null;
  totalDisplay: "average" | "sum";
  annualSubjectPassPercent: string;
  useOwnPassRules: boolean;
  minSubjectsToPass: number | null;
  mandatoryPassSubjectIds: string[];
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: number | null;
  minAttendancePct: string;
  terms: { termId: string; weightage: string | null }[];
  summary: string;
};

function percentText(value: string | null): string {
  if (value === null) return "";
  const h = hundredthsOf(value);
  return h === null ? value : formatPercent(h);
}

/** Weights that total exactly 100.00 for n terms (the remainder lands on the last). */
export function equalWeights(n: number): string[] {
  if (n <= 0) return [];
  const each = Math.floor(10000 / n);
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = 10000 - each * (n - 1);
  return out.map((h) => formatPercent(h));
}

export function presetOf(row: AnnualPolicyRowLike): AnnualPreset {
  if (row.method === "weighted") return "weighted";
  if (row.method === "single_term") return "single";
  if (row.bestN !== null && row.bestN === row.terms.length) {
    return row.totalDisplay === "sum" ? "sum" : "average";
  }
  return "best";
}

const blankRules = (): OwnRulesDraft => ({
  minSubjectsToPass: "",
  mandatoryPassSubjectIds: [],
  compartmentAllowed: false,
  maxSubjectsForCompartment: "",
  minAttendancePct: "75",
});

/**
 * A new rule starts as a copy of `from` (the school default when it exists),
 * otherwise as "weighted, every term, equal weights". An override is a delta,
 * not a blank page.
 */
export function annualDraft(
  row: AnnualPolicyRowLike | null,
  terms: readonly TermLite[],
  from: AnnualPolicyRowLike | null = null,
): AnnualDraft {
  const source = row ?? from;
  const ordered = [...terms].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  if (!source) {
    const split = equalWeights(ordered.length);
    return {
      preset: "weighted",
      picked: ordered.map((t) => t.id),
      weights: Object.fromEntries(ordered.map((t, i) => [t.id, split[i] ?? ""])),
      bestN: "",
      passPercent: "",
      useOwnRules: false,
      rules: blankRules(),
    };
  }
  return {
    preset: presetOf(source),
    picked: source.terms.map((t) => t.termId),
    weights: Object.fromEntries(
      source.terms.map((t) => [t.termId, percentText(t.weightage)]),
    ),
    bestN: source.bestN === null ? "" : String(source.bestN),
    passPercent: percentText(source.annualSubjectPassPercent),
    useOwnRules: source.useOwnPassRules,
    rules: source.useOwnPassRules
      ? {
          minSubjectsToPass: source.minSubjectsToPass === null ? "" : String(source.minSubjectsToPass),
          mandatoryPassSubjectIds: [...source.mandatoryPassSubjectIds],
          compartmentAllowed: source.compartmentAllowed,
          maxSubjectsForCompartment:
            source.maxSubjectsForCompartment === null ? "" : String(source.maxSubjectsForCompartment),
          minAttendancePct: percentText(source.minAttendancePct) || "75",
        }
      : blankRules(),
  };
}

/** Switching the method: keep the picks, give weighted its equal split when empty. */
export function withPreset(draft: AnnualDraft, preset: AnnualPreset, terms: readonly TermLite[]): AnnualDraft {
  const ordered = [...terms].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  let picked = draft.picked;
  if (preset === "single") picked = picked.slice(-1).length > 0 ? picked.slice(-1) : ordered.slice(-1).map((t) => t.id);
  if (preset !== "single" && picked.length <= 1 && ordered.length > 1) picked = ordered.map((t) => t.id);
  let weights = draft.weights;
  if (preset === "weighted") {
    const missing = picked.some((id) => !weights[id]);
    if (missing) {
      const split = equalWeights(picked.length);
      weights = { ...weights, ...Object.fromEntries(picked.map((id, i) => [id, split[i] ?? ""])) };
    }
  }
  const bestN = preset === "best" && draft.bestN === "" ? String(Math.max(1, picked.length - 1)) : draft.bestN;
  return { ...draft, preset, picked, weights, bestN };
}

export function togglePick(draft: AnnualDraft, termId: string, terms: readonly TermLite[]): AnnualDraft {
  if (draft.preset === "single") return { ...draft, picked: [termId] };
  const order = new Map(terms.map((t) => [t.id, t.sequenceNumber]));
  const next = draft.picked.includes(termId)
    ? draft.picked.filter((id) => id !== termId)
    : [...draft.picked, termId].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const weights = { ...draft.weights };
  if (draft.preset === "weighted" && !draft.picked.includes(termId) && !weights[termId]) weights[termId] = "";
  return { ...draft, picked: next, weights };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type AnnualField = "terms" | "weights" | "bestN" | "pass" | "minSubjects" | "compartmentCap" | "attendance";
export type AnnualErrors = Partial<Record<AnnualField, string>>;

/** Hundredths of a percent, or null when the text is not a clean percentage. */
function hundredths(text: string): number | null {
  return hundredthsOf(text.trim());
}

export function weightTotal(draft: AnnualDraft): number {
  return draft.picked.reduce((acc, id) => acc + (hundredths(draft.weights[id] ?? "") ?? 0), 0);
}

/** Hundredths of a percent as text for the live total ("9000" -> "90"). */
export function formatWeightTotal(total: number): string {
  return formatPercent(total);
}

export function annualErrors(draft: AnnualDraft): AnnualErrors {
  const errors: AnnualErrors = {};
  const p = c.rules.problems;
  if (draft.picked.length === 0) errors.terms = p.noTerms;
  else if (draft.preset === "single" && draft.picked.length !== 1) errors.terms = p.singleOne;

  if (draft.preset === "weighted" && draft.picked.length > 0) {
    const parsed = draft.picked.map((id) => hundredths(draft.weights[id] ?? ""));
    if (parsed.some((h) => h === null)) errors.weights = p.weightMissing;
    else {
      const total = parsed.reduce<number>((a, h) => a + (h ?? 0), 0);
      if (total !== 10000) errors.weights = p.weightTotal(formatPercent(total));
    }
  }
  if (draft.preset === "best") {
    const n = Number(draft.bestN);
    if (!/^\d{1,2}$/.test(draft.bestN.trim()) || n < 1) errors.bestN = p.bestNMissing;
    else if (n > draft.picked.length) errors.bestN = p.bestNTooMany(draft.picked.length);
  }
  if (hundredths(draft.passPercent) === null || draft.passPercent.trim() === "") errors.pass = p.passMissing;

  if (draft.useOwnRules) {
    const min = draft.rules.minSubjectsToPass.trim();
    if (min !== "" && (!/^\d{1,2}$/.test(min) || Number(min) < 1 || Number(min) > 50)) errors.minSubjects = p.minSubjects;
    if (draft.rules.compartmentAllowed) {
      const cap = draft.rules.maxSubjectsForCompartment.trim();
      if (!/^\d{1,2}$/.test(cap) || Number(cap) < 1 || Number(cap) > 20) errors.compartmentCap = p.compartmentCap;
    }
    if (hundredths(draft.rules.minAttendancePct) === null || draft.rules.minAttendancePct.trim() === "") {
      errors.attendance = p.attendance;
    }
  }
  return errors;
}

export function hasAnnualErrors(errors: AnnualErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function firstAnnualError(errors: AnnualErrors): string | null {
  const order: AnnualField[] = ["terms", "weights", "bestN", "pass", "minSubjects", "compartmentCap", "attendance"];
  for (const key of order) if (errors[key]) return errors[key]!;
  return null;
}

// ---------------------------------------------------------------------------
// Payload, dirty, summary
// ---------------------------------------------------------------------------

export type AnnualPayload = {
  id?: string;
  academicYearId: string;
  /** NULL = the school default. Not `classId`: the server reserves that name for the scope node. */
  appliesToClassId: string | null;
  method: "weighted" | "single_term" | "best_n";
  bestN: number | null;
  totalDisplay: "average" | "sum";
  annualSubjectPassPercent: string;
  useOwnPassRules: boolean;
  minSubjectsToPass: number | null;
  mandatoryPassSubjectIds: string[];
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: number | null;
  minAttendancePct: string;
  terms: { termId: string; weightage: string | null }[];
};

/** The five labels, stored as the server's three methods (ADR-053 §2). */
export function annualPayload(
  draft: AnnualDraft,
  where: { id?: string; academicYearId: string; classId: string | null },
): AnnualPayload {
  const method =
    draft.preset === "weighted" ? "weighted" : draft.preset === "single" ? "single_term" : "best_n";
  const bestN =
    draft.preset === "best"
      ? Number(draft.bestN)
      : draft.preset === "average" || draft.preset === "sum"
        ? draft.picked.length
        : null;
  const own = draft.useOwnRules;
  const min = draft.rules.minSubjectsToPass.trim();
  return {
    ...(where.id ? { id: where.id } : {}),
    academicYearId: where.academicYearId,
    appliesToClassId: where.classId,
    method,
    bestN,
    totalDisplay: draft.preset === "sum" ? "sum" : "average",
    annualSubjectPassPercent: canonicalPercent(draft.passPercent) ?? draft.passPercent.trim(),
    useOwnPassRules: own,
    minSubjectsToPass: own && min !== "" ? Number(min) : null,
    mandatoryPassSubjectIds: own ? draft.rules.mandatoryPassSubjectIds : [],
    compartmentAllowed: own ? draft.rules.compartmentAllowed : false,
    maxSubjectsForCompartment:
      own && draft.rules.compartmentAllowed ? Number(draft.rules.maxSubjectsForCompartment) : null,
    minAttendancePct: own ? (canonicalPercent(draft.rules.minAttendancePct) ?? "75") : "75",
    terms: draft.picked.map((termId) => ({
      termId,
      weightage:
        draft.preset === "weighted" ? (canonicalPercent(draft.weights[termId] ?? "") ?? null) : null,
    })),
  };
}

export function annualDirty(draft: AnnualDraft, row: AnnualPolicyRowLike): boolean {
  const base = annualDraft(row, row.terms.map((t, i) => ({ id: t.termId, name: "", sequenceNumber: i })));
  return JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(base));
}

function normalize(draft: AnnualDraft) {
  const picked = [...draft.picked];
  return {
    preset: draft.preset,
    picked,
    weights: draft.preset === "weighted" ? picked.map((id) => canonicalPercent(draft.weights[id] ?? "") ?? draft.weights[id] ?? "") : [],
    bestN: draft.preset === "best" ? draft.bestN.trim() : "",
    pass: canonicalPercent(draft.passPercent) ?? draft.passPercent.trim(),
    own: draft.useOwnRules,
    rules: draft.useOwnRules ? { ...draft.rules, mandatoryPassSubjectIds: [...draft.rules.mandatoryPassSubjectIds].sort() } : null,
  };
}

/** The live "In short" read-back: how the year is counted, what passes a subject, what promotes. */
export function annualSummary(
  draft: AnnualDraft,
  terms: readonly TermLite[],
  termRuleLine: string | null,
): string[] {
  const names = new Map(terms.map((t) => [t.id, t.name]));
  const order = new Map(terms.map((t) => [t.id, t.sequenceNumber]));
  const picked = [...draft.picked].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const label = (id: string) => names.get(id) ?? "Term";

  let how: string;
  if (picked.length === 0) how = c.rules.problems.noTerms;
  else if (draft.preset === "weighted") {
    how = `Weighted: ${picked.map((id) => `${label(id)} ${draft.weights[id]?.trim() || "?"}%`).join(" · ")}`;
  } else if (draft.preset === "single") {
    how = `${label(picked[0]!)} is the year`;
  } else if (draft.preset === "best") {
    how = `Best ${draft.bestN.trim() || "?"} of ${picked.length} terms for each subject`;
  } else {
    how = `${draft.preset === "sum" ? "Sum" : "Average"} of ${picked.length} term${picked.length === 1 ? "" : "s"}`;
  }
  const pass = draft.passPercent.trim()
    ? `A subject passes with ${draft.passPercent.trim()}% or more for the year.`
    : c.rules.problems.passMissing;
  const promotion = draft.useOwnRules ? ownRulesLine(draft.rules) : (termRuleLine ?? c.rules.sameRulesNone);
  return [how, pass, promotion];
}

function ownRulesLine(rules: OwnRulesDraft): string {
  const min = rules.minSubjectsToPass.trim();
  const parts = [min === "" ? "Every counted subject must pass" : `At least ${min} subjects must pass`];
  if (rules.mandatoryPassSubjectIds.length > 0) {
    parts.push(`${rules.mandatoryPassSubjectIds.length} must-pass`);
  }
  parts.push(
    rules.compartmentAllowed
      ? `compartment up to ${rules.maxSubjectsForCompartment.trim() || "?"} subjects`
      : "no compartment",
  );
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Rule list rows
// ---------------------------------------------------------------------------

/** The second line of a rule row: who decides promotion. */
export function policyPromotionLine(row: AnnualPolicyRowLike): string {
  if (!row.useOwnPassRules) return c.rules.usesTermRules;
  return ownRulesLine({
    minSubjectsToPass: row.minSubjectsToPass === null ? "" : String(row.minSubjectsToPass),
    mandatoryPassSubjectIds: row.mandatoryPassSubjectIds,
    compartmentAllowed: row.compartmentAllowed,
    maxSubjectsForCompartment: row.maxSubjectsForCompartment === null ? "" : String(row.maxSubjectsForCompartment),
    minAttendancePct: row.minAttendancePct,
  });
}

export function policyCounts(rows: readonly { classId: string | null }[]) {
  const defaults = rows.filter((r) => r.classId === null).length;
  return { defaults, classes: rows.length - defaults };
}

export function sortPolicies<T extends { classId: string | null }>(
  rows: readonly T[],
  classOrder: (classId: string) => number,
): T[] {
  return [...rows].sort((a, b) => {
    if (a.classId === null) return -1;
    if (b.classId === null) return 1;
    return classOrder(a.classId) - classOrder(b.classId);
  });
}

export function uncoveredPolicyScopes(
  classes: readonly { id: string; name: string }[],
  rows: readonly { classId: string | null }[],
): { id: string; label: string; detail?: string }[] {
  const out: { id: string; label: string; detail?: string }[] = [];
  if (!rows.some((r) => r.classId === null)) {
    out.push({ id: "", label: c.rules.defaultRule, detail: "Every class without its own rule" });
  }
  for (const klass of classes) {
    if (!rows.some((r) => r.classId === klass.id)) out.push({ id: klass.id, label: klass.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The class screen
// ---------------------------------------------------------------------------

export type AnnualStudentLike = {
  studentId: string;
  name: string;
  rollNumber: string | null;
  sectionName: string | null;
  promotionStatus: "promoted" | "compartment" | "detained";
  failedSubjectIds: string[];
  renormalized: boolean;
  rankInClass: number | null;
  subjects: { isExempted: boolean; renormalized: boolean }[];
};

export type AnnualFilter = "all" | "detained" | "compartment" | "flagged";

export function isFlagged(student: AnnualStudentLike): boolean {
  return student.renormalized || student.subjects.some((s) => s.isExempted || s.renormalized);
}

export function filterStudents<T extends AnnualStudentLike>(students: readonly T[], filter: AnnualFilter): T[] {
  switch (filter) {
    case "detained":
      return students.filter((s) => s.promotionStatus === "detained");
    case "compartment":
      return students.filter((s) => s.promotionStatus === "compartment");
    case "flagged":
      return students.filter(isFlagged);
    default:
      return [...students];
  }
}

export function filterCounts(students: readonly AnnualStudentLike[]): Record<AnnualFilter, number> {
  return {
    all: students.length,
    detained: filterStudents(students, "detained").length,
    compartment: filterStudents(students, "compartment").length,
    flagged: filterStudents(students, "flagged").length,
  };
}

export function verdictCountsLine(students: readonly AnnualStudentLike[]): string {
  const n = (status: AnnualStudentLike["promotionStatus"]) => students.filter((s) => s.promotionStatus === status).length;
  return [
    c.klass.counts.promoted(n("promoted")),
    n("compartment") > 0 ? c.klass.counts.compartment(n("compartment")) : null,
    n("detained") > 0 ? c.klass.counts.detained(n("detained")) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Students are listed section by section, then by roll number (numeric when it is), then by name. */
export function sortStudents<T extends AnnualStudentLike>(students: readonly T[]): T[] {
  return [...students].sort((a, b) => {
    const sa = a.sectionName ?? "";
    const sb = b.sectionName ?? "";
    if (sa !== sb) return sa.localeCompare(sb);
    const ra = Number(a.rollNumber);
    const rb = Number(b.rollNumber);
    if (Number.isFinite(ra) && Number.isFinite(rb) && a.rollNumber && b.rollNumber && ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

export function listText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The verdict explained in a sentence a principal can say to a parent. */
export function verdictInWords(
  student: Pick<AnnualStudentLike, "promotionStatus" | "failedSubjectIds">,
  subjectName: (id: string) => string,
): string {
  const failed = listText(student.failedSubjectIds.map(subjectName));
  switch (student.promotionStatus) {
    case "promoted":
      return student.failedSubjectIds.length === 0
        ? "Passed every counted subject."
        : `Did not pass ${failed}, which the promotion rules allow.`;
    case "compartment":
      return `Did not pass ${failed}. Promoted on compartment: these subjects are re-attempted.`;
    default:
      return student.failedSubjectIds.length === 0
        ? "Did not meet the promotion rules."
        : `Did not pass ${failed}. The promotion rules do not allow moving up.`;
  }
}

/** "Counted from 2 of 3 terms (Term 1 29%, Term 3 71%)." for a subject that was renormalized. */
export function renormalizedNote(
  sources: { termId: string; used: boolean; effectiveWeight: string }[],
  termName: (id: string) => string,
  totalTerms: number,
): string {
  const used = sources.filter((s) => s.used);
  const weights = used
    .filter((s) => hundredthsOf(s.effectiveWeight) !== null && s.effectiveWeight !== "0.00")
    .map((s) => `${termName(s.termId)} ${percentText(s.effectiveWeight)}%`)
    .join(", ");
  return c.student.countedFrom(used.length, totalTerms, weights);
}

export type StatusKind = "none" | "draft" | "stale" | "published";
export function statusTone(status: StatusKind): "neutral" | "caution" | "positive" {
  if (status === "published") return "positive";
  if (status === "stale") return "caution";
  return "neutral";
}

// ---------------------------------------------------------------------------
// The annual card (snapshot version 2) - a structural guard, ADR-048
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** What version a stored card is, without trusting the rest of it. */
export function snapshotVersionOf(data: unknown): number | null {
  return isObject(data) && typeof data.snapshotVersion === "number" ? data.snapshotVersion : null;
}

/**
 * Hand-rolled guard for `reportCardSnapshotV2` (the mobile bundle takes no
 * runtime schema from the server, ADR-048). Checks the shape the screen reads;
 * anything else is "I cannot show this", never a half-drawn card.
 */
export function asAnnualSnapshot(data: unknown): ReportCardSnapshotV2 | null {
  if (!isObject(data) || data.snapshotVersion !== 2 || data.kind !== "annual") return null;
  const ok =
    isObject(data.student) &&
    isObject(data.school) &&
    isObject(data.academicYear) &&
    isObject(data.policy) &&
    isObject(data.totals) &&
    isObject(data.verdict) &&
    Array.isArray(data.terms) &&
    Array.isArray(data.subjects) &&
    data.subjects.every((s) => isObject(s) && Array.isArray(s.byTerm)) &&
    Array.isArray((data.verdict as Record<string, unknown>).failedSubjects);
  return ok ? (data as ReportCardSnapshotV2) : null;
}
