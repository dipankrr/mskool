CREATE TYPE "public"."aggregate_result_status" AS ENUM('draft', 'published', 'locked');--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('published', 'revision_open', 're_issued');--> statement-breakpoint
CREATE TABLE "exam_class_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"state" "publication_state" DEFAULT 'published' NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_opened_by" text,
	"revision_opened_at" timestamp with time zone,
	"re_issued_by" text,
	"re_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_report_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"replaces_version" integer,
	"snapshot_data" jsonb NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"template_id" uuid,
	"revision_reason" varchar(500),
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_card_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"applicable_class_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"layout_config" jsonb NOT NULL,
	"academic_year_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_final_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"total_marks" numeric(8, 2),
	"max_marks" numeric(8, 2),
	"percentage" numeric(5, 2),
	"grade" varchar(10),
	"grade_point" numeric(4, 2),
	"is_passed" boolean NOT NULL,
	"subjects_failed_count" smallint DEFAULT 0 NOT NULL,
	"subjects_failed" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"attendance_percentage" numeric(5, 2),
	"promotion_status" "promotion_status" DEFAULT 'pending' NOT NULL,
	"compartment_subjects" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rank_in_class" smallint,
	"rank_computed_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pass_policy_snapshot" jsonb,
	"result_status" "aggregate_result_status" DEFAULT 'draft' NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_subject_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"marks_obtained" numeric(6, 2),
	"max_marks" numeric(6, 2) NOT NULL,
	"pass_marks" numeric(6, 2) NOT NULL,
	"marks_before_grace" numeric(6, 2),
	"grace_marks_applied" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"final_marks" numeric(6, 2),
	"is_passed" boolean NOT NULL,
	"failed_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_absent" boolean DEFAULT false NOT NULL,
	"is_exempted" boolean DEFAULT false NOT NULL,
	"grade" varchar(10),
	"grade_point" numeric(4, 2),
	"grading_scale_id" uuid,
	"counts_toward_result" boolean NOT NULL,
	"is_graded_only" boolean NOT NULL,
	"rank_in_section" smallint,
	"rank_in_class" smallint,
	"rank_computed_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_status" "aggregate_result_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_term_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"section_id" uuid,
	"total_marks" numeric(8, 2),
	"max_marks" numeric(8, 2),
	"percentage" numeric(5, 2),
	"grade" varchar(10),
	"grade_point" numeric(4, 2),
	"is_passed" boolean NOT NULL,
	"subjects_failed_count" smallint DEFAULT 0 NOT NULL,
	"subjects_failed" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"attendance_percentage" numeric(5, 2),
	"rank_in_section" smallint,
	"rank_in_class" smallint,
	"rank_computed_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pass_policy_snapshot" jsonb,
	"result_status" "aggregate_result_status" DEFAULT 'draft' NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_revision_opened_by_user_id_fk" FOREIGN KEY ("revision_opened_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_class_publication" ADD CONSTRAINT "exam_class_publication_re_issued_by_user_id_fk" FOREIGN KEY ("re_issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_template_id_report_card_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_card_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_report_cards" ADD CONSTRAINT "published_report_cards_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card_templates" ADD CONSTRAINT "report_card_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card_templates" ADD CONSTRAINT "report_card_templates_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card_templates" ADD CONSTRAINT "report_card_templates_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card_templates" ADD CONSTRAINT "report_card_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_final_results" ADD CONSTRAINT "student_final_results_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_results" ADD CONSTRAINT "student_subject_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_results" ADD CONSTRAINT "student_subject_results_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_results" ADD CONSTRAINT "student_subject_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_results" ADD CONSTRAINT "student_subject_results_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_results" ADD CONSTRAINT "student_subject_results_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_results" ADD CONSTRAINT "student_subject_results_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_term_results" ADD CONSTRAINT "student_term_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_term_results" ADD CONSTRAINT "student_term_results_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_term_results" ADD CONSTRAINT "student_term_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_term_results" ADD CONSTRAINT "student_term_results_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_term_results" ADD CONSTRAINT "student_term_results_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_term_results" ADD CONSTRAINT "student_term_results_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_class_publication_exam_class_uq" ON "exam_class_publication" USING btree ("exam_id","class_id");--> statement-breakpoint
CREATE INDEX "exam_class_publication_exam_idx" ON "exam_class_publication" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "exam_class_publication_class_idx" ON "exam_class_publication" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "exam_class_publication_school_idx" ON "exam_class_publication" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exam_class_publication_org_idx" ON "exam_class_publication" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "published_report_cards_annual_version_uq" ON "published_report_cards" USING btree ("student_id","academic_year_id","version") WHERE term_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "published_report_cards_term_version_uq" ON "published_report_cards" USING btree ("student_id","academic_year_id","term_id","version") WHERE term_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "published_report_cards_annual_current_uq" ON "published_report_cards" USING btree ("student_id","academic_year_id") WHERE is_current = true AND term_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "published_report_cards_term_current_uq" ON "published_report_cards" USING btree ("student_id","academic_year_id","term_id") WHERE is_current = true AND term_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "published_report_cards_student_idx" ON "published_report_cards" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "published_report_cards_year_idx" ON "published_report_cards" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "published_report_cards_school_idx" ON "published_report_cards" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "published_report_cards_org_idx" ON "published_report_cards" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_card_templates_school_name_uq" ON "report_card_templates" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "report_card_templates_school_default_uq" ON "report_card_templates" USING btree ("school_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "report_card_templates_school_idx" ON "report_card_templates" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "report_card_templates_org_idx" ON "report_card_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_final_results_student_year_uq" ON "student_final_results" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_final_results_year_idx" ON "student_final_results" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "student_final_results_promotion_idx" ON "student_final_results" USING btree ("academic_year_id","promotion_status");--> statement-breakpoint
CREATE INDEX "student_final_results_school_idx" ON "student_final_results" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_final_results_org_idx" ON "student_final_results" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_subject_results_student_exam_subject_uq" ON "student_subject_results" USING btree ("student_id","exam_id","subject_id");--> statement-breakpoint
CREATE INDEX "student_subject_results_exam_idx" ON "student_subject_results" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "student_subject_results_subject_idx" ON "student_subject_results" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "student_subject_results_status_idx" ON "student_subject_results" USING btree ("result_status");--> statement-breakpoint
CREATE INDEX "student_subject_results_school_idx" ON "student_subject_results" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_subject_results_org_idx" ON "student_subject_results" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_term_results_student_term_uq" ON "student_term_results" USING btree ("student_id","term_id");--> statement-breakpoint
CREATE INDEX "student_term_results_term_idx" ON "student_term_results" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "student_term_results_status_idx" ON "student_term_results" USING btree ("result_status");--> statement-breakpoint
CREATE INDEX "student_term_results_school_idx" ON "student_term_results" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_term_results_org_idx" ON "student_term_results" USING btree ("organization_id");--> statement-breakpoint
-- =============================================================================
-- HAND-WRITTEN (ADR-013 territory) — drizzle-kit cannot see this block. If this
-- migration is ever regenerated, RE-PASTE it. `pnpm db:verify` checks both
-- triggers in pg_trigger and proves they still bite.
--
-- 1. marks_max: no entered mark may exceed its component's max. The service
--    validates too; this trigger is the database's backstop against any
--    future write path that forgets.
-- 2. scale_lock: the first subject result that grades against a scale locks
--    that scale forever (ADR-032 §5) — a scale a result has used can never
--    change, or history would silently restate.
-- =============================================================================

CREATE OR REPLACE FUNCTION student_component_results_marks_max_check() RETURNS trigger AS $$
BEGIN
  IF NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained > (
    SELECT c.max_marks FROM exam_components c WHERE c.id = NEW.component_id
  ) THEN
    RAISE EXCEPTION 'marks exceed the component maximum'
      USING ERRCODE = '23514',
            CONSTRAINT = 'student_component_results_marks_max_trg',
            TABLE = 'student_component_results';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER student_component_results_marks_max_trg
  BEFORE INSERT OR UPDATE OF marks_obtained, component_id ON student_component_results
  FOR EACH ROW
  EXECUTE FUNCTION student_component_results_marks_max_check();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION grading_scales_lock_on_use() RETURNS trigger AS $$
BEGIN
  IF NEW.grading_scale_id IS NOT NULL THEN
    UPDATE grading_scales
       SET is_locked = true
     WHERE id = NEW.grading_scale_id AND is_locked = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER grading_scales_lock_trg
  AFTER INSERT OR UPDATE OF grading_scale_id ON student_subject_results
  FOR EACH ROW
  EXECUTE FUNCTION grading_scales_lock_on_use();
