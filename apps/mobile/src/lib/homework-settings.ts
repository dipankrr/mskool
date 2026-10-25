import { copy } from "./copy";
import { SUBMISSION_TYPES } from "./homework";
import { isValidQuestionMarks, trimDecimal } from "./homework-questions";
import type { SubmissionType } from "./homework";

/**
 * The two configuration surfaces behind the homework tab's gear.
 *
 * Settings are a WHOLE-ROW concept on the server: a class override is not a
 * field patch, it replaces the school default entirely. The draft therefore
 * carries every editable value, and `settingsPayload` always sends the whole
 * row — sending only what changed would create an override whose untouched
 * fields silently fall back to platform defaults instead of the school's.
 *
 * File limits are deliberately absent from the draft: no homework upload path
 * exists in this build, so the screen leaves those columns untouched and says
 * so. A legacy `file` submission type stays visible and removable rather than
 * disappearing from a policy the school already saved.
 *
 * Rubric drafts mirror the create contract: at least one criterion, each with
 * at least one level. Levels are alternatives inside one criterion, so their
 * points are not summed across a rubric.
 */

export const MAX_LATE_WINDOW_HOURS = 720;
export const MAX_ASSIGNMENTS_PER_DAY = 20;
export const MAX_RUBRIC_NAME = 150;
export const MAX_RUBRIC_TEXT = 2000;
export const MAX_CRITERION_NAME = 150;
export const MAX_LEVEL_LABEL = 100;

export type SettingsValues = {
  allowedSubmissionTypes: SubmissionType[];
  studentsCanSubmit: boolean;
  parentsCanSubmit: boolean;
  maxFilesPerSubmission: number;
  maxFileSizeMb: number;
  allowedMimeTypes: string[] | null;
  defaultLatePolicy: "allowed" | "not_allowed";
  defaultLateWindowHours: number;
  maxAssignmentsPerDay: number | null;
  allowWeekendAssignments: boolean;
  questionsEnabled: boolean;
};

export type SettingsDraft = {
  allowedSubmissionTypes: SubmissionType[];
  studentsCanSubmit: boolean;
  parentsCanSubmit: boolean;
  defaultLatePolicy: "allowed" | "not_allowed";
  /** A form string: the field may be empty while being edited. */
  defaultLateWindowHours: string;
  /** Empty means "no cap", which is a real value, not a missing one. */
  maxAssignmentsPerDay: string;
  allowWeekendAssignments: boolean;
  questionsEnabled: boolean;
};

export type SettingsFieldErrors = Partial<
  Record<"submissionTypes" | "lateWindow" | "maxPerDay", string>
>;

export type SettingsCheck = {
  errors: SettingsFieldErrors;
  valid: boolean;
};

/** The editable values of an effective settings row, as form strings. */
export function settingsDraftFrom(values: SettingsValues): SettingsDraft {
  return {
    allowedSubmissionTypes: [...values.allowedSubmissionTypes],
    studentsCanSubmit: values.studentsCanSubmit,
    parentsCanSubmit: values.parentsCanSubmit,
    defaultLatePolicy: values.defaultLatePolicy,
    defaultLateWindowHours: String(values.defaultLateWindowHours),
    maxAssignmentsPerDay:
      values.maxAssignmentsPerDay === null
        ? ""
        : String(values.maxAssignmentsPerDay),
    allowWeekendAssignments: values.allowWeekendAssignments,
    questionsEnabled: values.questionsEnabled,
  };
}

/**
 * The row the upsert endpoint expects, minus the scope ids the screen adds.
 * File columns ride along unchanged; every editable field is present.
 */
export type SettingsPayload = {
  allowedSubmissionTypes: SubmissionType[];
  studentsCanSubmit: boolean;
  parentsCanSubmit: boolean;
  maxFilesPerSubmission: number;
  maxFileSizeMb: number;
  allowedMimeTypes: string[] | null;
  defaultLatePolicy: "allowed" | "not_allowed";
  defaultLateWindowHours: number;
  maxAssignmentsPerDay: number | null;
  allowWeekendAssignments: boolean;
  questionsEnabled: boolean;
};

export function settingsPayload(
  draft: SettingsDraft,
  values: SettingsValues,
): SettingsPayload {
  return {
    allowedSubmissionTypes: [...draft.allowedSubmissionTypes].sort(
      (a, b) => SUBMISSION_TYPES.indexOf(a) - SUBMISSION_TYPES.indexOf(b),
    ),
    studentsCanSubmit: draft.studentsCanSubmit,
    parentsCanSubmit: draft.parentsCanSubmit,
    // Not editable here: no upload path exists in this build.
    maxFilesPerSubmission: values.maxFilesPerSubmission,
    maxFileSizeMb: values.maxFileSizeMb,
    allowedMimeTypes: values.allowedMimeTypes,
    defaultLatePolicy: draft.defaultLatePolicy,
    defaultLateWindowHours: Number(draft.defaultLateWindowHours.trim()),
    maxAssignmentsPerDay:
      draft.maxAssignmentsPerDay.trim().length === 0
        ? null
        : Number(draft.maxAssignmentsPerDay.trim()),
    allowWeekendAssignments: draft.allowWeekendAssignments,
    questionsEnabled: draft.questionsEnabled,
  };
}

export function checkSettingsDraft(draft: SettingsDraft): SettingsCheck {
  const errors: SettingsFieldErrors = {};
  const text = copy.homework.settings;

  if (draft.allowedSubmissionTypes.length === 0) {
    errors.submissionTypes = text.submissionTypesError;
  }

  const hours = draft.defaultLateWindowHours.trim();
  if (!/^\d{1,3}$/.test(hours) || Number(hours) > MAX_LATE_WINDOW_HOURS) {
    errors.lateWindow = text.lateWindowError;
  }

  const cap = draft.maxAssignmentsPerDay.trim();
  if (
    cap.length > 0 &&
    (!/^\d{1,2}$/.test(cap) ||
      Number(cap) < 1 ||
      Number(cap) > MAX_ASSIGNMENTS_PER_DAY)
  ) {
    errors.maxPerDay = text.maxPerDayError;
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

/** Order-insensitive: toggling a type off and on is not an edit. */
export function settingsFingerprint(draft: SettingsDraft): string {
  return JSON.stringify({
    types: [...draft.allowedSubmissionTypes].sort(),
    studentsCanSubmit: draft.studentsCanSubmit,
    parentsCanSubmit: draft.parentsCanSubmit,
    defaultLatePolicy: draft.defaultLatePolicy,
    defaultLateWindowHours: draft.defaultLateWindowHours.trim(),
    maxAssignmentsPerDay: draft.maxAssignmentsPerDay.trim(),
    allowWeekendAssignments: draft.allowWeekendAssignments,
    questionsEnabled: draft.questionsEnabled,
  });
}

/**
 * The effective read model has no identity columns. The upsert response is a
 * full settings row, so the screen strips them before caching it under the
 * effective query — saving then shows the server's answer without a refetch
 * flash of the old values.
 */
export function effectiveFromRow(row: SettingsValues): SettingsValues {
  return {
    allowedSubmissionTypes: [...row.allowedSubmissionTypes],
    studentsCanSubmit: row.studentsCanSubmit,
    parentsCanSubmit: row.parentsCanSubmit,
    maxFilesPerSubmission: row.maxFilesPerSubmission,
    maxFileSizeMb: row.maxFileSizeMb,
    allowedMimeTypes: row.allowedMimeTypes,
    defaultLatePolicy: row.defaultLatePolicy,
    defaultLateWindowHours: row.defaultLateWindowHours,
    maxAssignmentsPerDay: row.maxAssignmentsPerDay,
    allowWeekendAssignments: row.allowWeekendAssignments,
    questionsEnabled: row.questionsEnabled,
  };
}

// ---------------------------------------------------------------------------
// Rubric drafts
// ---------------------------------------------------------------------------

let rubricKeySeed = 0;

/** Stable list identity for a draft row; never sent to the server. */
export function newRubricKey(prefix: "criterion" | "level"): string {
  rubricKeySeed += 1;
  return `${prefix}-${rubricKeySeed}`;
}

export type RubricLevelDraft = {
  key: string;
  label: string;
  points: string;
  description: string;
};

export type RubricCriterionDraft = {
  key: string;
  name: string;
  description: string;
  levels: RubricLevelDraft[];
};

export type RubricDraft = {
  name: string;
  description: string;
  criteria: RubricCriterionDraft[];
};

export function emptyLevelDraft(): RubricLevelDraft {
  return {
    key: newRubricKey("level"),
    label: "",
    // One point is the honest starting point for a level; the teacher can
    // still type any positive value.
    points: "1",
    description: "",
  };
}

export function emptyCriterionDraft(): RubricCriterionDraft {
  return {
    key: newRubricKey("criterion"),
    name: "",
    description: "",
    levels: [emptyLevelDraft()],
  };
}

export function emptyRubricDraft(): RubricDraft {
  return { name: "", description: "", criteria: [] };
}

export type RubricLevelErrors = {
  label?: string;
  points?: string;
  description?: string;
};

export type RubricCriterionErrors = {
  name?: string;
  description?: string;
  levels?: string;
  levelsByKey: Record<string, RubricLevelErrors>;
};

export type RubricCriterionCheck = {
  errors: RubricCriterionErrors;
  valid: boolean;
};

export function checkCriterionDraft(
  criterion: RubricCriterionDraft,
): RubricCriterionCheck {
  const text = copy.homework.rubrics;
  const errors: RubricCriterionErrors = { levelsByKey: {} };

  const name = criterion.name.trim();
  if (name.length === 0) errors.name = text.criterionNameError;
  else if (name.length > MAX_CRITERION_NAME) {
    errors.name = text.criterionNameTooLong;
  }

  if (criterion.description.length > MAX_RUBRIC_TEXT) {
    errors.description = text.criterionDescriptionTooLong;
  }

  if (criterion.levels.length === 0) {
    errors.levels = text.levelsError;
  }

  for (const level of criterion.levels) {
    const levelErrors: RubricLevelErrors = {};
    const label = level.label.trim();
    if (label.length === 0) levelErrors.label = text.levelLabelError;
    else if (label.length > MAX_LEVEL_LABEL) {
      levelErrors.label = text.levelLabelTooLong;
    }
    if (!isValidQuestionMarks(level.points)) {
      levelErrors.points = text.levelPointsError;
    }
    if (level.description.length > MAX_RUBRIC_TEXT) {
      levelErrors.description = text.levelDescriptionTooLong;
    }
    if (Object.keys(levelErrors).length > 0) {
      errors.levelsByKey[level.key] = levelErrors;
    }
  }

  return {
    errors,
    valid:
      Object.keys(errors).length === 1 &&
      Object.keys(errors.levelsByKey).length === 0,
  };
}

export type RubricDraftErrors = {
  name?: string;
  description?: string;
  criteria?: string;
};

export type RubricDraftCheck = {
  errors: RubricDraftErrors;
  criterionChecks: Record<string, RubricCriterionCheck>;
  valid: boolean;
};

export function checkRubricDraft(draft: RubricDraft): RubricDraftCheck {
  const text = copy.homework.rubrics;
  const errors: RubricDraftErrors = {};
  const criterionChecks: Record<string, RubricCriterionCheck> = {};

  const name = draft.name.trim();
  if (name.length === 0) errors.name = text.nameError;
  else if (name.length > MAX_RUBRIC_NAME) errors.name = text.nameTooLong;

  if (draft.description.length > MAX_RUBRIC_TEXT) {
    errors.description = text.descriptionTooLong;
  }

  if (draft.criteria.length === 0) errors.criteria = text.criteriaError;

  let criteriaValid = true;
  for (const criterion of draft.criteria) {
    const check = checkCriterionDraft(criterion);
    criterionChecks[criterion.key] = check;
    if (!check.valid) criteriaValid = false;
  }

  return {
    errors,
    criterionChecks,
    valid:
      Object.keys(errors).length === 0 &&
      criteriaValid &&
      draft.criteria.length > 0,
  };
}

/**
 * The one line the save footer shows when the rubric is not saveable. Field
 * errors stay beside their fields; this is the sentence that tells the teacher
 * where to look when the offending field is scrolled out of view.
 */
export function firstRubricError(check: RubricDraftCheck): string | null {
  if (check.errors.name) return check.errors.name;
  if (check.errors.description) return check.errors.description;
  if (check.errors.criteria) return check.errors.criteria;
  for (const criterion of Object.values(check.criterionChecks)) {
    if (criterion.errors.name) return criterion.errors.name;
    if (criterion.errors.levels) return criterion.errors.levels;
    for (const level of Object.values(criterion.errors.levelsByKey)) {
      if (level.label) return level.label;
      if (level.points) return level.points;
    }
  }
  return null;
}

export type RubricCreateValues = {
  name: string;
  description?: string;
  criteria: {
    name: string;
    description?: string;
    sortOrder: number;
    levels: {
      label: string;
      description?: string;
      points: string;
      sortOrder: number;
    }[];
  }[];
};

/** Whole rows, positions from list order — the create contract's shape. */
export function rubricCreatePayload(draft: RubricDraft): RubricCreateValues {
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    ...(description.length > 0 ? { description } : {}),
    criteria: draft.criteria.map((criterion, criterionIndex) => {
      const criterionDescription = criterion.description.trim();
      return {
        name: criterion.name.trim(),
        ...(criterionDescription.length > 0
          ? { description: criterionDescription }
          : {}),
        sortOrder: criterionIndex,
        levels: criterion.levels.map((level, levelIndex) => {
          const levelDescription = level.description.trim();
          return {
            label: level.label.trim(),
            ...(levelDescription.length > 0
              ? { description: levelDescription }
              : {}),
            points: trimDecimal(level.points),
            sortOrder: levelIndex,
          };
        }),
      };
    }),
  };
}

/** A criterion's level range, for the builder's one-glance summary. */
export function criterionPointsRange(
  criterion: Pick<RubricCriterionDraft, "levels">,
): { min: string; max: string } | null {
  const values = criterion.levels
    .map((level) => Number(level.points.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  return {
    min: trimDecimal(String(Math.min(...values))),
    max: trimDecimal(String(Math.max(...values))),
  };
}

export function rubricFingerprint(draft: RubricDraft): string {
  return JSON.stringify({
    name: draft.name.trim(),
    description: draft.description.trim(),
    criteria: draft.criteria.map((criterion) => ({
      name: criterion.name.trim(),
      description: criterion.description.trim(),
      levels: criterion.levels.map((level) => ({
        label: level.label.trim(),
        points: trimDecimal(level.points),
        description: level.description.trim(),
      })),
    })),
  });
}
