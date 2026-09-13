import { staff } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

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

export const createStaffSchema = createInsertSchema(staff, {
  // School-issued, unique per org (`staff_org_employee_code_uq`, refused by
  // the database per ADR-022, not pre-checked here).
  employeeCode: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: isoDate,
  dateOfJoining: isoDate,
  phone: z.string().min(5).max(20).nullish(),
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
  dateOfBirth: isoDate,
  dateOfJoining: isoDate,
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
});
export type DeactivateStaffInput = z.infer<typeof deactivateStaffSchema>;

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
