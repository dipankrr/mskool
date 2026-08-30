import { terms } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * TERMS — the subdivisions of an academic year ("Term 1", "Full Year").
 *
 * Same derivation as the academic contracts: schemas come from the Drizzle
 * table via drizzle-zod, so a column change surfaces as a validation-type
 * error rather than drifting silently (the type chain in AGENTS.md).
 */

/**
 * Drizzle's `date()` yields a `string`, not a `Date` — a calendar date has no
 * time or zone to preserve. Validated as ISO `YYYY-MM-DD`, which is what
 * Postgres accepts and what the client sends. (Shared with
 * academic.contract.ts, which owns the rationale.)
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

export const termSelectSchema = createSelectSchema(terms);
export type Term = z.infer<typeof termSelectSchema>;

export const createTermSchema = createInsertSchema(terms, {
  // "Term 1", "First Term", "Full Year" — free text, like class names.
  name: z.string().min(1).max(100),
  // Ordering within the year; every year restarts at Term 1. Uniqueness with
  // the year is the database's (`terms_year_sequence_uq`, ADR-022), not
  // pre-checked here — a check between our SELECT and our INSERT would still
  // race.
  sequenceNumber: z.number().int().min(1).max(50),
  startDate: isoDate,
  endDate: isoDate,
  // `weightage` stays the drizzle-zod-derived string (numeric columns read
  // back as strings): the row-level bound is the database's
  // `terms_weightage_range` CHECK, and the year-sums-to-100 rule is a soft
  // invariant the term screen owns — see the schema comment for why no
  // single-row constraint can hold it.
})
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client. Accepting
    // them as input would let a caller write into another tenant.
    organizationId: true,
    schoolId: true,
    // Set by the caller's identity, not the payload (not yet wired to any
    // router — same gap as the assignment layer's createdBy).
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The term cannot end before it starts.",
    path: ["endDate"],
  });
export type CreateTermInput = z.infer<typeof createTermSchema>;

/**
 * The same rule the database enforces (`terms_end_after_start`, ADR-022),
 * restated for the field-level message. The database stays the authority.
 *
 * `academicYearId` is not patchable: moving a term between years would orphan
 * every exam schedule, attendance day, and fee installment already attached to
 * it (Phase 3–5 tables hang off terms), and the dates-within-year trigger
 * would refuse the move anyway once the children exist. A term in the wrong
 * year is deleted-and-recreated while it is still childless — which is also
 * why there is no update path for the year.
 */
export const updateTermSchema = createInsertSchema(terms, {
  name: z.string().min(1).max(100),
  sequenceNumber: z.number().int().min(1).max(50),
  startDate: isoDate,
  endDate: isoDate,
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    academicYearId: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "The term cannot end before it starts.",
    path: ["endDate"],
  });
export type UpdateTermInput = z.infer<typeof updateTermSchema>;
