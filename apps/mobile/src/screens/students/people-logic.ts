import type {
  AddGuardianInput,
  CreateEnrollmentInput,
  GuardianView,
} from "@repo/contracts";

import { copy } from "../../lib/copy";

/**
 * The people flows' logic (Step 2 chunk C): enrollment creation, guardian
 * add/edit payloads, and the enrollment transition map mirrored from the
 * service. The server stays the authority (ADR-048); this prevents avoidable
 * round-trips and keeps the transitions sheet honest.
 */

export type EnrollmentStatus =
  | "admitted"
  | "section_assigned"
  | "active"
  | "transferred_out"
  | "withdrawn"
  | "passed_out";

/** The service's legal map (enrollment.service ENROLLMENT_TRANSITIONS). */
export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  admitted: ["withdrawn"],
  section_assigned: ["active", "withdrawn"],
  active: ["transferred_out", "withdrawn", "passed_out"],
  transferred_out: [],
  withdrawn: [],
  passed_out: [],
};

export type EnrollmentForm = {
  classId: string | null;
  sectionId: string | null;
  rollNumber: string;
};

export function emptyEnrollmentForm(): EnrollmentForm {
  return { classId: null, sectionId: null, rollNumber: "" };
}

export function validateEnrollmentForm(
  form: EnrollmentForm,
  mode: "create" | "assign" | "labels",
): Partial<Record<keyof EnrollmentForm, string>> {
  const errors: Partial<Record<keyof EnrollmentForm, string>> = {};
  if (mode === "create" && !form.classId) {
    errors.classId = copy.people.enrollment.errors.class;
  }
  // Assign mode names a section; create makes it optional (admitted without
  // one). Label edits touch nothing structural.
  if (mode === "assign" && !form.sectionId) {
    errors.sectionId = copy.people.enrollment.errors.section;
  }
  const roll = form.rollNumber.trim();
  if (roll.length > 20) {
    errors.rollNumber = copy.people.enrollment.errors.roll;
  }
  return errors;
}

export function enrollmentCreatePayload(
  form: EnrollmentForm,
  ctx: { studentId: string; academicYearId: string },
): CreateEnrollmentInput {
  const roll = form.rollNumber.trim();
  return {
    studentId: ctx.studentId,
    academicYearId: ctx.academicYearId,
    classId: form.classId ?? "",
    ...(form.sectionId ? { sectionId: form.sectionId } : {}),
    ...(roll ? { rollNumber: roll } : {}),
  };
}

/** Label-only edit: the contract omits everything else. */
export function enrollmentLabelsPayload(form: EnrollmentForm): {
  rollNumber?: string;
} {
  const roll = form.rollNumber.trim();
  return roll ? { rollNumber: roll } : {};
}

// ---------------------------------------------------------------- guardians

export type GuardianForm = {
  firstName: string;
  lastName: string;
  relation: GuardianView["relation"] | null;
  phone: string;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  canAccessPortal: boolean;
};

export function emptyGuardianForm(): GuardianForm {
  return {
    firstName: "",
    lastName: "",
    relation: null,
    phone: "",
    isPrimary: false,
    isEmergencyContact: false,
    canAccessPortal: true,
  };
}

export function guardianFormFrom(row: GuardianView): GuardianForm {
  return {
    firstName: row.firstName,
    lastName: row.lastName ?? "",
    relation: row.relation,
    phone: row.phone,
    isPrimary: row.isPrimary,
    isEmergencyContact: row.isEmergencyContact,
    canAccessPortal: row.canAccessPortal,
  };
}

export const GUARDIAN_RELATIONS = [
  "father",
  "mother",
  "grandfather",
  "grandmother",
  "uncle",
  "aunt",
  "brother",
  "sister",
  "legal_guardian",
  "other",
] as const;

const PHONE_10 = /^\d{10}$/;

export function validateGuardianForm(
  form: GuardianForm,
): Partial<Record<keyof GuardianForm, string>> {
  const errors: Partial<Record<keyof GuardianForm, string>> = {};
  const first = form.firstName.trim();
  if (first.length < 1 || first.length > 100) {
    errors.firstName = copy.people.guardians.errors.firstName;
  }
  if (!form.relation) errors.relation = copy.people.guardians.errors.relation;
  if (!PHONE_10.test(form.phone.trim())) {
    errors.phone = copy.people.guardians.errors.phone;
  }
  return errors;
}

export function guardianPayload(form: GuardianForm): AddGuardianInput {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim() || null,
    relation: form.relation ?? "other",
    phone: form.phone.trim(),
    isPrimary: form.isPrimary,
    isEmergencyContact: form.isEmergencyContact,
    canAccessPortal: form.canAccessPortal,
  };
}

// ---------------------------------------------------------------- portal

const RELATION_LABEL_KEYS = copy.students.relations;

export function guardianRelationLabel(relation: GuardianView["relation"]): string {
  return RELATION_LABEL_KEYS[relation];
}
