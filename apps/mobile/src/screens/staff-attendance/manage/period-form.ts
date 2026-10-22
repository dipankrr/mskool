import { copy } from "../../../lib/copy";

/**
 * The period editor's form logic, pure (chunk 3): the stored row ⇄ form
 * mapping (times are `HH:MM:SS` from Postgres and `HH:MM` in the form), the
 * next free sequence, the client-side mirror of the contract's rules, and
 * the payload.
 */

export type PeriodForm = {
  name: string;
  /** Raw text; an integer 1–30. */
  sequence: string;
  /** HH:MM, or null for "no time set". */
  start: string | null;
  end: string | null;
  isHomeroom: boolean;
};

export type PeriodFormErrors = {
  name?: string;
  sequence?: string;
  timeOrder?: string;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "08:00:00" → "08:00"; anything unparseable → null. */
export function toHHMM(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.slice(0, 5);
  return TIME_PATTERN.test(head) ? head : null;
}

/** One past the highest sequence in the section, capped at the contract's 30. */
export function nextSequence(sequences: number[]): number {
  const max = sequences.length > 0 ? Math.max(...sequences) : 0;
  return Math.min(30, max + 1);
}

/** The stored row back to the form; a new row starts at the next slot. */
export function initialPeriodForm(
  period: {
    name: string;
    sequenceNumber: number;
    startTime: string | null;
    endTime: string | null;
    isHomeroom: boolean;
  } | null,
  next: number,
): PeriodForm {
  if (!period) {
    return {
      name: `Period ${next}`,
      sequence: String(next),
      start: null,
      end: null,
      isHomeroom: false,
    };
  }
  return {
    name: period.name,
    sequence: String(period.sequenceNumber),
    start: toHHMM(period.startTime),
    end: toHHMM(period.endTime),
    isHomeroom: period.isHomeroom,
  };
}

export function validatePeriodForm(form: PeriodForm): PeriodFormErrors {
  const errors: PeriodFormErrors = {};

  const name = form.name.trim();
  if (name.length < 1 || name.length > 50) {
    errors.name = copy.attendance.manage.periods.errors.name;
  }

  const sequenceText = form.sequence.trim();
  const sequence = Number(sequenceText);
  if (!/^\d+$/.test(sequenceText) || sequence < 1 || sequence > 30) {
    errors.sequence = copy.attendance.manage.periods.errors.sequence;
  }

  // Same rule as the contract's refine: 24-hour strings compare correctly.
  if (form.start !== null && form.end !== null && form.end <= form.start) {
    errors.timeOrder = copy.attendance.manage.periods.errors.timeOrder;
  }

  return errors;
}

/** Times travel as HH:MM or null — null clears the column on update. */
export function toPeriodPayload(form: PeriodForm): {
  name: string;
  sequenceNumber: number;
  startTime: string | null;
  endTime: string | null;
  isHomeroom: boolean;
} {
  return {
    name: form.name.trim(),
    sequenceNumber: Number(form.sequence.trim()),
    startTime: form.start,
    endTime: form.end,
    isHomeroom: form.isHomeroom,
  };
}
