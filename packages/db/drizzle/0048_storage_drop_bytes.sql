-- ADR-063: stored files are discarded, not migrated. Bytes move to S3-compatible
-- buckets and the rows below only ever held development data. Clear every
-- reference first (the foreign keys refuse otherwise), then the objects.
UPDATE "fee_print_settings" SET "logo_object_id" = NULL, "upi_image_object_id" = NULL, "upi_mode" = CASE WHEN "upi_mode" = 'image' THEN 'off'::"fee_print_upi_mode" ELSE "upi_mode" END;--> statement-breakpoint
DELETE FROM "student_photos";--> statement-breakpoint
DELETE FROM "assignment_resources" WHERE "object_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "submission_files";--> statement-breakpoint
DELETE FROM "evaluation_files";--> statement-breakpoint
DELETE FROM "question_attempt_answer_files";--> statement-breakpoint
UPDATE "question_bank_items" SET "image_object_id" = NULL WHERE "image_object_id" IS NOT NULL;--> statement-breakpoint
UPDATE "question_options" SET "image_object_id" = NULL WHERE "image_object_id" IS NOT NULL;--> statement-breakpoint
UPDATE "assignment_questions" SET "image_object_id" = NULL WHERE "image_object_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "storage_objects";--> statement-breakpoint
CREATE TYPE "public"."storage_object_status" AS ENUM('pending', 'ready', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."storage_purpose" AS ENUM('student_photo', 'staff_photo', 'id_card_asset', 'fee_print_logo', 'fee_upi_qr', 'site_media', 'homework_teacher_file', 'homework_student_file');--> statement-breakpoint
ALTER TABLE "storage_objects" DROP CONSTRAINT "storage_objects_created_by_user_id_fk";
--> statement-breakpoint
DROP INDEX "storage_objects_org_sha_idx";--> statement-breakpoint
CREATE INDEX "fee_print_settings_logo_idx" ON "fee_print_settings" USING btree ("logo_object_id");--> statement-breakpoint
CREATE INDEX "fee_print_settings_upi_image_idx" ON "fee_print_settings" USING btree ("upi_image_object_id");--> statement-breakpoint
CREATE INDEX "assignment_questions_image_idx" ON "assignment_questions" USING btree ("image_object_id");--> statement-breakpoint
CREATE INDEX "assignment_resources_object_idx" ON "assignment_resources" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "evaluation_files_object_idx" ON "evaluation_files" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "question_attempt_answer_files_object_idx" ON "question_attempt_answer_files" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "question_bank_items_image_idx" ON "question_bank_items" USING btree ("image_object_id");--> statement-breakpoint
CREATE INDEX "question_options_image_idx" ON "question_options" USING btree ("image_object_id");--> statement-breakpoint
CREATE INDEX "submission_files_object_idx" ON "submission_files" USING btree ("object_id");--> statement-breakpoint
ALTER TABLE "storage_objects" DROP COLUMN "sha256";--> statement-breakpoint
ALTER TABLE "storage_objects" DROP COLUMN "data";--> statement-breakpoint
ALTER TABLE "storage_objects" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "storage_objects" DROP COLUMN "updated_at";