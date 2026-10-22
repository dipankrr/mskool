import { copy } from "../../../lib/copy";

/**
 * The marking policy's form logic, pure (chunk 3): defaults the server would
 * apply, the two numeric fields as text while they are being typed, the
 * client-side mirror of the contract's refine (a threshold is required only
 * when the rule is threshold-based), and the payload.
 */

export type MarkingMode = "daily" | "period_wise";
export type DailyStatusRule =
  | "homeroom_authoritative"
  | "threshold_percentage";

export type PolicyForm = {
  mode: MarkingMode;
  rule: DailyStatusRule;
  /** Raw text; an integer 1–100 when rule = threshold_percentage. */
  threshold: string;
  /** Raw text; an integer 0–120. */
  late: string;
};

export type PolicyFormErrors = {
  threshold?: string;
  late?: string;
};

/**
 * The stored policy back to the form; with no row, the server's own defaults
 * (daily · homeroom · 15) with an empty threshold — the screen's notice
 * explains that saving creates the row.
 */
export function initialPolicyForm(
  policy: {
    markingMode: string;
    dailyStatusRule: string;
    thresholdPercentage: number | null;
    lateArrivalMinutes: number;
  } | null,
): PolicyForm {
  if (!policy) {
    return {
      mode: "daily",
      rule: "homeroom_authoritative",
      threshold: "",
      late: "15",
    };
  }
  return {
    mode: policy.markingMode === "period_wise" ? "period_wise" : "daily",
    rule:
      policy.dailyStatusRule === "threshold_percentage"
        ? "threshold_percentage"
        : "homeroom_authoritative",
    threshold:
      policy.thresholdPercentage === null
        ? ""
        : String(policy.thresholdPercentage),
    late: String(policy.lateArrivalMinutes),
  };
}

export function validatePolicyForm(form: PolicyForm): PolicyFormErrors {
  const errors: PolicyFormErrors = {};

  if (form.rule === "threshold_percentage") {
    const text = form.threshold.trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || value < 1 || value > 100) {
      errors.threshold = copy.attendance.manage.policy.errors.threshold;
    }
  }

  const lateText = form.late.trim();
  const late = Number(lateText);
  if (!/^\d+$/.test(lateText) || late < 0 || late > 120) {
    errors.late = copy.attendance.manage.policy.errors.late;
  }

  return errors;
}

/**
 * The upsert payload. The threshold is sent only when the rule reads it and
 * is explicitly nulled on a homeroom rule — the form shows what will be
 * stored, so a stale number never lingers invisibly.
 */
export function toPolicyPayload(form: PolicyForm): {
  markingMode: MarkingMode;
  dailyStatusRule: DailyStatusRule;
  thresholdPercentage: number | null;
  lateArrivalMinutes: number;
} {
  return {
    markingMode: form.mode,
    dailyStatusRule: form.rule,
    thresholdPercentage:
      form.rule === "threshold_percentage"
        ? Number(form.threshold.trim())
        : null,
    lateArrivalMinutes: Number(form.late.trim()),
  };
}
