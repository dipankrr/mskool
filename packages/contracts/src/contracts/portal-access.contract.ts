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

export const activatePortalAccessInput = z.object({
  studentId: z.uuid(),
  phone: portalPhone,
  password: z.string().min(8, "At least 8 characters.").max(72),
});
export type ActivatePortalAccessInput = z.infer<typeof activatePortalAccessInput>;

export const resetPortalPasswordInput = z.object({
  studentId: z.uuid(),
  /**
   * The login to re-issue. A student may sit under several family logins
   * (ADR-008); naming none is only accepted when exactly one is active.
   */
  userId: z.uuid().optional(),
  password: z.string().min(8, "At least 8 characters.").max(72),
});
export type ResetPortalPasswordInput = z.infer<typeof resetPortalPasswordInput>;

export const changePortalPhoneInput = z.object({
  studentId: z.uuid(),
  userId: z.uuid().optional(),
  newPhone: portalPhone,
  reason: z.string().min(3, "Say why — the reason is recorded.").max(500),
});
export type ChangePortalPhoneInput = z.infer<typeof changePortalPhoneInput>;
