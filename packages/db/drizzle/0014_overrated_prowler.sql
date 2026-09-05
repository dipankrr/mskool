CREATE TYPE "public"."component_exemption_type" AS ENUM('medical', 'disability', 'board_approved', 'other');--> statement-breakpoint
CREATE TYPE "public"."component_result_status" AS ENUM('draft', 'entered', 'verified', 'published', 'locked');--> statement-breakpoint
CREATE TYPE "public"."exam_status" AS ENUM('draft', 'scheduled', 'ongoing', 'marks_entry', 'under_verification', 'published', 'locked');--> statement-breakpoint
CREATE TYPE "public"."exam_type" AS ENUM('regular', 'supplementary', 'improvement', 'mock');--> statement-breakpoint
CREATE TYPE "public"."component_revision_type" AS ENUM('marks_correction', 're_evaluation', 'data_entry_error', 'other');--> statement-breakpoint
CREATE TABLE "exam_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"sequence_number" smallint DEFAULT 0 NOT NULL,
	"max_marks" numeric(6, 2) NOT NULL,
	"pass_marks" numeric(6, 2) NOT NULL,
	"weightage_percentage" numeric(5, 2) NOT NULL,
	"is_mandatory_pass" boolean DEFAULT false NOT NULL,
	"allows_negative_marking" boolean DEFAULT false NOT NULL,
	"negative_marks_per_wrong" numeric(4, 2),
	"grading_scale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_components_max_positive" CHECK (max_marks > 0),
	CONSTRAINT "exam_components_pass_bounds" CHECK (pass_marks >= 0 AND pass_marks <= max_marks),
	CONSTRAINT "exam_components_weightage_range" CHECK (weightage_percentage > 0 AND weightage_percentage <= 100)
);
--> statement-breakpoint
CREATE TABLE "exam_eligibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"attendance_percentage" numeric(5, 2) NOT NULL,
	"min_required_pct" numeric(5, 2) NOT NULL,
	"is_eligible" boolean NOT NULL,
	"is_overridden" boolean DEFAULT false NOT NULL,
	"override_eligible" boolean,
	"override_reason" varchar(500),
	"overridden_by" text,
	"overridden_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_subject_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"section_id" uuid,
	"subject_id" uuid NOT NULL,
	"exam_date" date NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"venue" varchar(150),
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"exam_type" "exam_type" DEFAULT 'regular' NOT NULL,
	"linked_exam_id" uuid,
	"supplementary_capped_at_pass" boolean DEFAULT false NOT NULL,
	"weightage_in_term" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"counts_toward_term_result" boolean DEFAULT true NOT NULL,
	"allows_negative_marking" boolean DEFAULT false NOT NULL,
	"status" "exam_status" DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_weightage_range" CHECK (weightage_in_term > 0 AND weightage_in_term <= 100)
);
--> statement-breakpoint
CREATE TABLE "student_component_result_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"original_result_id" uuid NOT NULL,
	"previous_marks" numeric(6, 2),
	"revised_marks" numeric(6, 2),
	"previous_grade" varchar(10),
	"revised_grade" varchar(10),
	"previous_status" "component_result_status" NOT NULL,
	"revised_status" "component_result_status" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"revision_type" "component_revision_type" NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text NOT NULL,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_component_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"marks_obtained" numeric(6, 2),
	"grade_obtained" varchar(10),
	"is_absent" boolean DEFAULT false NOT NULL,
	"is_exempted" boolean DEFAULT false NOT NULL,
	"exemption_type" "component_exemption_type",
	"result_status" "component_result_status" DEFAULT 'draft' NOT NULL,
	"import_batch_id" uuid,
	"entered_by" text,
	"entered_at" timestamp with time zone,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_component_results_value_present" CHECK (result_status = 'draft' OR is_absent OR is_exempted OR marks_obtained IS NOT NULL OR grade_obtained IS NOT NULL),
	CONSTRAINT "student_component_results_exemption_typed" CHECK (NOT is_exempted OR exemption_type IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "term_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"mapping_id" uuid NOT NULL,
	"grade" varchar(10) NOT NULL,
	"descriptor" varchar(100),
	"teacher_remarks" varchar(500),
	"entered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_schedule_id_exam_subject_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."exam_subject_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_eligibility" ADD CONSTRAINT "exam_eligibility_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_eligibility" ADD CONSTRAINT "exam_eligibility_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_eligibility" ADD CONSTRAINT "exam_eligibility_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_eligibility" ADD CONSTRAINT "exam_eligibility_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_eligibility" ADD CONSTRAINT "exam_eligibility_overridden_by_user_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject_schedules" ADD CONSTRAINT "exam_subject_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject_schedules" ADD CONSTRAINT "exam_subject_schedules_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject_schedules" ADD CONSTRAINT "exam_subject_schedules_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject_schedules" ADD CONSTRAINT "exam_subject_schedules_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject_schedules" ADD CONSTRAINT "exam_subject_schedules_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subject_schedules" ADD CONSTRAINT "exam_subject_schedules_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_linked_exam_id_exams_id_fk" FOREIGN KEY ("linked_exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_result_revisions" ADD CONSTRAINT "student_component_result_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_result_revisions" ADD CONSTRAINT "student_component_result_revisions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_result_revisions" ADD CONSTRAINT "student_component_result_revisions_original_result_id_student_component_results_id_fk" FOREIGN KEY ("original_result_id") REFERENCES "public"."student_component_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_result_revisions" ADD CONSTRAINT "student_component_result_revisions_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_result_revisions" ADD CONSTRAINT "student_component_result_revisions_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_schedule_id_exam_subject_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."exam_subject_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_component_id_exam_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."exam_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_component_results" ADD CONSTRAINT "student_component_results_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_assessments" ADD CONSTRAINT "term_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_assessments" ADD CONSTRAINT "term_assessments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_assessments" ADD CONSTRAINT "term_assessments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_assessments" ADD CONSTRAINT "term_assessments_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_assessments" ADD CONSTRAINT "term_assessments_mapping_id_class_subject_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."class_subject_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_assessments" ADD CONSTRAINT "term_assessments_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_components_schedule_name_uq" ON "exam_components" USING btree ("schedule_id","name");--> statement-breakpoint
CREATE INDEX "exam_components_schedule_idx" ON "exam_components" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "exam_components_scale_idx" ON "exam_components" USING btree ("grading_scale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_eligibility_student_exam_uq" ON "exam_eligibility" USING btree ("student_id","exam_id");--> statement-breakpoint
CREATE INDEX "exam_eligibility_exam_idx" ON "exam_eligibility" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "exam_eligibility_school_idx" ON "exam_eligibility" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exam_eligibility_org_idx" ON "exam_eligibility" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_subject_schedules_class_subject_uq" ON "exam_subject_schedules" USING btree ("exam_id","class_id","subject_id") WHERE section_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_subject_schedules_section_subject_uq" ON "exam_subject_schedules" USING btree ("exam_id","class_id","section_id","subject_id") WHERE section_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "exam_subject_schedules_exam_idx" ON "exam_subject_schedules" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "exam_subject_schedules_class_date_idx" ON "exam_subject_schedules" USING btree ("class_id","exam_date");--> statement-breakpoint
CREATE INDEX "exam_subject_schedules_subject_idx" ON "exam_subject_schedules" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_school_term_name_uq" ON "exams" USING btree ("school_id","term_id","name");--> statement-breakpoint
CREATE INDEX "exams_term_idx" ON "exams" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "exams_year_idx" ON "exams" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "exams_school_status_idx" ON "exams" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "exams_org_idx" ON "exams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "student_component_result_revisions_result_idx" ON "student_component_result_revisions" USING btree ("original_result_id");--> statement-breakpoint
CREATE INDEX "student_component_result_revisions_school_idx" ON "student_component_result_revisions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_component_result_revisions_org_idx" ON "student_component_result_revisions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_component_results_student_exam_component_uq" ON "student_component_results" USING btree ("student_id","exam_id","component_id");--> statement-breakpoint
CREATE INDEX "student_component_results_exam_status_idx" ON "student_component_results" USING btree ("exam_id","result_status");--> statement-breakpoint
CREATE INDEX "student_component_results_schedule_idx" ON "student_component_results" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "student_component_results_student_idx" ON "student_component_results" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_component_results_org_idx" ON "student_component_results" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "term_assessments_student_term_mapping_uq" ON "term_assessments" USING btree ("student_id","term_id","mapping_id");--> statement-breakpoint
CREATE INDEX "term_assessments_term_idx" ON "term_assessments" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "term_assessments_mapping_idx" ON "term_assessments" USING btree ("mapping_id");--> statement-breakpoint
CREATE INDEX "term_assessments_org_idx" ON "term_assessments" USING btree ("organization_id");