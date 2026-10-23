import type { CreateAcademicYearInput } from "@repo/contracts";

import { copy } from "../../lib/copy";
import {
  currentSessionStartYear,
  sessionFromStartYear,
  sessionStartYearOptions,
  type SessionDates,
} from "../../lib/session-dates";

/**
 * The session form's logic, pure and testable.
 *
 * Creating is a start-year choice that fills name and dates; editing is always
 * manual, because re-deriving dates from a preset would silently discard an
 * amendment someone made deliberately. The overlap check mirrors the
 * database's exclusion constraint so the user sees which session they hit; the
 * constraint remains the authority (ADR-022).
 */

export type SessionForm = SessionDates;
export type SessionFormField = keyof SessionForm;
export type SessionFormErrors = Partial<Record<SessionFormField, string>>;

export type ExistingSession = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
};

/** A new session in the session we are actually in — the common case. */
export function emptySessionForm(today?: string): SessionForm {
  return sessionFromStartYear(currentSessionStartYear(today));
}

/**
 * The create form's opening values: the current session when it is still free,
 * otherwise the next free year. Landing on an "Already added" preset with an
 * immediate overlap error would be a trap — opening the form is not a mistake.
 */
export function initialSessionForm(
  existing: ExistingSession[],
  today?: string,
): SessionForm {
  const current = currentSessionStartYear(today);
  const ordered = [
    current,
    ...sessionStartYearOptions(today).filter((year) => year !== current),
  ];
  const free = ordered.find((year) => !isStartYearTaken(year, existing));
  return sessionFromStartYear(free ?? current);
}

/** The stored row back to the form. */
export function sessionFormFrom(year: {
  name: string;
  startDate: string;
  endDate: string;
}): SessionForm {
  return {
    name: year.name,
    startDate: year.startDate,
    endDate: year.endDate,
  };
}

export function validateSessionField(
  field: SessionFormField,
  form: SessionForm,
): string | undefined {
  const value = form[field].trim();

  if (field === "name") {
    return value.length < 4 || value.length > 20
      ? copy.sessions.errors.name
      : undefined;
  }
  if (field === "startDate") {
    return value.length === 0 ? copy.sessions.errors.startDate : undefined;
  }
  return value.length === 0 ? copy.sessions.errors.endDate : undefined;
}

/**
 * Field errors, plus the range rules on `endDate`: a session that ends before
 * it starts, or overlaps a sibling, is a mistake about the range as a whole.
 * `editingId` excludes the row being edited from its own overlap check.
 */
export function validateSessionForm(
  form: SessionForm,
  existing: ExistingSession[] = [],
  editingId?: string,
): SessionFormErrors {
  const errors: SessionFormErrors = {};
  const nameError = validateSessionField("name", form);
  if (nameError) errors.name = nameError;
  const startError = validateSessionField("startDate", form);
  if (startError) errors.startDate = startError;
  const endError = validateSessionField("endDate", form);
  if (endError) errors.endDate = endError;

  if (startError || endError) return errors;

  if (form.endDate < form.startDate) {
    errors.endDate = copy.sessions.errors.dateOrder;
    return errors;
  }

  const overlap = existing.find(
    (year) =>
      year.id !== editingId &&
      form.startDate <= year.endDate &&
      form.endDate >= year.startDate,
  );
  if (overlap) {
    errors.endDate = copy.sessions.errors.overlap(overlap.name);
  }
  return errors;
}

export function sessionFormHasErrors(errors: SessionFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function sessionPayload(form: SessionForm): CreateAcademicYearInput {
  return {
    name: form.name.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
  };
}

export function isSessionFormDirty(a: SessionForm, b: SessionForm): boolean {
  return (
    a.name !== b.name ||
    a.startDate !== b.startDate ||
    a.endDate !== b.endDate
  );
}

/** A start-year pill is taken when a sibling already starts that April. */
export function isStartYearTaken(
  startYear: number,
  existing: ExistingSession[],
  editingId?: string,
): boolean {
  const preset = sessionFromStartYear(startYear);
  return existing.some(
    (year) => year.id !== editingId && year.startDate === preset.startDate,
  );
}
