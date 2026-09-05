-- =============================================================================
-- HAND-WRITTEN — drizzle-kit does not diff pgEnum VALUES, so enum additions
-- are invisible to `db:generate`. If migrations are ever regenerated,
-- RE-PASTE this. `db:verify` can name the enum's values.
--
-- Phase 5 (ADR-032): publishing results and correcting them afterwards are
-- consequential academic acts — they get the same append-only audit trail
-- authorization changes already had.
-- =============================================================================

ALTER TYPE "authz_audit_action" ADD VALUE IF NOT EXISTS 'result_published';--> statement-breakpoint
ALTER TYPE "authz_audit_action" ADD VALUE IF NOT EXISTS 'result_corrected';
