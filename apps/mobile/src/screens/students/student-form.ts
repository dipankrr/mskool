import type { CreateStudentInput, UpdateStudentInput } from "@repo/contracts";

import { todayIso } from "../../lib/format";
import { copy } from "../../lib/copy";

/**
 * The student form's logic, pure and testable — the same rules the server's
 * `createStudentSchema`/`updateStudentSchema` enforce, with the words this app
 * shows. The server stays the authority (ADR-048): this module prevents an
 * avoidable round-trip, not a hostile one.
 */

export type StudentGender = NonNullable<CreateStudentInput["gender"]>;
export type StudentBloodGroup = NonNullable<CreateStudentInput["bloodGroup"]>;

export type StudentForm = {
  admissionNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string | null;
  admissionDate: string | null;
  gender: StudentGender | null;
  bloodGroup: StudentBloodGroup | null;
  email: string;
  phone: string;
  nationality: string;
  religion: string;
  category: string;
  motherTongue: string;
  aadhaarNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  medicalConditions: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export type StudentFormField = keyof StudentForm;
export type StudentFormErrors = Partial<Record<StudentFormField, string>>;

/** A blank create form: nothing is assumed. */
export function emptyStudentForm(): StudentForm {
  return {
    admissionNumber: "",
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: null,
    admissionDate: null,
    gender: null,
    bloodGroup: null,
    email: "",
    phone: "",
    nationality: "",
    religion: "",
    category: "",
    motherTongue: "",
    aadhaarNumber: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    pincode: "",
    medicalConditions: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  };
}

/** The stored row back to the form; every nullable column becomes "" or null. */
export function studentFormFrom(
  student:
    | (Pick<
        CreateStudentInput,
        | "firstName"
        | "middleName"
        | "lastName"
        | "gender"
        | "email"
        | "phone"
        | "nationality"
        | "religion"
        | "category"
        | "motherTongue"
        | "aadhaarNumber"
        | "addressLine1"
        | "addressLine2"
        | "city"
        | "state"
        | "pincode"
        | "medicalConditions"
        | "emergencyContactName"
        | "emergencyContactPhone"
      > & {
        admissionNumber: string;
        dateOfBirth: string | null;
        admissionDate: string | null;
        bloodGroup: StudentBloodGroup | null;
      })
    | null,
): StudentForm {
  if (!student) return emptyStudentForm();
  return {
    admissionNumber: student.admissionNumber,
    firstName: student.firstName,
    middleName: student.middleName ?? "",
    lastName: student.lastName,
    dateOfBirth: student.dateOfBirth,
    admissionDate: student.admissionDate,
    gender: student.gender,
    bloodGroup: student.bloodGroup,
    email: student.email ?? "",
    phone: student.phone ?? "",
    nationality: student.nationality ?? "",
    religion: student.religion ?? "",
    category: student.category ?? "",
    motherTongue: student.motherTongue ?? "",
    aadhaarNumber: student.aadhaarNumber ?? "",
    addressLine1: student.addressLine1 ?? "",
    addressLine2: student.addressLine2 ?? "",
    city: student.city ?? "",
    state: student.state ?? "",
    pincode: student.pincode ?? "",
    medicalConditions: student.medicalConditions ?? "",
    emergencyContactName: student.emergencyContactName ?? "",
    emergencyContactPhone: student.emergencyContactPhone ?? "",
  };
}

/** Digits only for the identity numbers; nothing else is normalised as they type. */
export function normaliseStudentDigits(value: string): string {
  return value.replace(/\D/g, "");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PINCODE = /^[1-9][0-9]{5}$/;
const AADHAAR = /^[0-9]{12}$/;

const PHONE_MIN = 10;
const PHONE_MAX = 20;

export function validateStudentField(
  field: StudentFormField,
  form: StudentForm,
): string | undefined {
  switch (field) {
    case "admissionNumber": {
      const value = form.admissionNumber.trim();
      return value.length < 1 || value.length > 50
        ? copy.studentForm.errors.admissionNumber
        : undefined;
    }
    case "firstName": {
      const value = form.firstName.trim();
      return value.length < 1 || value.length > 100
        ? copy.studentForm.errors.firstName
        : undefined;
    }
    case "lastName": {
      const value = form.lastName.trim();
      return value.length < 1 || value.length > 100
        ? copy.studentForm.errors.lastName
        : undefined;
    }
    case "dateOfBirth": {
      if (!form.dateOfBirth) return copy.studentForm.errors.dateOfBirth;
      return form.dateOfBirth > todayIso()
        ? copy.studentForm.errors.dateOfBirthFuture
        : undefined;
    }
    case "gender":
      return form.gender ? undefined : copy.studentForm.errors.gender;
    case "email": {
      const value = form.email.trim();
      return value.length === 0 || EMAIL.test(value)
        ? undefined
        : copy.studentForm.errors.email;
    }
    case "phone": {
      const value = form.phone.trim();
      return value.length === 0 ||
        (value.length >= PHONE_MIN && value.length <= PHONE_MAX)
        ? undefined
        : copy.studentForm.errors.phone;
    }
    case "aadhaarNumber": {
      const value = form.aadhaarNumber.trim();
      return value.length === 0 || AADHAAR.test(value)
        ? undefined
        : copy.studentForm.errors.aadhaar;
    }
    case "pincode": {
      const value = form.pincode.trim();
      return value.length === 0 || PINCODE.test(value)
        ? undefined
        : copy.studentForm.errors.pincode;
    }
    case "emergencyContactPhone": {
      const value = form.emergencyContactPhone.trim();
      return value.length === 0 ||
        (value.length >= PHONE_MIN && value.length <= PHONE_MAX)
        ? undefined
        : copy.studentForm.errors.phone;
    }
    default:
      return undefined;
  }
}

const VALIDATED_FIELDS: StudentFormField[] = [
  "admissionNumber",
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "email",
  "phone",
  "aadhaarNumber",
  "pincode",
  "emergencyContactPhone",
];

export function validateStudentForm(form: StudentForm): StudentFormErrors {
  const errors: StudentFormErrors = {};
  for (const field of VALIDATED_FIELDS) {
    const error = validateStudentField(field, form);
    if (error) errors[field] = error;
  }
  return errors;
}

export function studentFormHasErrors(errors: StudentFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * A trimmed text value, or null when left empty: the contract's nullable
 * columns accept null (clears the stored value) but not "".
 */
function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The update payload. Omitted keys leave columns untouched; nullable columns
 * receive null when cleared (the contract accepts null there, not "").
 * `dateOfBirth`/`admissionDate`/`gender` are non-null in the contract's
 * update schema, so an empty value is omitted rather than nulled.
 */
export function studentUpdatePayload(form: StudentForm): UpdateStudentInput {
  return {
    firstName: form.firstName.trim(),
    middleName: text(form.middleName),
    lastName: form.lastName.trim(),
    ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
    ...(form.admissionDate ? { admissionDate: form.admissionDate } : {}),
    ...(form.gender ? { gender: form.gender } : {}),
    bloodGroup: form.bloodGroup,
    email: text(form.email),
    phone: text(form.phone),
    nationality: text(form.nationality),
    religion: text(form.religion),
    category: text(form.category),
    motherTongue: text(form.motherTongue),
    aadhaarNumber: text(form.aadhaarNumber),
    addressLine1: text(form.addressLine1),
    addressLine2: text(form.addressLine2),
    city: text(form.city),
    state: text(form.state),
    pincode: text(form.pincode),
    medicalConditions: text(form.medicalConditions),
    emergencyContactName: text(form.emergencyContactName),
    emergencyContactPhone: text(form.emergencyContactPhone),
  };
}

/** The create payload: the same shape plus the school-issued admission number. */
export function studentCreatePayload(form: StudentForm): CreateStudentInput {
  return {
    ...studentUpdatePayload(form),
    // validateStudentForm guarantees these before submit; the casts are the
    // seam between the form's nullable state and the create contract.
    firstName: form.firstName.trim() as string,
    lastName: form.lastName.trim() as string,
    dateOfBirth: form.dateOfBirth as string,
    gender: form.gender as NonNullable<StudentForm["gender"]>,
    admissionNumber: form.admissionNumber.trim(),
  };
}

/** Did the user change anything worth guarding on the way out? */
export function isStudentFormDirty(a: StudentForm, b: StudentForm): boolean {
  return (Object.keys(a) as StudentFormField[]).some((key) => a[key] !== b[key]);
}
