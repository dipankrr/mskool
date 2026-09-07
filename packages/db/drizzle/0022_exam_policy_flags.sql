-- =============================================================================
-- HAND-WRITTEN — two NOT NULL ... DEFAULT columns are trivially diffable,
-- but this migration rides with the 0019/0021 hand-written precedent to
-- keep Phase 5 policy changes in one visible place. If migrations are ever
-- regenerated, RE-PASTE this.
--
-- Phase 5 fix (commit 4): absence/exemption semantics become school policy
-- instead of hardcoded engine behavior. Defaults preserve history:
-- absent-mandatory-fails ON (the engine always failed these), exemption
-- renormalization OFF (the engine always scored zero's effect) — no
-- existing year's numbers move until its school opts in.
-- =============================================================================

ALTER TABLE "pass_criteria" ADD COLUMN IF NOT EXISTS "absent_mandatory_fails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_criteria" ADD COLUMN IF NOT EXISTS "exempt_renormalizes" boolean DEFAULT false NOT NULL;
