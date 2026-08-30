CREATE TYPE "public"."attendance_derivation_mode" AS ENUM('direct', 'homeroom_authoritative', 'threshold_percentage', 'manual_override');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'half_day', 'on_leave');--> statement-breakpoint
CREATE TYPE "public"."attendance_summary_period" AS ENUM('monthly', 'term', 'annual');--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"date" date NOT NULL,
	"class_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"period_id" uuid,
	"status" "attendance_status" NOT NULL,
	"correction_reason" varchar(500),
	"marked_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid,
	"period_type" "attendance_summary_period" NOT NULL,
	"month" smallint,
	"year" smallint,
	"working_days" smallint DEFAULT 0 NOT NULL,
	"days_present" smallint DEFAULT 0 NOT NULL,
	"days_absent" smallint DEFAULT 0 NOT NULL,
	"days_late" smallint DEFAULT 0 NOT NULL,
	"days_on_leave" smallint DEFAULT 0 NOT NULL,
	"attendance_percentage" numeric(5, 2) GENERATED ALWAYS AS (CASE WHEN working_days = 0 THEN 0
          ELSE round((days_present::decimal / working_days) * 100, 2) END) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_summary_monthly_shape" CHECK (period_type <> 'monthly' OR (month IS NOT NULL AND year IS NOT NULL AND term_id IS NULL)),
	CONSTRAINT "attendance_summary_term_shape" CHECK (period_type <> 'term' OR (term_id IS NOT NULL AND month IS NULL AND year IS NULL)),
	CONSTRAINT "attendance_summary_annual_shape" CHECK (period_type <> 'annual' OR (month IS NULL AND year IS NULL AND term_id IS NULL)),
	CONSTRAINT "attendance_summary_month_range" CHECK (month IS NULL OR month BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "daily_attendance_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"periods_present" smallint,
	"periods_total" smallint,
	"derivation_mode" "attendance_derivation_mode" NOT NULL,
	"overridden_by" text,
	"override_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD CONSTRAINT "attendance_summary_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD CONSTRAINT "attendance_summary_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD CONSTRAINT "attendance_summary_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD CONSTRAINT "attendance_summary_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD CONSTRAINT "attendance_summary_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance_status" ADD CONSTRAINT "daily_attendance_status_overridden_by_user_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_records_student_date_idx" ON "attendance_records" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_section_date_idx" ON "attendance_records" USING btree ("section_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_school_date_idx" ON "attendance_records" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_org_idx" ON "attendance_records" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_summary_monthly_uq" ON "attendance_summary" USING btree ("student_id","academic_year_id","month","year") WHERE period_type = 'monthly';--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_summary_term_uq" ON "attendance_summary" USING btree ("student_id","academic_year_id","term_id") WHERE period_type = 'term';--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_summary_annual_uq" ON "attendance_summary" USING btree ("student_id","academic_year_id") WHERE period_type = 'annual';--> statement-breakpoint
CREATE INDEX "attendance_summary_student_year_idx" ON "attendance_summary" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "attendance_summary_school_idx" ON "attendance_summary" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "attendance_summary_org_idx" ON "attendance_summary" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_attendance_status_student_year_date_uq" ON "daily_attendance_status" USING btree ("student_id","academic_year_id","date");--> statement-breakpoint
CREATE INDEX "daily_attendance_status_school_date_idx" ON "daily_attendance_status" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "daily_attendance_status_section_date_idx" ON "daily_attendance_status" USING btree ("section_id","date");--> statement-breakpoint
CREATE INDEX "daily_attendance_status_org_idx" ON "daily_attendance_status" USING btree ("organization_id");--> statement-breakpoint

-- =============================================================================
-- HAND-WRITTEN (the Phase 3 plan, C4). Drizzle cannot express this; it is
-- appended to the generated migration like the academic_years EXCLUDEs in
-- 0001. drizzle-kit will not drop it on a diff, but a REGENERATED 0008 will
-- not contain it either — this block must be re-pasted, and `pnpm db:verify`
-- proves it still bites.
-- =============================================================================

-- The daily-mode double-mark guard.
--
-- A plain UNIQUE (student_id, date, period_id) treats NULL period_id values
-- as DISTINCT from each other — Postgres's standard three-valued logic — so
-- on a daily-mode school, where every record's period_id IS NULL, the same
-- student could be marked twice in one day and both rows would survive.
--
-- The COALESCE rewrites NULL to a fixed sentinel uuid before the key is
-- compared, which makes all of a day's daily-mode rows collide with each
-- other while leaving genuinely distinct periods alone. A period-wise pair
-- (same student, same date, two different periods) is accepted; a second
-- daily row, or the same period twice, is rejected.
--
-- The sentinel is the zero uuid: it is not generated by defaultRandom(),
-- and no period row can exist with it (the periods FK would refuse it even
-- if someone inserted one with that id — a period is a real row with a real
-- id, never the zero uuid).
CREATE UNIQUE INDEX "attendance_records_student_day_period_uq"
    ON "attendance_records" (
        "student_id",
        "date",
        COALESCE("period_id", '00000000-0000-0000-0000-000000000000'::uuid)
    );