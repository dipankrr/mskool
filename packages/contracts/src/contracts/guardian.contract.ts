import { z } from "zod";

import { portalPhone } from "./portal-access.contract";

/**
 * GUARDIANS — the parents' contact truth (ADR-037's follow-up: kill the
 * typed-digits box).
 *
 * `guardians` rows are org-scoped contact records (ADR-006: no login);
 * `student_guardians` ties them to students with a relation and three flags.
 * The family login follows automatically: saving a portal-enabled phone
 * creates the pending link, so staff never type digits into a credential
 * UI again. Phone corrections and the portal-access toggle move the links;
 * this package only shapes the inputs.
 */

export const guardianRelation = z.enum([
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
]);
export type GuardianRelation = z.infer<typeof guardianRelation>;

/** One parent on the admission form / student profile. */
export const addGuardianInput = z.object({
  firstName: z.string().trim().min(1, "Name is required").max(100),
  lastName: z.string().trim().max(100).nullish(),
  relation: guardianRelation,
  phone: portalPhone,
  isPrimary: z.boolean().default(false),
  isEmergencyContact: z.boolean().default(false),
  /** Off means no login may hang off this guardian (custody). */
  canAccessPortal: z.boolean().default(true),
});
export type AddGuardianInput = z.infer<typeof addGuardianInput>;

/**
 * Corrections: identity is stable, contact is not. Phones move logins.
 *
 * NOTE the missing `studentId`: row-addressed routers name the student
 * `id` (the builder extends every such input with it — see staff.update),
 * so the contract carries only the guardian half and the router maps
 * `input.id` to the service's `studentId`.
 */
export const updateGuardianInput = z.object({
  guardianId: z.uuid(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).nullish(),
  relation: guardianRelation.optional(),
  phone: portalPhone.optional(),
  isPrimary: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  canAccessPortal: z.boolean().optional(),
});
export type UpdateGuardianInput = z.infer<typeof updateGuardianInput>;

/** Closing a relation (custody change, correction): history, not delete. */
export const detachGuardianInput = z.object({
  guardianId: z.uuid(),
  reason: z.string().min(3, "Say why — the reason is recorded.").max(500).optional(),
});
export type DetachGuardianInput = z.infer<typeof detachGuardianInput>;

/**
 * One guardian as the profile reads it, with the login state inline so the
 * UI never joins client-side: which phone, whose, and whether the family
 * has claimed it yet.
 */
export const guardianViewSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  relation: guardianRelation,
  phone: z.string(),
  isPrimary: z.boolean(),
  isEmergencyContact: z.boolean(),
  canAccessPortal: z.boolean(),
  endedOn: z.string().nullable(),
  portal: z
    .object({
      username: z.string(),
      isActive: z.boolean(),
      hasCredential: z.boolean(),
    })
    .nullable(),
});
export type GuardianView = z.infer<typeof guardianViewSchema>;
