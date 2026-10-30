ALTER TABLE "annual_result_policies" ALTER COLUMN "annual_subject_pass_percent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "student_final_subject_results" ADD COLUMN "pass_mark" numeric(5, 2);