-- ADR-057: students say whether a child is with the school; enrollments say what
-- happened in each session. Both columns pass through text so every existing row
-- can be mapped by hand before the new types go on.
ALTER TABLE "student_enrollments" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD COLUMN "leaving_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD COLUMN "left_by" text;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD COLUMN "leaving_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_left_by_user_id_fk" FOREIGN KEY ("left_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "students" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "student_enrollments" ALTER COLUMN "enrollment_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "student_enrollments" ALTER COLUMN "enrollment_status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "students" SET "status" = 'inactive' WHERE "status" <> 'active';--> statement-breakpoint
UPDATE "student_enrollments" SET "enrollment_status" = 'studying'
  WHERE "enrollment_status" IN ('active', 'section_assigned')
     OR ("enrollment_status" = 'admitted' AND "section_id" IS NOT NULL);--> statement-breakpoint
UPDATE "student_enrollments" SET "enrollment_status" = 'graduated' WHERE "enrollment_status" = 'passed_out';--> statement-breakpoint
-- Departures never recorded a date, so the row's last change is the best one there is.
UPDATE "student_enrollments" SET "left_on" = ("updated_at" AT TIME ZONE 'Asia/Kolkata')::date
  WHERE "enrollment_status" IN ('graduated', 'transferred_out', 'withdrawn');--> statement-breakpoint
-- A deactivated student's open enrollment closes, so lists have one thing to read.
UPDATE "student_enrollments" e
  SET "enrollment_status" = 'withdrawn',
      "left_on" = (s."updated_at" AT TIME ZONE 'Asia/Kolkata')::date,
      "leaving_reason" = 'Student record was deactivated'
  FROM "students" s
  WHERE s."id" = e."student_id" AND s."status" = 'inactive'
    AND e."enrollment_status" IN ('admitted', 'studying');--> statement-breakpoint
-- Anyone whose latest enrollment ended has left, whatever the register said.
UPDATE "students" s SET "status" = 'inactive'
  WHERE s."status" = 'active' AND (
    SELECT e."enrollment_status" FROM "student_enrollments" e
    JOIN "academic_years" y ON y."id" = e."academic_year_id"
    WHERE e."student_id" = s."id"
    ORDER BY y."start_date" DESC LIMIT 1
  ) IN ('graduated', 'transferred_out', 'withdrawn');--> statement-breakpoint
DROP TYPE "public"."student_status";--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "students" ALTER COLUMN "status" SET DATA TYPE "public"."student_status" USING "status"::"public"."student_status";--> statement-breakpoint
ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."student_status";--> statement-breakpoint
DROP TYPE "public"."enrollment_status";--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('admitted', 'studying', 'completed', 'graduated', 'transferred_out', 'withdrawn', 'expelled');--> statement-breakpoint
ALTER TABLE "student_enrollments" ALTER COLUMN "enrollment_status" SET DATA TYPE "public"."enrollment_status" USING "enrollment_status"::"public"."enrollment_status";--> statement-breakpoint
ALTER TABLE "student_enrollments" ALTER COLUMN "enrollment_status" SET DEFAULT 'admitted'::"public"."enrollment_status";--> statement-breakpoint
-- What a student's status must be, given an enrollment status. NULL means no opinion.
CREATE FUNCTION student_status_for_enrollment(status enrollment_status) RETURNS student_status
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN status IN ('graduated', 'transferred_out', 'withdrawn', 'expelled')
      THEN 'inactive'::student_status ELSE 'active'::student_status END
  $$;--> statement-breakpoint
-- Any write to an enrollment moves the student too, including scripts and seeds.
-- Only the latest session counts: correcting an old row can't change today.
CREATE FUNCTION sync_student_status_from_enrollment() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM student_enrollments e
      JOIN academic_years y ON y.id = e.academic_year_id
      JOIN academic_years mine ON mine.id = NEW.academic_year_id
      WHERE e.student_id = NEW.student_id AND e.id <> NEW.id AND y.start_date > mine.start_date
    ) THEN
      RETURN NULL;
    END IF;
    UPDATE students SET status = student_status_for_enrollment(NEW.enrollment_status)
      WHERE id = NEW.student_id
        AND status IS DISTINCT FROM student_status_for_enrollment(NEW.enrollment_status);
    RETURN NULL;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER student_enrollments_sync_student_status_trg
  AFTER INSERT OR UPDATE OF enrollment_status ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION sync_student_status_from_enrollment();--> statement-breakpoint
-- The other direction: nothing may set a status the latest enrollment contradicts.
-- A student with no enrollment has nothing to contradict, so they can be set freely.
CREATE FUNCTION guard_student_status() RETURNS trigger
  LANGUAGE plpgsql AS $$
  DECLARE
    latest enrollment_status;
  BEGIN
    SELECT e.enrollment_status INTO latest FROM student_enrollments e
      JOIN academic_years y ON y.id = e.academic_year_id
      WHERE e.student_id = NEW.id
      ORDER BY y.start_date DESC LIMIT 1;
    IF latest IS NOT NULL AND NEW.status <> student_status_for_enrollment(latest) THEN
      RAISE EXCEPTION 'student % cannot be % while their latest enrollment is %', NEW.id, NEW.status, latest
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER students_guard_status_trg
  BEFORE UPDATE OF status ON students
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION guard_student_status();
