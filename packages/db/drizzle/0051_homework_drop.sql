DROP TABLE "assignment_acknowledgements" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_comments" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_evaluations" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_extensions" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_question_settings" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_questions" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_resources" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_revisions" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_rubric_scores" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_series" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_settings" CASCADE;--> statement-breakpoint
DROP TABLE "assignment_targets" CASCADE;--> statement-breakpoint
DROP TABLE "assignments" CASCADE;--> statement-breakpoint
DROP TABLE "evaluation_files" CASCADE;--> statement-breakpoint
DROP TABLE "question_attempt_answer_files" CASCADE;--> statement-breakpoint
DROP TABLE "question_attempt_answers" CASCADE;--> statement-breakpoint
DROP TABLE "question_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "question_bank_items" CASCADE;--> statement-breakpoint
DROP TABLE "question_options" CASCADE;--> statement-breakpoint
DROP TABLE "rubric_criteria" CASCADE;--> statement-breakpoint
DROP TABLE "rubric_levels" CASCADE;--> statement-breakpoint
DROP TABLE "rubrics" CASCADE;--> statement-breakpoint
DROP TABLE "student_assignment_summary" CASCADE;--> statement-breakpoint
DROP TABLE "student_assignments" CASCADE;--> statement-breakpoint
DROP TABLE "submission_files" CASCADE;--> statement-breakpoint
DROP TABLE "submissions" CASCADE;--> statement-breakpoint
DROP TYPE "public"."assignment_completion_source";--> statement-breakpoint
DROP TYPE "public"."assignment_evaluation_outcome";--> statement-breakpoint
DROP TYPE "public"."assignment_grading_mode";--> statement-breakpoint
DROP TYPE "public"."assignment_kind";--> statement-breakpoint
DROP TYPE "public"."assignment_late_policy";--> statement-breakpoint
DROP TYPE "public"."assignment_resource_type";--> statement-breakpoint
DROP TYPE "public"."assignment_status";--> statement-breakpoint
DROP TYPE "public"."assignment_summary_period";--> statement-breakpoint
DROP TYPE "public"."assignment_target_type";--> statement-breakpoint
DROP TYPE "public"."homework_attempt_scoring";--> statement-breakpoint
DROP TYPE "public"."homework_attempt_status";--> statement-breakpoint
DROP TYPE "public"."homework_question_difficulty";--> statement-breakpoint
DROP TYPE "public"."homework_reveal_policy";--> statement-breakpoint
DROP TYPE "public"."homework_question_type";--> statement-breakpoint
DROP TYPE "public"."homework_question_visibility";--> statement-breakpoint
DROP TYPE "public"."student_assignment_status";--> statement-breakpoint
DROP TYPE "public"."submission_author_role";--> statement-breakpoint
DROP TYPE "public"."assignment_submission_type";--> statement-breakpoint
-- ADR-064: the homework tables are rebuilt from scratch (dev mode). Their files no longer have a
-- record, so hand them to the storage sweeper.
UPDATE "storage_objects" SET "status" = 'deleted', "deleted_at" = now() WHERE "purpose" IN ('homework_teacher_file', 'homework_student_file') AND "status" <> 'deleted';
