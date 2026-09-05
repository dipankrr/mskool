CREATE TYPE "public"."grading_scale_mode" AS ENUM('fixed_range', 'percentile_rank');--> statement-breakpoint
CREATE TYPE "public"."subject_assessment_mode" AS ENUM('exam', 'term_grade');--> statement-breakpoint
CREATE TABLE "grading_scale_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"grading_scale_id" uuid NOT NULL,
	"min_marks" numeric(5, 2) NOT NULL,
	"max_marks" numeric(5, 2) NOT NULL,
	"grade_label" varchar(10) NOT NULL,
	"grade_point" numeric(4, 2),
	"descriptor" varchar(100),
	"sequence_number" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_scale_bands_bounds" CHECK (min_marks >= 0 AND max_marks <= 100 AND max_marks >= min_marks),
	CONSTRAINT "grading_scale_bands_point_range" CHECK (grade_point IS NULL OR (grade_point >= 0 AND grade_point <= 100))
);
--> statement-breakpoint
CREATE TABLE "grading_scales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(255),
	"mode" "grading_scale_mode" DEFAULT 'fixed_range' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pass_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid,
	"min_subjects_to_pass" smallint,
	"mandatory_pass_subject_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"grace_marks_allowed" boolean DEFAULT false NOT NULL,
	"max_grace_per_subject" numeric(5, 2),
	"max_grace_total" numeric(5, 2),
	"compartment_allowed" boolean DEFAULT false NOT NULL,
	"max_subjects_for_compartment" smallint,
	"min_attendance_pct" numeric(5, 2) DEFAULT '75.00' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pass_criteria_attendance_range" CHECK (min_attendance_pct >= 0 AND min_attendance_pct <= 100),
	CONSTRAINT "pass_criteria_grace_caps_present" CHECK (NOT grace_marks_allowed OR (max_grace_per_subject IS NOT NULL AND max_grace_total IS NOT NULL)),
	CONSTRAINT "pass_criteria_compartment_cap_present" CHECK (NOT compartment_allowed OR max_subjects_for_compartment IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "subject_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"counts_toward_result" boolean DEFAULT true NOT NULL,
	"is_graded_only" boolean DEFAULT false NOT NULL,
	"assessment_mode" "subject_assessment_mode" DEFAULT 'exam' NOT NULL,
	"sequence" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grading_scale_bands" ADD CONSTRAINT "grading_scale_bands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scale_bands" ADD CONSTRAINT "grading_scale_bands_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scale_bands" ADD CONSTRAINT "grading_scale_bands_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_criteria" ADD CONSTRAINT "pass_criteria_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_criteria" ADD CONSTRAINT "pass_criteria_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_criteria" ADD CONSTRAINT "pass_criteria_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_criteria" ADD CONSTRAINT "pass_criteria_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_criteria" ADD CONSTRAINT "pass_criteria_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_types" ADD CONSTRAINT "subject_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_types" ADD CONSTRAINT "subject_types_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_types" ADD CONSTRAINT "subject_types_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grading_scale_bands_scale_label_uq" ON "grading_scale_bands" USING btree ("grading_scale_id","grade_label");--> statement-breakpoint
CREATE INDEX "grading_scale_bands_scale_idx" ON "grading_scale_bands" USING btree ("grading_scale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_scales_school_name_uq" ON "grading_scales" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_scales_school_default_uq" ON "grading_scales" USING btree ("school_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "grading_scales_school_idx" ON "grading_scales" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "grading_scales_org_idx" ON "grading_scales" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pass_criteria_school_year_default_uq" ON "pass_criteria" USING btree ("school_id","academic_year_id") WHERE class_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pass_criteria_school_year_class_uq" ON "pass_criteria" USING btree ("school_id","academic_year_id","class_id") WHERE class_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pass_criteria_school_year_idx" ON "pass_criteria" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "pass_criteria_org_idx" ON "pass_criteria" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_types_school_name_uq" ON "subject_types" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "subject_types_school_idx" ON "subject_types" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "subject_types_org_idx" ON "subject_types" USING btree ("organization_id");