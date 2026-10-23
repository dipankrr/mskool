import type { CreateSchoolInput } from "@repo/contracts";

import { copy } from "../../lib/copy";

/**
 * The branch form's logic, pure and testable — the same rules the server's
 * `createSchoolSchema` enforces, with the words this app shows. The server
 * stays the authority (ADR-048): this module prevents an avoidable round-trip,
 * not a hostile one.
 */

export type BranchBoard = NonNullable<CreateSchoolInput["board"]>;

export type BranchForm = {
  name: string;
  legalName: string;
  code: string;
  board: BranchBoard;
  email: string;
  phone: string;
  city: string;
  state: string;
  pincode: string;
  udiseCode: string;
};

export type BranchFormField = keyof BranchForm;
export type BranchFormErrors = Partial<Record<BranchFormField, string>>;

/** A blank create form: the board defaults to CBSE, as the column does. */
export function emptyBranchForm(): BranchForm {
  return {
    name: "",
    legalName: "",
    code: "",
    board: "cbse",
    email: "",
    phone: "",
    city: "",
    state: "",
    pincode: "",
    udiseCode: "",
  };
}

/** The stored row back to the form; every nullable column becomes "". */
export function branchFormFrom(
  branch:
    | {
        name: string;
        legalName: string;
        code: string;
        board: BranchBoard;
        email: string | null;
        phone: string | null;
        city: string | null;
        state: string | null;
        pincode: string | null;
        udiseCode: string | null;
      }
    | null,
): BranchForm {
  if (!branch) return emptyBranchForm();
  return {
    name: branch.name,
    legalName: branch.legalName,
    code: branch.code,
    board: branch.board,
    email: branch.email ?? "",
    phone: branch.phone ?? "",
    city: branch.city ?? "",
    state: branch.state ?? "",
    pincode: branch.pincode ?? "",
    udiseCode: branch.udiseCode ?? "",
  };
}

/** Uppercase as they type: the contract wants capitals, not a correction later. */
export function normaliseBranchCode(value: string): string {
  return value.toUpperCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[A-Z0-9-]+$/;
const PINCODE = /^[1-9][0-9]{5}$/;
const UDISE = /^[0-9]{11}$/;

export function validateBranchField(
  field: BranchFormField,
  form: BranchForm,
): string | undefined {
  const value = form[field].trim();

  switch (field) {
    case "name":
      return value.length < 2 ? copy.branches.errors.name : undefined;
    case "legalName":
      return value.length < 2 ? copy.branches.errors.legalName : undefined;
    case "code":
      if (value.length === 0) return copy.branches.errors.code;
      return CODE.test(value) ? undefined : copy.branches.errors.codeFormat;
    case "email":
      return value.length === 0 || EMAIL.test(value)
        ? undefined
        : copy.branches.errors.email;
    case "phone":
      return value.length === 0 || (value.length >= 10 && value.length <= 20)
        ? undefined
        : copy.branches.errors.phone;
    case "pincode":
      return value.length === 0 || PINCODE.test(value)
        ? undefined
        : copy.branches.errors.pincode;
    case "udiseCode":
      return value.length === 0 || UDISE.test(value)
        ? undefined
        : copy.branches.errors.udiseCode;
    case "board":
    case "city":
    case "state":
      return undefined;
  }
}

export function validateBranchForm(form: BranchForm): BranchFormErrors {
  const fields: BranchFormField[] = [
    "name",
    "legalName",
    "code",
    "email",
    "phone",
    "pincode",
    "udiseCode",
  ];
  const errors: BranchFormErrors = {};
  for (const field of fields) {
    const error = validateBranchField(field, form);
    if (error) errors[field] = error;
  }
  return errors;
}

export function branchFormHasErrors(errors: BranchFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * The mutation payload. Empty optionals are omitted, never sent as `""` — the
 * contract rejects an empty email, and an omitted key leaves an untouched
 * column alone.
 */
export function branchPayload(form: BranchForm): CreateSchoolInput {
  const email = form.email.trim();
  const phone = form.phone.trim();
  const city = form.city.trim();
  const state = form.state.trim();
  const pincode = form.pincode.trim();
  const udiseCode = form.udiseCode.trim();

  return {
    name: form.name.trim(),
    legalName: form.legalName.trim(),
    code: normaliseBranchCode(form.code.trim()),
    board: form.board,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(pincode ? { pincode } : {}),
    ...(udiseCode ? { udiseCode } : {}),
  };
}

/** Did the user change anything worth guarding on the way out? */
export function isBranchFormDirty(a: BranchForm, b: BranchForm): boolean {
  return (Object.keys(a) as BranchFormField[]).some((key) => a[key] !== b[key]);
}
