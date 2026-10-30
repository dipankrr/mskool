CREATE TYPE "public"."annual_method" AS ENUM('weighted', 'single_term', 'best_n');--> statement-breakpoint
CREATE TYPE "public"."annual_total_display" AS ENUM('average', 'sum');--> statement-breakpoint
CREATE TABLE "annual_result_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid,
	"method" "annual_method" NOT NULL,
	"best_n" smallint,
	"total_display" "annual_total_display" DEFAULT 'average' NOT NULL,
	"annual_subject_pass_percent" numeric(5, 2) NOT NULL,
	"use_own_pass_rules" boolean DEFAULT false NOT NULL,
	"min_subjects_to_pass" smallint,
	"mandatory_pass_subject_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"compartment_allowed" boolean DEFAULT false NOT NULL,
	"max_subjects_for_compartment" smallint,
	"min_attendance_pct" numeric(5, 2) DEFAULT '75.00' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_result_policies_pass_range" CHECK (annual_subject_pass_percent >= 0 AND annual_subject_pass_percent <= 100),
	CONSTRAINT "annual_result_policies_attendance_range" CHECK (min_attendance_pct >= 0 AND min_attendance_pct <= 100),
	CONSTRAINT "annual_result_policies_best_n_shape" CHECK ((method = 'best_n' AND best_n IS NOT NULL AND best_n >= 1) OR (method <> 'best_n' AND best_n IS NULL)),
	CONSTRAINT "annual_result_policies_sum_needs_best_n" CHECK (total_display = 'average' OR method = 'best_n'),
	CONSTRAINT "annual_result_policies_compartment_cap_present" CHECK (NOT compartment_allowed OR max_subjects_for_compartment IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "annual_result_policy_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"weightage" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_result_policy_terms_weightage_range" CHECK (weightage IS NULL OR (weightage >= 0 AND weightage <= 100))
);
--> statement-breakpoint
CREATE TABLE "student_final_subject_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"section_id" uuid,
	"final_percentage" numeric(5, 2),
	"grade" varchar(10),
	"grade_point" numeric(4, 2),
	"is_passed" boolean NOT NULL,
	"is_exempted" boolean DEFAULT false NOT NULL,
	"counts_toward_result" boolean NOT NULL,
	"is_graded_only" boolean NOT NULL,
	"renormalized" boolean DEFAULT false NOT NULL,
	"source_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_status" "aggregate_result_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_final_results" ADD COLUMN "class_id" uuid;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD COLUMN "renormalized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD COLUMN "rank_in_section" smallint;--> statement-breakpoint
ALTER TABLE "annual_result_policies" ADD CONSTRAINT "annual_result_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policies" ADD CONSTRAINT "annual_result_policies_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policies" ADD CONSTRAINT "annual_result_policies_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policies" ADD CONSTRAINT "annual_result_policies_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policies" ADD CONSTRAINT "annual_result_policies_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policy_terms" ADD CONSTRAINT "annual_result_policy_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policy_terms" ADD CONSTRAINT "annual_result_policy_terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policy_terms" ADD CONSTRAINT "annual_result_policy_terms_policy_id_annual_result_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."annual_result_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_result_policy_terms" ADD CONSTRAINT "annual_result_policy_terms_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD CONSTRAINT "student_final_subject_results_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annual_result_policies_school_year_default_uq" ON "annual_result_policies" USING btree ("school_id","academic_year_id") WHERE class_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "annual_result_policies_school_year_class_uq" ON "annual_result_policies" USING btree ("school_id","academic_year_id","class_id") WHERE class_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "annual_result_policies_school_year_idx" ON "annual_result_policies" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "annual_result_policies_org_idx" ON "annual_result_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_result_policy_terms_policy_term_uq" ON "annual_result_policy_terms" USING btree ("policy_id","term_id");--> statement-breakpoint
CREATE INDEX "annual_result_policy_terms_policy_idx" ON "annual_result_policy_terms" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "annual_result_policy_terms_school_idx" ON "annual_result_policy_terms" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "annual_result_policy_terms_org_idx" ON "annual_result_policy_terms" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_final_subject_results_student_year_subject_uq" ON "student_final_subject_results" USING btree ("student_id","academic_year_id","subject_id");--> statement-breakpoint
CREATE INDEX "student_final_subject_results_year_class_idx" ON "student_final_subject_results" USING btree ("academic_year_id","class_id");--> statement-breakpoint
CREATE INDEX "student_final_subject_results_status_idx" ON "student_final_subject_results" USING btree ("result_status");--> statement-breakpoint
CREATE INDEX "student_final_subject_results_school_idx" ON "student_final_subject_results" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_final_subject_results_org_idx" ON "student_final_subject_results" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_policy_id_annual_result_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."annual_result_policies"("id") ON DELETE no action ON UPDATE no action;