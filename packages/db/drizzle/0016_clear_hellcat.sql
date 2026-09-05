ALTER TABLE "class_subject_mappings" DROP COLUMN "counts_toward_result";--> statement-breakpoint
ALTER TABLE "class_subject_mappings" DROP COLUMN "is_graded_only";--> statement-breakpoint
ALTER TABLE "subjects" DROP COLUMN "category";--> statement-breakpoint
DROP TYPE "public"."subject_category";