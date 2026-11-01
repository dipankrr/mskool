import type { AddGuardianInput, GuardianView } from "@repo/contracts";

import { copy } from "../../lib/copy";
import { normaliseStudentDigits, validateStudentField, validateStudentForm } from "./student-form";
import type { StudentForm, StudentFormErrors, StudentFormField } from "./student-form";

/**
 * The admit flow's logic, pure and testable (plan
 * `.kilo/plans/2026-11-01-admit-flow.md`). The server stays the authority
 * (ADR-022, ADR-048): everything here only moves a refusal earlier, to the step
 * that can fix it.
 */

export type AdmitStep = "student" | "class" | "family" | "review";

/**
 * The journey for this caller. A step whose write the account cannot make is
 * not offered at all, so nobody fills in a screen that can only be refused.
 */
export function admitSteps(can: { enroll: boolean; addFamily: boolean }): AdmitStep[] {
  return [
    "student",
    ...(can.enroll ? (["class"] as const) : []),
    ...(can.addFamily ? (["family"] as const) : []),
    "review",
  ];
}

/** The minimum a person must have before the desk can move on. */
export const STUDENT_STEP_FIELDS: StudentFormField[] = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "admissionNumber",
];

/** Just enough of a register row for the checks below. */
export type RegisterRow = {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  createdAt: Date | string;
};

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The active student already holding this number, if the register has one. */
export function findAdmissionClash(
  admissionNumber: string,
  register: readonly RegisterRow[],
): RegisterRow | null {
  if (!admissionNumber.trim()) return null;
  return register.find((row) => sameText(row.admissionNumber, admissionNumber)) ?? null;
}

/**
 * Someone with the same name and birth date. Only ever a caution, because twins
 * and namesakes are real: the desk decides.
 */
export function findPossibleDuplicate(
  form: Pick<StudentForm, "firstName" | "lastName" | "dateOfBirth">,
  register: readonly RegisterRow[],
): RegisterRow | null {
  if (!form.dateOfBirth || !form.firstName.trim() || !form.lastName.trim()) return null;
  return (
    register.find(
      (row) =>
        row.dateOfBirth === form.dateOfBirth &&
        sameText(row.firstName, form.firstName) &&
        sameText(row.lastName, form.lastName),
    ) ?? null
  );
}

/**
 * The next number after the newest admission: `2026-014` gives `2026-015`, with
 * the zero padding kept. Null when the newest number has no trailing digits,
 * since a guess at a school's format would be worse than none. Offered, never
 * filled in: the number is permanent, so using it is the desk's decision.
 */
export function suggestAdmissionNumber(
  register: readonly RegisterRow[],
  /** A number the server refused: it belongs to a student the register doesn't list. */
  refused?: string,
): string | null {
  if (register.length === 0) return null;
  const newest = register.reduce((latest, row) =>
    new Date(row.createdAt).getTime() > new Date(latest.createdAt).getTime() ? row : latest,
  );
  const match = /^(.*?)(\d+)$/.exec(newest.admissionNumber.trim());
  if (!match) return null;
  const [, prefix = "", digits = ""] = match;
  const taken = new Set(register.map((row) => row.admissionNumber.trim().toLowerCase()));
  if (refused) taken.add(refused.trim().toLowerCase());
  let next = Number(digits);
  // Step past numbers already used; the register is finite, so this ends.
  while (true) {
    next += 1;
    const candidate = `${prefix}${String(next).padStart(digits.length, "0")}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function validateStudentStep(
  form: StudentForm,
  register: readonly RegisterRow[],
): StudentFormErrors {
  const errors: StudentFormErrors = {};
  for (const field of STUDENT_STEP_FIELDS) {
    const error = validateStudentField(field, form);
    if (error) errors[field] = error;
  }
  const clash = findAdmissionClash(form.admissionNumber, register);
  if (clash && !errors.admissionNumber) {
    errors.admissionNumber = copy.admit.student.numberTaken(
      `${clash.firstName} ${clash.lastName}`,
    );
  }
  return errors;
}

/** Every student field, for the full form and the last check before saving. */
export function validateFullStudent(
  form: StudentForm,
  register: readonly RegisterRow[],
): StudentFormErrors {
  return { ...validateStudentForm(form), ...validateStudentStep(form, register) };
}

const MORE_GROUPS = {
  contact: ["phone", "email"],
  address: ["addressLine1", "addressLine2", "city", "state", "pincode"],
  health: ["bloodGroup", "medicalConditions", "emergencyContactName", "emergencyContactPhone"],
  background: ["nationality", "religion", "category", "motherTongue", "aadhaarNumber"],
} as const satisfies Record<string, readonly StudentFormField[]>;

export type MoreGroup = keyof typeof MORE_GROUPS;

const MORE_GROUP_NAMES = Object.keys(MORE_GROUPS) as MoreGroup[];

/** The optional groups something was typed into, so Check can show they exist. */
export function filledMoreGroups(form: StudentForm): MoreGroup[] {
  return MORE_GROUP_NAMES.filter((group) =>
    MORE_GROUPS[group].some((field) => Boolean(form[field]?.trim())),
  );
}

/** Which parts of a long form hold an error, since most are off screen. */
export function fullFormProblems(
  studentErrors: StudentFormErrors,
  familyErrors: object,
): ("student" | "family" | MoreGroup)[] {
  const inMoreGroups = new Set<StudentFormField>(
    MORE_GROUP_NAMES.flatMap((group) => [...MORE_GROUPS[group]]),
  );
  const fields = Object.keys(studentErrors) as StudentFormField[];
  return [
    ...(fields.some((field) => !inMoreGroups.has(field)) ? (["student"] as const) : []),
    ...(Object.keys(familyErrors).length > 0 ? (["family"] as const) : []),
    ...MORE_GROUP_NAMES.filter((group) =>
      MORE_GROUPS[group].some((field) => fields.includes(field)),
    ),
  ];
}

/** The server's refusal for a used number: send the desk back to that field. */
export function isAdmissionNumberRefusal(message: string): boolean {
  return /admission number/i.test(message);
}

// -------------------------------------------------------------------- family

export type FamilySlot = "father" | "mother" | "other";
export type GuardianRelation = GuardianView["relation"];

export type FamilyMember = { name: string; phone: string };

export type FamilyForm = {
  father: FamilyMember;
  mother: FamilyMember;
  other: FamilyMember;
  /** The other guardian's relation; father and mother carry their own. */
  otherRelation: GuardianRelation | null;
  /** Who the school calls first, once two or more people are recorded. */
  primary: FamilySlot | null;
};

export const FAMILY_SLOTS: FamilySlot[] = ["father", "mother", "other"];

export function emptyFamilyForm(): FamilyForm {
  return {
    father: { name: "", phone: "" },
    mother: { name: "", phone: "" },
    other: { name: "", phone: "" },
    otherRelation: null,
    primary: null,
  };
}

/**
 * Digits only, and a pasted `+91` or `91` prefix comes off. A 10-digit number
 * that merely starts with 91 stays whole.
 */
export function normaliseParentPhone(value: string): string {
  const digits = normaliseStudentDigits(value);
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
}

function isBlank(member: FamilyMember): boolean {
  return !member.name.trim() && !member.phone.trim();
}

export function filledSlots(family: FamilyForm): FamilySlot[] {
  return FAMILY_SLOTS.filter((slot) => !isBlank(family[slot]));
}

export function relationFor(slot: FamilySlot, family: FamilyForm): GuardianRelation {
  return slot === "other" ? (family.otherRelation ?? "other") : slot;
}

/** The chosen first contact, falling back to the first person recorded. */
export function primarySlot(family: FamilyForm): FamilySlot | null {
  const filled = filledSlots(family);
  return family.primary && filled.includes(family.primary)
    ? family.primary
    : (filled[0] ?? null);
}

export type FamilyField = `${FamilySlot}.${"name" | "phone"}` | "otherRelation";
export type FamilyErrors = Partial<Record<FamilyField, string>>;

const PHONE_10 = /^\d{10}$/;

/**
 * Nobody is required, but a person needs both a name and a phone. One number
 * can't be recorded twice here: guardians are keyed by phone, so the server
 * would link the same person again and refuse the second save.
 */
export function validateFamilyStep(family: FamilyForm): FamilyErrors {
  const errors: FamilyErrors = {};
  const phonesSeen = new Map<string, FamilySlot>();

  for (const slot of filledSlots(family)) {
    const member = family[slot];
    const phone = member.phone.trim();
    if (!member.name.trim()) errors[`${slot}.name`] = copy.admit.family.nameRequired;
    if (!PHONE_10.test(phone)) {
      errors[`${slot}.phone`] = copy.admit.family.phoneRequired;
      continue;
    }
    const firstUse = phonesSeen.get(phone);
    if (firstUse) {
      errors[`${slot}.phone`] = copy.admit.family.phoneRepeated(copy.admit.family.slots[firstUse]);
    } else {
      phonesSeen.set(phone, slot);
    }
  }
  if (!isBlank(family.other) && !family.otherRelation) {
    errors.otherRelation = copy.people.guardians.errors.relation;
  }
  return errors;
}

export type PlannedGuardian = { slot: FamilySlot; payload: AddGuardianInput };

/** Each recorded person as a `guardian.add` body, exactly one marked primary. */
export function familyPayloads(family: FamilyForm): PlannedGuardian[] {
  const primary = primarySlot(family);
  return filledSlots(family).map((slot) => ({
    slot,
    payload: {
      firstName: family[slot].name.trim(),
      lastName: null,
      relation: relationFor(slot, family),
      phone: family[slot].phone.trim(),
      isPrimary: slot === primary,
      isEmergencyContact: false,
      canAccessPortal: true,
    },
  }));
}

// --------------------------------------------------------------------- class

/** Students a section currently holds, so the desk can see which has room. */
export function sectionStrength(
  rows: readonly { enrollment: { sectionId: string | null; enrollmentStatus: string } }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { enrollment } of rows) {
    if (!enrollment.sectionId) continue;
    if (
      enrollment.enrollmentStatus === "withdrawn" ||
      enrollment.enrollmentStatus === "expelled" ||
      enrollment.enrollmentStatus === "transferred_out"
    ) {
      continue;
    }
    counts.set(enrollment.sectionId, (counts.get(enrollment.sectionId) ?? 0) + 1);
  }
  return counts;
}

export function studentFullName(
  form: Pick<StudentForm, "firstName" | "middleName" | "lastName">,
): string {
  return [form.firstName, form.middleName, form.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
