-- =============================================================================
-- HAND-WRITTEN — drizzle-kit does not diff pgEnum VALUES, so enum additions
-- are invisible to `db:generate`. If migrations are ever regenerated,
-- RE-PASTE this. Follows the 0019 precedent (no snapshot entry).
--
-- Phase 5 fix: class tests need their own exam type. Like mocks, tests run
-- the full pipeline (entry → verify → publish) but never count toward the
-- term — `counts_toward_term_result` is forced false for both in
-- `examConfigService.createExam`, so the enum value alone carries no
-- scoring meaning until a row uses it.
-- =============================================================================

ALTER TYPE "exam_type" ADD VALUE IF NOT EXISTS 'test';
