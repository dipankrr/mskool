CREATE TYPE "public"."assignment_grading_mode" AS ENUM('none', 'marks', 'grade', 'remark');--> statement-breakpoint
CREATE TYPE "public"."assignment_kind" AS ENUM('homework', 'practice', 'project', 'reading', 'quiz');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('draft', 'scheduled', 'published', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_target_type" AS ENUM('section', 'student');--> statement-breakpoint
CREATE TYPE "public"."homework_check_status" AS ENUM('done', 'incomplete', 'not_done', 'absent');--> statement-breakpoint
CREATE TYPE "public"."homework_comes_back" AS ENUM('brought', 'sent', 'tick', 'none', 'questions');--> statement-breakpoint
CREATE TYPE "public"."homework_remark" AS ENUM('excellent', 'good', 'bad');--> statement-breakpoint
CREATE TYPE "public"."homework_tick_source" AS ENUM('student', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."homework_attempt_status" AS ENUM('in_progress', 'submitted', 'graded');--> statement-breakpoint
CREATE TYPE "public"."homework_question_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."homework_reveal_policy" AS ENUM('never', 'after_submit', 'after_close');--> statement-breakpoint
CREATE TYPE "public"."homework_question_type" AS ENUM('mcq_single', 'mcq_multi', 'true_false', 'fill_blank', 'numeric', 'match', 'short_answer', 'long_answer', 'file_upload');--> statement-breakpoint
CREATE TYPE "public"."homework_question_visibility" AS ENUM('private', 'school');--> statement-breakpoint
CREATE TYPE "public"."student_assignment_status" AS ENUM('assigned', 'in_progress', 'submitted', 'redo', 'checked', 'missing');--> statement-breakpoint
CREATE TABLE "assignment_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_assignment_id" uuid,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
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
	"source_assignment_id" uuid,
	"kind" "assignment_kind" NOT NULL,
	"comes_back" "homework_comes_back" NOT NULL,
	"title" varchar(250) NOT NULL,
	"description" text,
	"topic" varchar(250),
	"estimated_minutes" integer,
	"grading_mode" "assignment_grading_mode" DEFAULT 'none' NOT NULL,
	"max_marks" numeric(7, 2),
	"grading_scale_id" uuid,
	"publish_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"status" "assignment_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"is_locked" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_close_after_due" CHECK (close_at >= due_at),
	CONSTRAINT "assignments_quiz_questions" CHECK ((kind = 'quiz') = (comes_back = 'questions')),
	CONSTRAINT "assignments_grading_needs_return" CHECK (grading_mode = 'none' OR comes_back IN ('brought','sent','questions')),
	CONSTRAINT "assignment_marks_require_max" CHECK (grading_mode <> 'marks' OR max_marks IS NOT NULL),
	CONSTRAINT "assignment_grade_requires_scale" CHECK (grading_mode <> 'grade' OR grading_scale_id IS NOT NULL)
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
CREATE TABLE "student_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_enrollment_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"status" "student_assignment_status" DEFAULT 'assigned' NOT NULL,
	"effective_due_at" timestamp with time zone NOT NULL,
	"effective_close_at" timestamp with time zone NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"ticked_by" "homework_tick_source",
	"check_status" "homework_check_status",
	"marks" numeric(7, 2),
	"grade" varchar(20),
	"remark" "homework_remark",
	"note" text,
	"checked_by" text,
	"checked_at" timestamp with time zone,
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
	"body_text" text,
	"submitted_by_user_id" text NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_files" ADD CONSTRAINT "assignment_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_files" ADD CONSTRAINT "assignment_files_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_files" ADD CONSTRAINT "assignment_files_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_files" ADD CONSTRAINT "assignment_files_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_settings" ADD CONSTRAINT "assignment_question_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_settings" ADD CONSTRAINT "assignment_question_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_settings" ADD CONSTRAINT "assignment_question_settings_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_source_question_id_question_bank_items_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."question_bank_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_image_object_id_storage_objects_id_fk" FOREIGN KEY ("image_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_source_assignment_id_assignments_id_fk" FOREIGN KEY ("source_assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_student_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("student_enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_assignment_id_student_assignments_id_fk" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_comments_assignment_idx" ON "assignment_comments" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "assignment_comments_sa_idx" ON "assignment_comments" USING btree ("student_assignment_id") WHERE student_assignment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assignment_files_assignment_idx" ON "assignment_files" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_files_object_idx" ON "assignment_files" USING btree ("object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_question_settings_assignment_uq" ON "assignment_question_settings" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_questions_assignment_position_uq" ON "assignment_questions" USING btree ("assignment_id","position");--> statement-breakpoint
CREATE INDEX "assignment_questions_assignment_idx" ON "assignment_questions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_questions_image_idx" ON "assignment_questions" USING btree ("image_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_targets_section_uq" ON "assignment_targets" USING btree ("assignment_id","section_id") WHERE section_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_targets_student_uq" ON "assignment_targets" USING btree ("assignment_id","student_enrollment_id") WHERE student_enrollment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assignment_targets_section_idx" ON "assignment_targets" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "assignments_school_year_status_idx" ON "assignments" USING btree ("school_id","academic_year_id","status");--> statement-breakpoint
CREATE INDEX "assignments_subject_due_idx" ON "assignments" USING btree ("subject_id","due_at");--> statement-breakpoint
CREATE INDEX "assignments_status_due_idx" ON "assignments" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "assignments_created_by_idx" ON "assignments" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "question_attempt_answer_files_answer_idx" ON "question_attempt_answer_files" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "question_attempt_answer_files_object_idx" ON "question_attempt_answer_files" USING btree ("object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_attempt_answers_attempt_question_uq" ON "question_attempt_answers" USING btree ("attempt_id","assignment_question_id");--> statement-breakpoint
CREATE INDEX "question_attempt_answers_review_idx" ON "question_attempt_answers" USING btree ("attempt_id") WHERE needs_manual_review;--> statement-breakpoint
CREATE UNIQUE INDEX "question_attempts_sa_uq" ON "question_attempts" USING btree ("student_assignment_id");--> statement-breakpoint
CREATE INDEX "question_bank_lookup_idx" ON "question_bank_items" USING btree ("school_id","subject_id","class_id","difficulty");--> statement-breakpoint
CREATE INDEX "question_bank_items_image_idx" ON "question_bank_items" USING btree ("image_object_id");--> statement-breakpoint
CREATE INDEX "question_options_question_idx" ON "question_options" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "question_options_image_idx" ON "question_options" USING btree ("image_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_assignments_assignment_student_uq" ON "student_assignments" USING btree ("assignment_id","student_enrollment_id");--> statement-breakpoint
CREATE INDEX "student_assignments_enrollment_status_idx" ON "student_assignments" USING btree ("student_enrollment_id","status");--> statement-breakpoint
CREATE INDEX "student_assignments_assignment_section_idx" ON "student_assignments" USING btree ("assignment_id","section_id");--> statement-breakpoint
CREATE INDEX "student_assignments_section_idx" ON "student_assignments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "student_assignments_close_scan_idx" ON "student_assignments" USING btree ("effective_close_at") WHERE status IN ('assigned','in_progress','redo');--> statement-breakpoint
CREATE INDEX "submission_files_submission_idx" ON "submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_files_object_idx" ON "submission_files" USING btree ("object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_sa_uq" ON "submissions" USING btree ("student_assignment_id");