import { copy } from "./copy";
import { canonicalPercent, formatPercent, hundredthsOf } from "./grading-scale";

/**
 * PASS CRITERIA (chunk 7F) — what passing a year means.
 *
 * One school default (classId null) plus one optional override per class, per
 * year. There is no delete: a wrong row is corrected, and a scope cannot move
 * once saved (the unique indexes name each rule). Validation mirrors the
 * contract and the DB checks:
 *
 * - minimum subjects: blank = every counted subject, else 1–50;
 * - grace on ⇒ BOTH caps present, each 0–100;
 * - compartment on ⇒ a failed-subject cap of 1–20;
 * - attendance is required, 0–100, and advisory only.
 *
 * The "In short" card is the anti-wall-of-controls device: four plain lines
 * rewritten from the draft, so the policy reads before the toggles do.
 */

export type CriteriaDraft = {
  /** A form string; empty means "every counted subject". */
  minSubjectsToPass: string;
  mandatoryPassSubjectIds: string[];
  graceMarksAllowed: boolean;
  maxGracePerSubject: string;
  maxGraceTotal: string;
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: string;
  minAttendancePct: string;
  absentMandatoryFails: boolean;
  exemptRenormalizes: boolean;
};

export type CriteriaRowLike = {
  id: string;
  classId: string | null;
  minSubjectsToPass: number | null;
  mandatoryPassSubjectIds: string[];
  graceMarksAllowed: boolean;
  maxGracePerSubject: string | null;
  maxGraceTotal: string | null;
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: number | null;
  absentMandatoryFails: boolean;
  exemptRenormalizes: boolean;
  minAttendancePct: string;
};

export type CriteriaField =
  | "minSubjects"
  | "gracePerSubject"
  | "graceTotal"
  | "compartmentCap"
  | "attendance";

export type CriteriaErrors = Partial<Record<CriteriaField, string>>;

function percentText(value: string | null): string {
  if (value === null) return "";
  const hundredths = hundredthsOf(value);
  return hundredths === null ? value : formatPercent(hundredths);
}

function defaultDraft(): CriteriaDraft {
  return {
    minSubjectsToPass: "",
    mandatoryPassSubjectIds: [],
    graceMarksAllowed: false,
    maxGracePerSubject: "",
    maxGraceTotal: "",
    compartmentAllowed: false,
    maxSubjectsForCompartment: "",
    minAttendancePct: "75",
    absentMandatoryFails: true,
    exemptRenormalizes: false,
  };
}

export function criteriaDraft(row: CriteriaRowLike | null): CriteriaDraft {
  if (!row) return defaultDraft();
  return {
    minSubjectsToPass:
      row.minSubjectsToPass === null ? "" : String(row.minSubjectsToPass),
    mandatoryPassSubjectIds: [...row.mandatoryPassSubjectIds],
    graceMarksAllowed: row.graceMarksAllowed,
    maxGracePerSubject: percentText(row.maxGracePerSubject),
    maxGraceTotal: percentText(row.maxGraceTotal),
    compartmentAllowed: row.compartmentAllowed,
    maxSubjectsForCompartment:
      row.maxSubjectsForCompartment === null
        ? ""
        : String(row.maxSubjectsForCompartment),
    minAttendancePct: percentText(row.minAttendancePct) || "75",
    absentMandatoryFails: row.absentMandatoryFails,
    exemptRenormalizes: row.exemptRenormalizes,
  };
}

/**
 * An override starts as a delta of the school default, not a blank page: the
 * admin sees exactly what Class 10 changes. Same function, named for intent.
 */
export function criteriaDraftFromDefault(
  defaultRow: CriteriaRowLike,
): CriteriaDraft {
  return criteriaDraft(defaultRow);
}

function parseMinSubjects(value: string): number | null | "invalid" {
  const text = value.trim();
  if (text.length === 0) return null;
  if (!/^\d{1,2}$/.test(text)) return "invalid";
  const parsed = Number(text);
  return parsed >= 1 && parsed <= 50 ? parsed : "invalid";
}

function parseCompartmentCap(value: string): number | null | "invalid" {
  const text = value.trim();
  if (text.length === 0) return "invalid";
  if (!/^\d{1,2}$/.test(text)) return "invalid";
  const parsed = Number(text);
  return parsed >= 1 && parsed <= 20 ? parsed : "invalid";
}

export function criteriaErrors(draft: CriteriaDraft): CriteriaErrors {
  const errors: CriteriaErrors = {};

  if (parseMinSubjects(draft.minSubjectsToPass) === "invalid") {
    errors.minSubjects = copy.exams.grading.criteria.minSubjectsError;
  }

  if (draft.graceMarksAllowed) {
    const perSubject = draft.maxGracePerSubject.trim();
    const total = draft.maxGraceTotal.trim();
    if (perSubject.length === 0) {
      errors.gracePerSubject = copy.exams.grading.criteria.graceNeedsCaps;
    } else if (hundredthsOf(perSubject) === null) {
      errors.gracePerSubject = copy.exams.grading.criteria.graceCapError;
    }
    if (total.length === 0) {
      errors.graceTotal = copy.exams.grading.criteria.graceNeedsCaps;
    } else if (hundredthsOf(total) === null) {
      errors.graceTotal = copy.exams.grading.criteria.graceCapError;
    }
  }

  if (
    draft.compartmentAllowed &&
    parseCompartmentCap(draft.maxSubjectsForCompartment) === "invalid"
  ) {
    errors.compartmentCap = copy.exams.grading.criteria.compartmentCapError;
  }

  if (hundredthsOf(draft.minAttendancePct) === null) {
    errors.attendance = copy.exams.grading.criteria.attendanceError;
  }

  return errors;
}

export function hasCriteriaErrors(errors: CriteriaErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The first message the footer caption shows, in field order. */
export function firstCriteriaError(errors: CriteriaErrors): string | null {
  const order: CriteriaField[] = [
    "minSubjects",
    "gracePerSubject",
    "graceTotal",
    "compartmentCap",
    "attendance",
  ];
  for (const field of order) {
    if (errors[field]) return errors[field]!;
  }
  return null;
}

function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  return [...left].every((id) => right.has(id));
}

export type CriteriaPayload = {
  classId: string | null;
  minSubjectsToPass: number | null;
  mandatoryPassSubjectIds: string[];
  graceMarksAllowed: boolean;
  maxGracePerSubject: string | null;
  maxGraceTotal: string | null;
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: number | null;
  absentMandatoryFails: boolean;
  exemptRenormalizes: boolean;
  minAttendancePct: string;
};

/** The create payload (the screen supplies the scope it chose). */
export function criteriaPayload(
  draft: CriteriaDraft,
  classId: string | null,
): CriteriaPayload {
  const graceOn = draft.graceMarksAllowed;
  const perSubject = canonicalPercent(draft.maxGracePerSubject);
  const total = canonicalPercent(draft.maxGraceTotal);
  const compartmentCap = parseCompartmentCap(
    draft.maxSubjectsForCompartment,
  );

  return {
    classId,
    minSubjectsToPass: (() => {
      const parsed = parseMinSubjects(draft.minSubjectsToPass);
      return parsed === "invalid" ? null : parsed;
    })(),
    mandatoryPassSubjectIds: dedupeIds(draft.mandatoryPassSubjectIds),
    graceMarksAllowed: graceOn,
    maxGracePerSubject: graceOn ? perSubject : null,
    maxGraceTotal: graceOn ? total : null,
    compartmentAllowed: draft.compartmentAllowed,
    maxSubjectsForCompartment:
      draft.compartmentAllowed && compartmentCap !== "invalid"
        ? compartmentCap
        : null,
    absentMandatoryFails: draft.absentMandatoryFails,
    exemptRenormalizes: draft.exemptRenormalizes,
    minAttendancePct:
      canonicalPercent(draft.minAttendancePct) ??
      draft.minAttendancePct.trim(),
  };
}

/**
 * A patch of only what changed. Toggling grace off deliberately leaves the
 * caps in place (the server allows it), so toggling back restores the policy
 * instead of forcing a retype.
 */
export function criteriaUpdatePayload(
  draft: CriteriaDraft,
  row: CriteriaRowLike,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const next = criteriaPayload(draft, row.classId);

  if (next.minSubjectsToPass !== row.minSubjectsToPass) {
    data.minSubjectsToPass = next.minSubjectsToPass;
  }
  if (!sameIds(next.mandatoryPassSubjectIds, row.mandatoryPassSubjectIds)) {
    data.mandatoryPassSubjectIds = next.mandatoryPassSubjectIds;
  }
  if (next.graceMarksAllowed !== row.graceMarksAllowed) {
    data.graceMarksAllowed = next.graceMarksAllowed;
  }
  if (
    next.graceMarksAllowed &&
    next.maxGracePerSubject !== percentText(row.maxGracePerSubject)
  ) {
    data.maxGracePerSubject = next.maxGracePerSubject;
  }
  if (
    next.graceMarksAllowed &&
    next.maxGraceTotal !== percentText(row.maxGraceTotal)
  ) {
    data.maxGraceTotal = next.maxGraceTotal;
  }
  if (next.compartmentAllowed !== row.compartmentAllowed) {
    data.compartmentAllowed = next.compartmentAllowed;
  }
  if (
    next.compartmentAllowed &&
    next.maxSubjectsForCompartment !== row.maxSubjectsForCompartment
  ) {
    data.maxSubjectsForCompartment = next.maxSubjectsForCompartment;
  }
  if (next.absentMandatoryFails !== row.absentMandatoryFails) {
    data.absentMandatoryFails = next.absentMandatoryFails;
  }
  if (next.exemptRenormalizes !== row.exemptRenormalizes) {
    data.exemptRenormalizes = next.exemptRenormalizes;
  }
  if (next.minAttendancePct !== percentText(row.minAttendancePct)) {
    data.minAttendancePct = next.minAttendancePct;
  }

  return data;
}

export function criteriaDirty(
  draft: CriteriaDraft,
  row: CriteriaRowLike,
): boolean {
  return Object.keys(criteriaUpdatePayload(draft, row)).length > 0;
}

/** The list row's two lines. */
export function criteriaMeta(
  row: CriteriaRowLike,
  subjectName?: (id: string) => string | null,
): {
  line1: string;
  line2: string;
} {
  const words = copy.exams.grading.criteria.listMeta;
  const attendance =
    hundredthsOf(row.minAttendancePct) !== null
      ? formatPercent(hundredthsOf(row.minAttendancePct)!)
      : row.minAttendancePct;

  /**
   * A must-pass subject is the strongest clause in the rule, so the row names
   * it. Three names is the most a row can carry before it stops reading; the
   * rest are a count.
   */
  const mustPass = (() => {
    const total = row.mandatoryPassSubjectIds.length;
    if (total === 0) return null;
    const names = row.mandatoryPassSubjectIds
      .map((id) => subjectName?.(id) ?? null)
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return words.mustPassCount(total);
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3
      ? words.mustPassMore(shown, names.length - 3)
      : words.mustPass(shown);
  })();

  const line1 = [
    row.minSubjectsToPass === null
      ? words.all
      : words.atLeast(row.minSubjectsToPass),
    mustPass,
    row.graceMarksAllowed
      ? words.grace(
          percentText(row.maxGracePerSubject) || "?",
          percentText(row.maxGraceTotal) || "?",
        )
      : words.noGrace,
    row.compartmentAllowed
      ? words.compartment(row.maxSubjectsForCompartment ?? 0)
      : words.noCompartment,
  ]
    .filter(Boolean)
    .join(" · ");

  const line2 = [
    words.attendance(attendance),
    row.absentMandatoryFails ? words.absenceCanFail : words.absenceNeverFails,
    row.exemptRenormalizes ? words.exemptExcluded : words.exemptZero,
  ].join(" · ");

  return { line1, line2 };
}

/**
 * The four lines of the "In short" card. Incomplete caps say so rather than
 * claiming a policy that is not there yet.
 */
export function criteriaSummary(
  draft: CriteriaDraft,
  subjectName?: (id: string) => string | null,
): string[] {
  const words = copy.exams.grading.criteria.summary;

  const min = parseMinSubjects(draft.minSubjectsToPass);
  const base =
    min === null
      ? words.all
      : min === "invalid"
        ? words.minSubjectsIncomplete
        : words.atLeast(String(min));

  const names = draft.mandatoryPassSubjectIds
    .map((id) => subjectName?.(id) ?? null)
    .filter((name): name is string => Boolean(name));

  const passLine =
    names.length > 0 ? words.including(base, names.join(", ")) : base;

  const graceLine = !draft.graceMarksAllowed
    ? words.noGrace
    : canonicalPercent(draft.maxGracePerSubject) !== null &&
        canonicalPercent(draft.maxGraceTotal) !== null
      ? words.grace(
          canonicalPercent(draft.maxGracePerSubject)!,
          canonicalPercent(draft.maxGraceTotal)!,
        )
      : words.graceIncomplete;

  const compartmentLine = !draft.compartmentAllowed
    ? words.noCompartment
    : parseCompartmentCap(draft.maxSubjectsForCompartment) === "invalid"
      ? words.compartmentIncomplete
      : words.compartment(draft.maxSubjectsForCompartment.trim());

  const attendanceLine = (() => {
    const pct = canonicalPercent(draft.minAttendancePct);
    return pct === null ? words.attendanceIncomplete : words.attendance(pct);
  })();

  return [passLine, graceLine, compartmentLine, attendanceLine];
}

/** "School default" / "Class 6 override" — the editor's meta line. */
export function criteriaScopeLabel(
  row: { classId: string | null },
  className: string | null,
): string {
  return row.classId === null
    ? copy.exams.grading.criteria.defaultRule
    : copy.exams.grading.criteria.classRule(className ?? "Class");
}

export type ScopeOption = {
  /** "" means the school default (ChoiceSheet ids are strings). */
  id: string;
  label: string;
  detail: string;
};

/**
 * What a new rule may cover: the school default if no default exists, plus
 * every class without an override. A class that already has one is never
 * offered — the unique index would refuse the save.
 */
export function uncoveredScopes(
  classes: readonly { id: string; name: string }[],
  rules: readonly { classId: string | null }[],
): ScopeOption[] {
  const hasDefault = rules.some((rule) => rule.classId === null);
  const covered = new Set(
    rules
      .map((rule) => rule.classId)
      .filter((id): id is string => id !== null),
  );
  const options: ScopeOption[] = [];
  if (!hasDefault) {
    options.push({
      id: "",
      label: copy.exams.grading.criteria.appliesSchool,
      detail: copy.exams.grading.criteria.appliesSchoolDetail,
    });
  }
  for (const klass of classes) {
    if (!covered.has(klass.id)) {
      options.push({
        id: klass.id,
        label: klass.name,
        detail: copy.exams.grading.criteria.appliesClassDetail,
      });
    }
  }
  return options;
}

/** Default first, then classes in the school's own order. */
export function sortCriteriaRows<T extends { classId: string | null }>(
  rows: readonly T[],
  classOrder: (classId: string) => number,
): T[] {
  return [...rows].sort((a, b) => {
    if (a.classId === null && b.classId !== null) return -1;
    if (a.classId !== null && b.classId === null) return 1;
    if (a.classId === null || b.classId === null) return 0;
    return classOrder(a.classId) - classOrder(b.classId);
  });
}

export function criteriaCounts(
  rules: readonly { classId: string | null }[],
): { defaults: number; classes: number } {
  return {
    defaults: rules.filter((rule) => rule.classId === null).length,
    classes: rules.filter((rule) => rule.classId !== null).length,
  };
}
