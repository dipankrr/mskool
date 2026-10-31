import type {
  CreateClassInput,
  CreateSectionInput,
  CreateSectionTeacherAssignmentInput,
  CreateSubjectInput,
  CreateTermInput,
  UpdateClassInput,
  UpdateClassSubjectMappingInput,
  UpdateSectionInput,
  UpdateSubjectInput,
  UpdateTermInput,
} from "@repo/contracts";

import { copy } from "../../lib/copy";

/**
 * The academic setup forms' logic, pure and testable — the rules the server
 * schemas and the database enforce, with the words this app shows. The server
 * stays the authority (ADR-048); this prevents avoidable round-trips.
 */

export type SectionShift = NonNullable<CreateSectionInput["shift"]>;

const INT = /^-?\d+$/;

function optionalInt(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!INT.test(trimmed)) return null; // malformed — the field's error
  return Number(trimmed);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredText(value: string): string {
  return value.trim();
}

// ---------------------------------------------------------------- classes

export type ClassForm = { name: string; order: string; description: string };

export function emptyClassForm(): ClassForm {
  return { name: "", order: "", description: "" };
}

export function classFormFrom(row: {
  name: string;
  numericOrder: number;
  description: string | null;
}): ClassForm {
  return {
    name: row.name,
    order: String(row.numericOrder),
    description: row.description ?? "",
  };
}

export function validateClassForm(form: ClassForm): Partial<Record<keyof ClassForm, string>> {
  const errors: Partial<Record<keyof ClassForm, string>> = {};
  const name = requiredText(form.name);
  if (name.length < 1 || name.length > 100) {
    errors.name = copy.academic.classes.errors.name;
  }
  const order = optionalInt(form.order);
  if (
    order === null ||
    order === undefined ||
    !Number.isInteger(order) ||
    order < -10 ||
    order > 20
  ) {
    errors.order = copy.academic.classes.errors.order;
  }
  return errors;
}

export function classPayload(form: ClassForm): CreateClassInput {
  return {
    name: form.name.trim(),
    numericOrder: Number(form.order.trim()),
    ...(optionalText(form.description)
      ? { description: optionalText(form.description) }
      : {}),
  };
}

/** Update omits nothing the create payload has — every class column is patchable. */
export function classUpdatePayload(form: ClassForm): UpdateClassInput {
  return classPayload(form);
}

// ---------------------------------------------------------------- sections

export type SectionForm = {
  classId: string | null;
  name: string;
  shift: SectionShift | null;
  roomNumber: string;
  maxStudents: string;
  stream: string;
  house: string;
};

export function emptySectionForm(): SectionForm {
  return {
    classId: null,
    name: "",
    shift: null,
    roomNumber: "",
    maxStudents: "",
    stream: "",
    house: "",
  };
}

export function sectionFormFrom(row: {
  classId: string;
  name: string;
  shift: SectionShift | null;
  roomNumber: string | null;
  maxStudents: number | null;
  stream: string | null;
  house: string | null;
}): SectionForm {
  return {
    classId: row.classId,
    name: row.name,
    shift: row.shift,
    roomNumber: row.roomNumber ?? "",
    maxStudents: row.maxStudents === null ? "" : String(row.maxStudents),
    stream: row.stream ?? "",
    house: row.house ?? "",
  };
}

export function validateSectionForm(
  form: SectionForm,
): Partial<Record<keyof SectionForm, string>> {
  const errors: Partial<Record<keyof SectionForm, string>> = {};
  if (!form.classId) errors.classId = copy.academic.sections.errors.class;
  const name = requiredText(form.name);
  if (name.length < 1 || name.length > 50) {
    errors.name = copy.academic.sections.errors.name;
  }
  const max = optionalInt(form.maxStudents);
  if (max !== undefined && (max === null || max < 1 || max > 200)) {
    errors.maxStudents = copy.academic.sections.errors.maxStudents;
  }
  return errors;
}

export function sectionPayload(
  form: SectionForm,
  academicYearId: string,
): CreateSectionInput {
  const max = optionalInt(form.maxStudents);
  return {
    academicYearId,
    classId: form.classId ?? "",
    name: form.name.trim(),
    ...(form.shift ? { shift: form.shift } : {}),
    ...(optionalText(form.roomNumber)
      ? { roomNumber: optionalText(form.roomNumber) }
      : {}),
    ...(max !== undefined && max !== null ? { maxStudents: max } : {}),
    ...(optionalText(form.stream) ? { stream: optionalText(form.stream) } : {}),
    ...(optionalText(form.house) ? { house: optionalText(form.house) } : {}),
  };
}

export function sectionUpdatePayload(form: SectionForm): UpdateSectionInput {
  const max = optionalInt(form.maxStudents);
  return {
    name: form.name.trim(),
    ...(form.shift ? { shift: form.shift } : {}),
    ...(optionalText(form.roomNumber)
      ? { roomNumber: optionalText(form.roomNumber) }
      : {}),
    ...(max !== undefined && max !== null ? { maxStudents: max } : {}),
    ...(optionalText(form.stream) ? { stream: optionalText(form.stream) } : {}),
    ...(optionalText(form.house) ? { house: optionalText(form.house) } : {}),
  };
}

// ---------------------------------------------------------------- subjects

export type SubjectForm = { name: string; shortName: string; code: string };

export function emptySubjectForm(): SubjectForm {
  return { name: "", shortName: "", code: "" };
}

export function subjectFormFrom(row: {
  name: string;
  shortName: string | null;
  code: string | null;
}): SubjectForm {
  return {
    name: row.name,
    shortName: row.shortName ?? "",
    code: row.code ?? "",
  };
}

export function validateSubjectForm(
  form: SubjectForm,
): Partial<Record<keyof SubjectForm, string>> {
  const errors: Partial<Record<keyof SubjectForm, string>> = {};
  const name = requiredText(form.name);
  if (name.length < 1 || name.length > 150) {
    errors.name = copy.academic.subjects.errors.name;
  }
  return errors;
}

export function subjectPayload(form: SubjectForm): CreateSubjectInput {
  return {
    name: form.name.trim(),
    ...(optionalText(form.shortName)
      ? { shortName: optionalText(form.shortName) }
      : {}),
    ...(optionalText(form.code) ? { code: optionalText(form.code) } : {}),
  };
}

export function subjectUpdatePayload(form: SubjectForm): UpdateSubjectInput {
  return subjectPayload(form);
}

// ---------------------------------------------------------------- terms

export type TermForm = {
  name: string;
  sequence: string;
  startDate: string | null;
  endDate: string | null;
  weightage: string;
};

export function emptyTermForm(): TermForm {
  return {
    name: "",
    sequence: "",
    startDate: null,
    endDate: null,
    weightage: "100",
  };
}

export function termFormFrom(row: {
  name: string;
  sequenceNumber: number;
  startDate: string;
  endDate: string;
  weightage: string;
}): TermForm {
  return {
    name: row.name,
    sequence: String(row.sequenceNumber),
    startDate: row.startDate,
    endDate: row.endDate,
    // numeric(5,2) reads back as "100.00" — the editor shows the plain number.
    weightage: String(Number(row.weightage)),
  };
}

export function validateTermForm(
  form: TermForm,
): Partial<Record<keyof TermForm, string>> {
  const errors: Partial<Record<keyof TermForm, string>> = {};
  const name = requiredText(form.name);
  if (name.length < 1 || name.length > 100) {
    errors.name = copy.academic.terms.errors.name;
  }
  const sequence = optionalInt(form.sequence);
  if (sequence === null || sequence === undefined || sequence < 1 || sequence > 50) {
    errors.sequence = copy.academic.terms.errors.sequence;
  }
  if (!form.startDate) errors.startDate = copy.academic.terms.errors.startDate;
  if (!form.endDate) errors.endDate = copy.academic.terms.errors.endDate;
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    errors.endDate = copy.academic.terms.errors.dateOrder;
  }
  const weight = Number(form.weightage.trim());
  if (
    form.weightage.trim().length === 0 ||
    !Number.isFinite(weight) ||
    weight <= 0 ||
    weight > 100
  ) {
    errors.weightage = copy.academic.terms.errors.weightage;
  }
  return errors;
}

function weightageWire(form: TermForm): string {
  // numeric(5,2): the wire value is a fixed-point string the database scales.
  return Number(form.weightage.trim()).toFixed(2);
}

export function termPayload(form: TermForm, academicYearId: string): CreateTermInput {
  return {
    academicYearId,
    name: form.name.trim(),
    sequenceNumber: Number(form.sequence.trim()),
    startDate: form.startDate ?? "",
    endDate: form.endDate ?? "",
    weightage: weightageWire(form),
  };
}

export function termUpdatePayload(form: TermForm): UpdateTermInput {
  return {
    name: form.name.trim(),
    sequenceNumber: Number(form.sequence.trim()),
    startDate: form.startDate ?? "",
    endDate: form.endDate ?? "",
    weightage: weightageWire(form),
  };
}

// ---------------------------------------------------------------- mappings

export type MappingForm = {
  subjectId: string | null;
  isElective: boolean;
  sequence: string;
};

export function emptyMappingForm(): MappingForm {
  return { subjectId: null, isElective: false, sequence: "0" };
}

export function mappingFormFrom(row: {
  subjectId: string;
  isElective: boolean;
  sequenceNumber: number;
}): MappingForm {
  return {
    subjectId: row.subjectId,
    isElective: row.isElective,
    sequence: String(row.sequenceNumber),
  };
}

export function validateMappingForm(
  form: MappingForm,
): Partial<Record<keyof MappingForm, string>> {
  const errors: Partial<Record<keyof MappingForm, string>> = {};
  if (!form.subjectId) errors.subjectId = copy.academic.mappings.errors.subject;
  const sequence = optionalInt(form.sequence);
  if (sequence === null) errors.sequence = copy.academic.mappings.errors.sequence;
  return errors;
}

/** Update is elective + sequence only: the (year, class, subject) triple is not patchable. */
export function mappingUpdatePayload(
  form: MappingForm,
): UpdateClassSubjectMappingInput {
  const sequence = optionalInt(form.sequence);
  return {
    isElective: form.isElective,
    ...(sequence !== undefined && sequence !== null ? { sequenceNumber: sequence } : {}),
  };
}

// ---------------------------------------------------------------- assignments

export type AssignmentRole = NonNullable<
  CreateSectionTeacherAssignmentInput["role"]
>;

export type AssignmentForm = {
  userId: string | null;
  role: AssignmentRole;
  subjectId: string | null;
};

export function emptyAssignmentForm(): AssignmentForm {
  return { userId: null, role: "subject_teacher", subjectId: null };
}

export function validateAssignmentForm(
  form: AssignmentForm,
): Partial<Record<keyof AssignmentForm, string>> {
  const errors: Partial<Record<keyof AssignmentForm, string>> = {};
  if (!form.userId) errors.userId = copy.academic.assignments.errors.teacher;
  if (form.role === "subject_teacher" && !form.subjectId) {
    errors.subjectId = copy.academic.assignments.errors.subject;
  }
  if (form.role !== "subject_teacher" && form.subjectId) {
    errors.subjectId = copy.academic.assignments.errors.subjectForbidden;
  }
  return errors;
}

// The create input type lives in the assignment contract; named in the import
// at the top like the rest.

export function assignmentPayload(
  form: AssignmentForm,
  sectionId: string,
  academicYearId: string,
): CreateSectionTeacherAssignmentInput {
  return {
    sectionId,
    academicYearId,
    userId: form.userId ?? "",
    role: form.role,
    ...(form.role === "subject_teacher" && form.subjectId
      ? { subjectId: form.subjectId }
      : {}),
  };
}

// ---------------------------------------------------------------- dirty checks

export function isFormDirty<T extends Record<string, unknown>>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).some((key) => a[key] !== b[key]);
}
