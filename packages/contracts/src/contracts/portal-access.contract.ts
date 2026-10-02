import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { studentPortalAccess } from "@repo/db/schema";

/**
 * PORTAL ACCESS — the family login's credential lifecycle (ADR-007).
 * The phone is the credential, so every input is treated as
 * takeover-sensitive: digits-only phone, a minimum password length that
 * mirrors better-auth's own floor (the service re-checks at the seam),
 * and a REQUIRED reason for the phone change — the audit row is the point.
 */

export const portalAccessSelectSchema = createSelectSchema(studentPortalAccess);
export type PortalAccess = z.infer<typeof portalAccessSelectSchema>;

/** Indian mobile numbers: 10 digits, spaces/hyphens stripped by the client. */
export const portalPhone = z
  .string()
  .regex(/^\d{10}$/, "A phone number is 10 digits.");

/**
 * GLOBAL PHONE IDENTITY (ADR-037). The family login's username is the
 * 10-digit guardian phone itself — no org slug, no school picker, one login
 * across schools and trusts. `userId` is text everywhere below (better-auth
 * ids are not uuids).
 *
 * Flow: admission (or staff) links a phone → link `pending` (no secret) →
 * parent claims from home with phone + admission-no + DOB → sets own
 * password. Staff never type passwords. A second kid (same or cross-org) is
 * a second link row on the same user, verified with *that* kid's pair — the
 * password is set once and never touched again.
 */

/** Raw phone as typed (spaces/hyphens tolerated) — normalized in the service. */
export const rawPhone = z.string().min(1).max(20);

const isoDateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

/** Staff links a guardian phone to a student. No password — pending only. */
export const ensurePortalLinkInput = z.object({
  studentId: z.uuid(),
  phone: portalPhone,
  guardianId: z.uuid().optional(),
});
export type EnsurePortalLinkInput = z.infer<typeof ensurePortalLinkInput>;

/**
 * First claim AND forgot-reset share one shape deliberately: no credential
 * yet → sets the first password; credential exists → re-sets it (sessions
 * revoked). The service answers both with the same uniform refusal so no
 * response tells which field missed.
 */
export const claimPortalAccessInput = z.object({
  phone: rawPhone,
  admissionNumber: z.string().min(1).max(50),
  dateOfBirth: isoDateOfBirth,
  password: z.string().min(8, "At least 8 characters.").max(72),
});
export type ClaimPortalAccessInput = z.infer<typeof claimPortalAccessInput>;

/** Activates one pending link on an already-signed-in login. No password. */
export const verifyPortalLinkInput = z.object({
  studentId: z.uuid(),
  admissionNumber: z.string().min(1).max(50),
  dateOfBirth: isoDateOfBirth,
});
export type VerifyPortalLinkInput = z.infer<typeof verifyPortalLinkInput>;

/** Staff revokes one login's access to one student. Flag, never delete. */
export const revokePortalLinkInput = z.object({
  studentId: z.uuid(),
  /** Text, not uuid — better-auth ids are text (see staff.contract.ts M10). */
  userId: z.string().min(1),
  reason: z.string().min(3, "Say why — the reason is recorded.").max(500).optional(),
});
export type RevokePortalLinkInput = z.infer<typeof revokePortalLinkInput>;

/** One link row as staff sees it: whose login, which state, secret or not. */
export const portalLinkStatusSchema = z.object({
  userId: z.string(),
  username: z.string(),
  guardianId: z.string().nullable(),
  isActive: z.boolean(),
  revokedAt: z.string().nullable(),
  hasCredential: z.boolean(),
});
export type PortalLinkStatus = z.infer<typeof portalLinkStatusSchema>;
