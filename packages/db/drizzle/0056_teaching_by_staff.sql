ALTER TABLE "schools" ADD COLUMN "class_teachers_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR-068: assignments point at the staff record. Fill it from the login,
-- then drop rows nothing can own and the two retired kinds.
UPDATE "section_teacher_assignments" AS sta SET "staff_id" = s."id"
  FROM "staff" AS s
  WHERE s."user_id" = sta."user_id" AND s."organization_id" = sta."organization_id";--> statement-breakpoint
DELETE FROM "section_teacher_assignments"
  WHERE "staff_id" IS NULL OR "role"::text IN ('co_teacher', 'activity_teacher');--> statement-breakpoint
-- The new unique rules: close any extra standing class teacher or duplicate
-- subject row, keeping the earliest.
UPDATE "section_teacher_assignments" SET "effective_to" = CURRENT_DATE
  WHERE "effective_to" IS NULL AND "role"::text = 'class_teacher' AND "id" NOT IN (
    SELECT DISTINCT ON ("section_id") "id" FROM "section_teacher_assignments"
    WHERE "effective_to" IS NULL AND "role"::text = 'class_teacher'
    ORDER BY "section_id", "created_at");--> statement-breakpoint
UPDATE "section_teacher_assignments" SET "effective_to" = CURRENT_DATE
  WHERE "effective_to" IS NULL AND "role"::text = 'subject_teacher' AND "id" NOT IN (
    SELECT DISTINCT ON ("section_id", "staff_id", "subject_id") "id" FROM "section_teacher_assignments"
    WHERE "effective_to" IS NULL AND "role"::text = 'subject_teacher'
    ORDER BY "section_id", "staff_id", "subject_id", "created_at");--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" DROP CONSTRAINT "section_teacher_assignments_user_id_user_id_fk";
--> statement-breakpoint
-- The role CHECK compares against the enum; it is dropped across the swap.
ALTER TABLE "section_teacher_assignments" DROP CONSTRAINT "sta_subject_matches_role";--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."teacher_assignment_role";--> statement-breakpoint
CREATE TYPE "public"."teacher_assignment_role" AS ENUM('class_teacher', 'subject_teacher');--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ALTER COLUMN "role" SET DATA TYPE "public"."teacher_assignment_role" USING "role"::"public"."teacher_assignment_role";--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "sta_subject_matches_role" CHECK (("section_teacher_assignments"."role" = 'subject_teacher' AND "section_teacher_assignments"."subject_id" IS NOT NULL)
          OR ("section_teacher_assignments"."role" <> 'subject_teacher' AND "section_teacher_assignments"."subject_id" IS NULL));--> statement-breakpoint
DROP INDEX "section_teacher_assignments_user_idx";--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ALTER COLUMN "staff_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "section_teacher_assignments_staff_idx" ON "section_teacher_assignments" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_teacher_assignments_one_class_teacher_uq" ON "section_teacher_assignments" USING btree ("section_id") WHERE "section_teacher_assignments"."role" = 'class_teacher' AND "section_teacher_assignments"."effective_to" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "section_teacher_assignments_no_duplicate_uq" ON "section_teacher_assignments" USING btree ("section_id","staff_id","subject_id") WHERE "section_teacher_assignments"."role" = 'subject_teacher' AND "section_teacher_assignments"."effective_to" IS NULL;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" DROP COLUMN "user_id";