ALTER TABLE "class_subject_mappings" ADD COLUMN "counts_toward_result" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD COLUMN "is_graded_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ADR-031: existing mappings inherit the flags their subject carried, so no
-- school's result behaviour changes as a side effect of the move.
UPDATE "class_subject_mappings" m
SET "counts_toward_result" = s."counts_toward_result",
    "is_graded_only" = s."is_graded_only"
FROM "subjects" s
WHERE m."subject_id" = s."id";--> statement-breakpoint
ALTER TABLE "subjects" DROP COLUMN "counts_toward_result";--> statement-breakpoint
ALTER TABLE "subjects" DROP COLUMN "is_graded_only";