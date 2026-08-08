import { organizations, schools } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Zod schemas derived from the Drizzle tables, so a column change surfaces as a
 * validation-type error rather than drifting silently (see the type chain in
 * AGENTS.md).
 *
 * Zod 4: `z.email()`, not `z.string().email()`.
 */

export const organizationSelectSchema = createSelectSchema(organizations);
export type Organization = z.infer<typeof organizationSelectSchema>;

export const createOrganizationSchema = createInsertSchema(organizations, {
  name: z.string().min(2).max(255),
  legalName: z.string().min(2).max(255),
  // Lowercase, URL-safe, and immutable once issued — it can appear in
  // subdomains and third-party integrations.
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only."),
  email: z.email().optional(),
  phone: z.string().min(10).max(20).optional(),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN.")
    .optional(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, "Invalid pincode.")
    .optional(),
}).omit({
  id: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

// Slug is absent by construction: it is immutable, so it cannot be patched.
export const updateOrganizationSchema = createOrganizationSchema
  .omit({ slug: true })
  .partial();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const schoolSelectSchema = createSelectSchema(schools);
export type School = z.infer<typeof schoolSelectSchema>;

export const createSchoolSchema = createInsertSchema(schools, {
  name: z.string().min(2).max(255),
  legalName: z.string().min(2).max(255),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers, and hyphens only."),
  email: z.email().optional(),
  phone: z.string().min(10).max(20).optional(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, "Invalid pincode.")
    .optional(),
  udiseCode: z.string().length(11, "UDISE code is 11 digits.").optional(),
}).omit({
  id: true,
  // Comes from the authenticated scope, never from the client — accepting it as
  // input would let a caller create a school in someone else's tenant.
  organizationId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;

export const updateSchoolSchema = createSchoolSchema.partial();
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;
