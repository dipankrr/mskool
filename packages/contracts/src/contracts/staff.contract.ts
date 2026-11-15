import { staff } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { imageRefSchema } from "./storage.contract";

/**
 * STAFF — the employment register (ADR-008). The row is the EMPLOYMENT
 * identity; a login is a separate, later act (ADR-035) — `userId` is
 * provisioned by the login endpoints, never by the admission-style create
 * below, and never editable as a field.
 *
 * Same derivation as the student contract: schemas come from the Drizzle
 * table via drizzle-zod, so a column change surfaces as a validation-type
 * error rather than drifting silently (the type chain in AGENTS.md).
 */

/**
 * Drizzle's `date()` yields a `string`, not a `Date` — a calendar date has no
 * time or zone to preserve. Validated as ISO `YYYY-MM-DD`. (Shared with
 * academic.contract.ts, which owns the rationale.)
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

export const staffSelectSchema = createSelectSchema(staff);
export type Staff = z.infer<typeof staffSelectSchema>;

/** A staff row with its photo, ready to show (ADR-068); null without one. */
export const staffWithPhotoSchema = staffSelectSchema.extend({
  photo: imageRefSchema.nullable(),
  /** Where they stand with the app (ADR-068): joined, invited, or not yet. */
  joinState: z.enum(["joined", "invited", "not_invited"]),
});
export type StaffWithPhoto = z.infer<typeof staffWithPhotoSchema>;

const teachingSectionSchema = z.object({ className: z.string(), sectionName: z.string() });

/** A staff list row: the staff row plus what they teach this session. */
export const staffListItemSchema = staffWithPhotoSchema.extend({
  teaching: z.object({
    classTeacherOf: teachingSectionSchema.nullable(),
    subjects: z.array(z.object({ subjectName: z.string(), sections: z.array(teachingSectionSchema) })),
  }),
});

export const createStaffSchema = createInsertSchema(staff, {
  // School-issued, unique per org (`staff_org_employee_code_uq`, refused by
  // the database per ADR-022, not pre-checked here). Left out, the service
  // suggests the next "EMP-###" (ADR-068).
  employeeCode: z.string().max(50).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  // A school hires first and fills the rest in — dates are optional, unlike
  // the student contract's admission-time DOB.
  dateOfBirth: isoDate.optional(),
  dateOfJoining: isoDate.optional(),
  // ADR-068: the phone is the staff sign-in, so it is required. The service
  // normalises it to 10 digits and refuses a number already in use.
  phone: z.string().min(10).max(20),
  email: z.email().nullish(),
  pincode: z
    .string()
    .regex(/^\d{6}$/, "A pincode is 6 digits.")
    .nullish(),
})
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client. Accepting
    // them as input would let a caller write into another tenant.
    organizationId: true,
    schoolId: true,
    // The login link is ADR-035's provisioning act, not a form field.
    userId: true,
    // The life cycle is the deactivate operation's job (hard rule 2: a
    // resigned teacher is `resigned`, never deleted — she must stay resolvable
    // as the author of last year's attendance and marks).
    status: true,
    dateOfLeaving: true,
    createdAt: true,
    updatedAt: true,
  });
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Demographics, contact, and posting details are correctable; identity is
 * not. `employeeCode` is deliberately absent — school-issued and permanent,
 * referenced by payslips and registers. `status` and `dateOfLeaving` are
 * deliberately absent — leaving is the deactivate operation, not a field
 * edit (hard rule 2). `userId` is deliberately absent — logins are
 * provisioned, never relinked by hand.
 */
export const updateStaffSchema = createInsertSchema(staff, {
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: isoDate.optional(),
  dateOfJoining: isoDate.optional(),
  phone: z.string().min(5).max(20).nullish(),
  email: z.email().nullish(),
  pincode: z
    .string()
    .regex(/^\d{6}$/, "A pincode is 6 digits.")
    .nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    employeeCode: true,
    userId: true,
    status: true,
    dateOfLeaving: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

/**
 * The register's soft delete (hard rule 2) records WHY the employment ends.
 * `on_leave` is a field edit, not a departure, and is deliberately not
 * offered here; `dateOfLeaving` is stamped by the service for the terminal
 * statuses.
 */
export const deactivateStaffSchema = z.object({
  status: z.enum(["suspended", "resigned", "retired", "terminated"]),
  /** Why, for a suspension: shown on the profile, cleared when lifted. */
  note: z.string().max(500).nullish(),
});
export type DeactivateStaffInput = z.infer<typeof deactivateStaffSchema>;

/** On leave and back (2026-11-15). Leave keeps the sign-in and classes. */
export const setStaffLeaveSchema = z.object({
  onLeave: z.boolean(),
  /** The day they're due back, if known. */
  until: isoDate.nullish(),
  note: z.string().max(500).nullish(),
});
export type SetStaffLeaveInput = z.infer<typeof setStaffLeaveSchema>;

/** Move to another branch of the same organisation. */
export const moveStaffSchema = z.object({
  toSchoolId: z.uuid(),
});

/** What a staff export includes beyond name, code, job title and phone. */
export const staffExportSchema = z.object({
  teaching: z.boolean().default(true),
  roles: z.boolean().default(true),
  personal: z.boolean().default(false),
  includeLeft: z.boolean().default(false),
});
export type StaffExportInput = z.infer<typeof staffExportSchema>;

/**
 * LOGIN PROVISIONING (ADR-035). The initial password is a hand-off secret:
 * the admin reads it out, the staff member must change it at first sign-in
 * (`mustChangePassword` is set by the service, never accepted as input).
 * Length mirrors better-auth's own floor; the seam re-checks.
 */
export const createStaffLoginInput = z.object({
  password: z.string().min(8, "At least 8 characters.").max(72),
});
export type CreateStaffLoginInput = z.infer<typeof createStaffLoginInput>;

export const resetStaffLoginInput = z.object({
  password: z.string().min(8, "At least 8 characters.").max(72),
});
export type ResetStaffLoginInput = z.infer<typeof resetStaffLoginInput>;

// ── Phone sign-in (ADR-068) ────────────────────────────────────────────────

/** The public join: phone + the office's 6-digit code + a new password. */
export const joinStaffInput = z.object({
  phone: z.string().min(10).max(20),
  code: z.string().min(6).max(12),
  password: z.string().min(8, "At least 8 characters.").max(72),
});
export type JoinStaffInput = z.infer<typeof joinStaffInput>;

/** What the office gets back from an invite: the code, shown once. */
export const staffInviteSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  organizationName: z.string(),
  resetsPassword: z.boolean(),
});
export type StaffInvite = z.infer<typeof staffInviteSchema>;

/** The add form's live phone check (frame 06). */
export const staffPhoneCheckSchema = z.object({
  state: z.enum(["invalid", "free", "here", "elsewhere"]),
  name: z.string().nullable(),
});

/** The add form's suggestions (frame 06). */
export const staffFormHintsSchema = z.object({
  designations: z.array(z.string()),
  nextEmployeeCode: z.string(),
});
