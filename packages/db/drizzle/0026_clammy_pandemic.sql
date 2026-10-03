-- 0026 — HOMEWORK / ASSIGNMENTS (ADR-039).
-- 26 tables: settings, rubrics, series, assignments -> targets ->
-- student_assignments -> submissions -> evaluations; comments,
-- acknowledgements, summary; the question bank + attempt layers.
-- Ported from docs/reference/assignment/06+07 (adaptations in ADR-039:
-- uuid PKs, org+school columns for scopeWhere, storage_objects not files,
-- resolution via student_enrollments — no elective table yet).
CREATE TYPE "public"."assignment_completion_source" AS ENUM('student', 'parent', 'teacher_verified');--> statement-breakpoint
CREATE TYPE "public"."assignment_evaluation_outcome" AS ENUM('reviewed', 'resubmit_requested');--> statement-breakpoint
CREATE TYPE "public"."assignment_grading_mode" AS ENUM('none', 'marks', 'grade', 'rubric', 'completion');--> statement-breakpoint
CREATE TYPE "public"."assignment_kind" AS ENUM('homework', 'classwork', 'project', 'worksheet', 'reading', 'practice', 'quiz');--> statement-breakpoint
CREATE TYPE "public"."assignment_late_policy" AS ENUM('not_allowed', 'allowed');--> statement-breakpoint
CREATE TYPE "public"."assignment_resource_type" AS ENUM('file', 'link', 'video');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('draft', 'scheduled', 'published', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_summary_period" AS ENUM('month', 'term', 'year');--> statement-breakpoint
CREATE TYPE "public"."assignment_target_type" AS ENUM('section', 'student');--> statement-breakpoint
CREATE TYPE "public"."homework_attempt_scoring" AS ENUM('best', 'latest', 'first');--> statement-breakpoint
CREATE TYPE "public"."homework_attempt_status" AS ENUM('in_progress', 'submitted', 'graded');--> statement-breakpoint
CREATE TYPE "public"."homework_question_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."homework_reveal_policy" AS ENUM('never', 'after_submit', 'after_close');--> statement-breakpoint
CREATE TYPE "public"."homework_question_type" AS ENUM('mcq_single', 'mcq_multi', 'true_false', 'fill_blank', 'numeric', 'match', 'short_answer', 'long_answer', 'file_upload');--> statement-breakpoint
CREATE TYPE "public"."homework_question_visibility" AS ENUM('private', 'school');--> statement-breakpoint
CREATE TYPE "public"."student_assignment_status" AS ENUM('assigned', 'in_progress', 'submitted', 'resubmit_requested', 'reviewed', 'excused', 'missing');--> statement-breakpoint
CREATE TYPE "public"."submission_author_role" AS ENUM('student', 'parent', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."assignment_submission_type" AS ENUM('none', 'tick', 'offline', 'text', 'file', 'link', 'questions');--> statement-breakpoint
CREATE TABLE "assignment_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_assignment_id" uuid NOT NULL,
	"guardian_user_id" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_assignment_id" uuid,
	"parent_comment_id" uuid,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignment_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_assignment_id" uuid NOT NULL,
	"submission_id" uuid,
	"outcome" "assignment_evaluation_outcome" DEFAULT 'reviewed' NOT NULL,
	"marks" numeric(7, 2),
	"grade" varchar(20),
	"feedback" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"evaluated_by" text,
	"is_auto" boolean DEFAULT false NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_evaluations_evaluator" CHECK (is_auto OR evaluated_by IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "assignment_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_assignment_id" uuid NOT NULL,
	"previous_due_at" timestamp with time zone NOT NULL,
	"previous_close_at" timestamp with time zone NOT NULL,
	"new_due_at" timestamp with time zone NOT NULL,
	"new_close_at" timestamp with time zone NOT NULL,
	"reason" text,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_question_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"shuffle_options" boolean DEFAULT false NOT NULL,
	"one_question_at_a_time" boolean DEFAULT false NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"attempt_scoring" "homework_attempt_scoring" DEFAULT 'best' NOT NULL,
	"show_score" "homework_reveal_policy" DEFAULT 'after_submit' NOT NULL,
	"show_answers" "homework_reveal_policy" DEFAULT 'after_close' NOT NULL,
	"show_explanations" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"source_question_id" uuid,
	"position" integer NOT NULL,
	"question_type" "homework_question_type" NOT NULL,
	"body" text NOT NULL,
	"image_object_id" uuid,
	"options" jsonb,
	"correct_answer" jsonb,
	"explanation" text,
	"marks" numeric(6, 2) DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"resource_type" "assignment_resource_type" NOT NULL,
	"object_id" uuid,
	"url" text,
	"title" varchar(250),
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assignment_resources_shape" CHECK ((resource_type = 'file' AND object_id IS NOT NULL) OR
          (resource_type <> 'file' AND url IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "assignment_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_rubric_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"level_id" uuid,
	"points" numeric(6, 2) NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "assignment_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"recurrence" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid,
	"allowed_submission_types" "assignment_submission_type"[] DEFAULT ARRAY['none','tick','offline','text','file','link','questions']::assignment_submission_type[] NOT NULL,
	"students_can_submit" boolean DEFAULT true NOT NULL,
	"parents_can_submit" boolean DEFAULT true NOT NULL,
	"max_files_per_submission" integer DEFAULT 5 NOT NULL,
	"max_file_size_mb" integer DEFAULT 10 NOT NULL,
	"allowed_mime_types" text[],
	"default_late_policy" "assignment_late_policy" DEFAULT 'allowed' NOT NULL,
	"default_late_window_hours" integer DEFAULT 48 NOT NULL,
	"max_assignments_per_day" integer,
	"allow_weekend_assignments" boolean DEFAULT true NOT NULL,
	"questions_enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"target_type" "assignment_target_type" NOT NULL,
	"section_id" uuid,
	"student_enrollment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_targets_shape" CHECK ((target_type = 'section' AND section_id IS NOT NULL AND student_enrollment_id IS NULL) OR
          (target_type = 'student' AND student_enrollment_id IS NOT NULL AND section_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid,
	"subject_id" uuid NOT NULL,
	"series_id" uuid,
	"source_assignment_id" uuid,
	"kind" "assignment_kind" DEFAULT 'homework' NOT NULL,
	"title" varchar(250) NOT NULL,
	"description" text,
	"topic" varchar(250),
	"estimated_minutes" integer,
	"submission_types" "assignment_submission_type"[] DEFAULT ARRAY['none']::assignment_submission_type[] NOT NULL,
	"grading_mode" "assignment_grading_mode" DEFAULT 'none' NOT NULL,
	"max_marks" numeric(7, 2),
	"grading_scale_id" uuid,
	"rubric_id" uuid,
	"publish_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"late_policy" "assignment_late_policy" DEFAULT 'allowed' NOT NULL,
	"allow_resubmission" boolean DEFAULT true NOT NULL,
	"max_submissions" integer,
	"status" "assignment_status" DEFAULT 'draft' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_close_after_due" CHECK (close_at >= due_at),
	CONSTRAINT "assignments_late_requires_window" CHECK (late_policy = 'allowed' OR close_at = due_at),
	CONSTRAINT "assignment_marks_require_max" CHECK (grading_mode <> 'marks' OR max_marks IS NOT NULL),
	CONSTRAINT "assignment_grade_requires_scale" CHECK (grading_mode <> 'grade' OR grading_scale_id IS NOT NULL),
	CONSTRAINT "assignment_rubric_requires_rubric" CHECK (grading_mode <> 'rubric' OR rubric_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "evaluation_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"object_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_attempt_answer_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"assignment_question_id" uuid NOT NULL,
	"answer" jsonb,
	"is_correct" boolean,
	"marks_awarded" numeric(6, 2),
	"needs_manual_review" boolean DEFAULT false NOT NULL,
	"feedback" text,
	"graded_by" text,
	"graded_at" timestamp with time zone,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_assignment_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" "homework_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"question_order" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"score_auto" numeric(7, 2) DEFAULT '0' NOT NULL,
	"score_manual" numeric(7, 2) DEFAULT '0' NOT NULL,
	"total_score" numeric(7, 2) DEFAULT '0' NOT NULL,
	"max_score" numeric(7, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_bank_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_id" uuid,
	"topic" varchar(250),
	"question_type" "homework_question_type" NOT NULL,
	"body" text NOT NULL,
	"image_object_id" uuid,
	"correct_answer" jsonb,
	"explanation" text,
	"difficulty" "homework_question_difficulty" DEFAULT 'medium' NOT NULL,
	"default_marks" numeric(6, 2) DEFAULT '1' NOT NULL,
	"visibility" "homework_question_visibility" DEFAULT 'private' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"option_text" text NOT NULL,
	"image_object_id" uuid,
	"is_correct" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"description" text,
	"points" numeric(6, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_assignment_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_enrollment_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid,
	"subject_id" uuid,
	"period_type" "assignment_summary_period" NOT NULL,
	"period_start" date NOT NULL,
	"total_assigned" integer DEFAULT 0 NOT NULL,
	"submitted_on_time" integer DEFAULT 0 NOT NULL,
	"submitted_late" integer DEFAULT 0 NOT NULL,
	"missing" integer DEFAULT 0 NOT NULL,
	"excused" integer DEFAULT 0 NOT NULL,
	"reviewed" integer DEFAULT 0 NOT NULL,
	"avg_score_percent" numeric(5, 2),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_enrollment_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"status" "student_assignment_status" DEFAULT 'assigned' NOT NULL,
	"completion_source" "assignment_completion_source",
	"effective_due_at" timestamp with time zone NOT NULL,
	"effective_close_at" timestamp with time zone NOT NULL,
	"is_backfilled" boolean DEFAULT false NOT NULL,
	"counts_toward_stats" boolean DEFAULT true NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"current_evaluation_id" uuid,
	"current_marks" numeric(7, 2),
	"current_grade" varchar(20),
	"reviewed_at" timestamp with time zone,
	"excused_by" text,
	"excused_reason" text,
	"excused_at" timestamp with time zone,
	"missing_marked_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_assignment_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"body_text" text,
	"link_url" text,
	"submitted_by_user_id" text NOT NULL,
	"submitted_by_role" "submission_author_role" NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_acknowledgements" ADD CONSTRAINT "assignment_acknowledgements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_acknowledgements" ADD CONSTRAINT "assignment_acknowledgements_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_acknowledgements" ADD CONSTRAINT "assignment_acknowledgements_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_acknowledgements" ADD CONSTRAINT "assignment_acknowledgements_guardian_user_id_user_id_fk" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_parent_comment_id_assignment_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."assignment_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evaluations" ADD CONSTRAINT "assignment_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evaluations" ADD CONSTRAINT "assignment_evaluations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evaluations" ADD CONSTRAINT "assignment_evaluations_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evaluations" ADD CONSTRAINT "assignment_evaluations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evaluations" ADD CONSTRAINT "assignment_evaluations_evaluated_by_user_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_settings" ADD CONSTRAINT "assignment_question_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_settings" ADD CONSTRAINT "assignment_question_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_settings" ADD CONSTRAINT "assignment_question_settings_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_source_question_id_question_bank_items_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."question_bank_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_image_object_id_storage_objects_id_fk" FOREIGN KEY ("image_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_resources" ADD CONSTRAINT "assignment_resources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_resources" ADD CONSTRAINT "assignment_resources_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_resources" ADD CONSTRAINT "assignment_resources_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_resources" ADD CONSTRAINT "assignment_resources_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_revisions" ADD CONSTRAINT "assignment_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_revisions" ADD CONSTRAINT "assignment_revisions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_revisions" ADD CONSTRAINT "assignment_revisions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_revisions" ADD CONSTRAINT "assignment_revisions_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rubric_scores" ADD CONSTRAINT "assignment_rubric_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rubric_scores" ADD CONSTRAINT "assignment_rubric_scores_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rubric_scores" ADD CONSTRAINT "assignment_rubric_scores_evaluation_id_assignment_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."assignment_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rubric_scores" ADD CONSTRAINT "assignment_rubric_scores_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rubric_scores" ADD CONSTRAINT "assignment_rubric_scores_level_id_rubric_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."rubric_levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_series" ADD CONSTRAINT "assignment_series_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_series" ADD CONSTRAINT "assignment_series_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_series" ADD CONSTRAINT "assignment_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_settings" ADD CONSTRAINT "assignment_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_settings" ADD CONSTRAINT "assignment_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_settings" ADD CONSTRAINT "assignment_settings_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_settings" ADD CONSTRAINT "assignment_settings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_student_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("student_enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_series_id_assignment_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."assignment_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_source_assignment_id_assignments_id_fk" FOREIGN KEY ("source_assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_files" ADD CONSTRAINT "evaluation_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_files" ADD CONSTRAINT "evaluation_files_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_files" ADD CONSTRAINT "evaluation_files_evaluation_id_assignment_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."assignment_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_files" ADD CONSTRAINT "evaluation_files_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answer_files" ADD CONSTRAINT "question_attempt_answer_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answer_files" ADD CONSTRAINT "question_attempt_answer_files_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answer_files" ADD CONSTRAINT "question_attempt_answer_files_answer_id_question_attempt_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."question_attempt_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answer_files" ADD CONSTRAINT "question_attempt_answer_files_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answers" ADD CONSTRAINT "question_attempt_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answers" ADD CONSTRAINT "question_attempt_answers_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answers" ADD CONSTRAINT "question_attempt_answers_attempt_id_question_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."question_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answers" ADD CONSTRAINT "question_attempt_answers_assignment_question_id_assignment_questions_id_fk" FOREIGN KEY ("assignment_question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempt_answers" ADD CONSTRAINT "question_attempt_answers_graded_by_user_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_items" ADD CONSTRAINT "question_bank_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_items" ADD CONSTRAINT "question_bank_items_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_items" ADD CONSTRAINT "question_bank_items_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_items" ADD CONSTRAINT "question_bank_items_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_items" ADD CONSTRAINT "question_bank_items_image_object_id_storage_objects_id_fk" FOREIGN KEY ("image_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_items" ADD CONSTRAINT "question_bank_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_question_bank_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_image_object_id_storage_objects_id_fk" FOREIGN KEY ("image_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_levels" ADD CONSTRAINT "rubric_levels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_levels" ADD CONSTRAINT "rubric_levels_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_levels" ADD CONSTRAINT "rubric_levels_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignment_summary" ADD CONSTRAINT "student_assignment_summary_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignment_summary" ADD CONSTRAINT "student_assignment_summary_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignment_summary" ADD CONSTRAINT "student_assignment_summary_student_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("student_enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignment_summary" ADD CONSTRAINT "student_assignment_summary_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignment_summary" ADD CONSTRAINT "student_assignment_summary_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignment_summary" ADD CONSTRAINT "student_assignment_summary_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_student_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("student_enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_current_evaluation_id_assignment_evaluations_id_fk" FOREIGN KEY ("current_evaluation_id") REFERENCES "public"."assignment_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_excused_by_user_id_fk" FOREIGN KEY ("excused_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_acknowledgements_sa_guardian_uq" ON "assignment_acknowledgements" USING btree ("student_assignment_id","guardian_user_id");--> statement-breakpoint
CREATE INDEX "assignment_comments_assignment_idx" ON "assignment_comments" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "assignment_comments_sa_idx" ON "assignment_comments" USING btree ("student_assignment_id") WHERE student_assignment_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_evaluations_current_uq" ON "assignment_evaluations" USING btree ("student_assignment_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "assignment_evaluations_sa_idx" ON "assignment_evaluations" USING btree ("student_assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_extensions_sa_idx" ON "assignment_extensions" USING btree ("student_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_question_settings_assignment_uq" ON "assignment_question_settings" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_questions_assignment_position_uq" ON "assignment_questions" USING btree ("assignment_id","position");--> statement-breakpoint
CREATE INDEX "assignment_questions_assignment_idx" ON "assignment_questions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_resources_assignment_idx" ON "assignment_resources" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_revisions_assignment_no_uq" ON "assignment_revisions" USING btree ("assignment_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_rubric_scores_eval_criterion_uq" ON "assignment_rubric_scores" USING btree ("evaluation_id","criterion_id");--> statement-breakpoint
CREATE INDEX "assignment_series_school_idx" ON "assignment_series" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_settings_school_default_uq" ON "assignment_settings" USING btree ("school_id") WHERE class_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_settings_school_class_uq" ON "assignment_settings" USING btree ("school_id","class_id") WHERE class_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assignment_settings_school_idx" ON "assignment_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_targets_section_uq" ON "assignment_targets" USING btree ("assignment_id","section_id") WHERE section_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_targets_student_uq" ON "assignment_targets" USING btree ("assignment_id","student_enrollment_id") WHERE student_enrollment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assignment_targets_section_idx" ON "assignment_targets" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "assignments_school_year_status_idx" ON "assignments" USING btree ("school_id","academic_year_id","status");--> statement-breakpoint
CREATE INDEX "assignments_subject_due_idx" ON "assignments" USING btree ("subject_id","due_at");--> statement-breakpoint
CREATE INDEX "assignments_status_due_idx" ON "assignments" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "assignments_series_idx" ON "assignments" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "evaluation_files_evaluation_idx" ON "evaluation_files" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "question_attempt_answer_files_answer_idx" ON "question_attempt_answer_files" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_attempt_answers_attempt_question_uq" ON "question_attempt_answers" USING btree ("attempt_id","assignment_question_id");--> statement-breakpoint
CREATE INDEX "question_attempt_answers_review_idx" ON "question_attempt_answers" USING btree ("attempt_id") WHERE needs_manual_review;--> statement-breakpoint
CREATE UNIQUE INDEX "question_attempts_sa_attempt_uq" ON "question_attempts" USING btree ("student_assignment_id","attempt_no");--> statement-breakpoint
CREATE INDEX "question_attempts_sa_idx" ON "question_attempts" USING btree ("student_assignment_id");--> statement-breakpoint
CREATE INDEX "question_bank_lookup_idx" ON "question_bank_items" USING btree ("school_id","subject_id","class_id","difficulty");--> statement-breakpoint
CREATE INDEX "question_options_question_idx" ON "question_options" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "rubric_criteria_rubric_idx" ON "rubric_criteria" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "rubric_levels_criterion_idx" ON "rubric_levels" USING btree ("criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubrics_school_name_uq" ON "rubrics" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "rubrics_school_idx" ON "rubrics" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_assignment_summary_uq" ON "student_assignment_summary" USING btree ("student_enrollment_id","period_type","period_start","subject_id") WHERE subject_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "student_assignment_summary_all_subjects_uq" ON "student_assignment_summary" USING btree ("student_enrollment_id","period_type","period_start") WHERE subject_id IS NULL;--> statement-breakpoint
CREATE INDEX "student_assignment_summary_school_idx" ON "student_assignment_summary" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_assignments_assignment_student_uq" ON "student_assignments" USING btree ("assignment_id","student_enrollment_id");--> statement-breakpoint
CREATE INDEX "student_assignments_enrollment_status_idx" ON "student_assignments" USING btree ("student_enrollment_id","status");--> statement-breakpoint
CREATE INDEX "student_assignments_assignment_status_idx" ON "student_assignments" USING btree ("assignment_id","status");--> statement-breakpoint
CREATE INDEX "student_assignments_section_idx" ON "student_assignments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "student_assignments_missing_scan_idx" ON "student_assignments" USING btree ("effective_close_at") WHERE status IN ('assigned','in_progress');--> statement-breakpoint
CREATE INDEX "submission_files_submission_idx" ON "submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_sa_version_uq" ON "submissions" USING btree ("student_assignment_id","version_no");--> statement-breakpoint
CREATE INDEX "submissions_sa_idx" ON "submissions" USING btree ("student_assignment_id");