CREATE TYPE "public"."fee_dues_run_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "fee_dues_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid,
	"through" date NOT NULL,
	"status" "fee_dues_run_status" DEFAULT 'running' NOT NULL,
	"student_count" integer DEFAULT 0 NOT NULL,
	"students_with_new_dues" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "fee_generation_mode" SET DATA TYPE text;--> statement-breakpoint
UPDATE "schools" SET "fee_generation_mode" = 'monthly_auto' WHERE "fee_generation_mode" = 'all_now';--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "fee_generation_mode" SET DEFAULT 'monthly_auto'::text;--> statement-breakpoint
DROP TYPE "public"."fee_generation_mode";--> statement-breakpoint
CREATE TYPE "public"."fee_generation_mode" AS ENUM('monthly_auto', 'monthly_manual');--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "fee_generation_mode" SET DEFAULT 'monthly_auto'::"public"."fee_generation_mode";--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "fee_generation_mode" SET DATA TYPE "public"."fee_generation_mode" USING "fee_generation_mode"::"public"."fee_generation_mode";--> statement-breakpoint
ALTER TABLE "fee_heads" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_dues_runs" ADD CONSTRAINT "fee_dues_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_dues_runs" ADD CONSTRAINT "fee_dues_runs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_dues_runs" ADD CONSTRAINT "fee_dues_runs_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_dues_runs" ADD CONSTRAINT "fee_dues_runs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_dues_runs" ADD CONSTRAINT "fee_dues_runs_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_dues_runs_one_running_uq" ON "fee_dues_runs" USING btree ("school_id","academic_year_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "fee_dues_runs_school_year_idx" ON "fee_dues_runs" USING btree ("school_id","academic_year_id","started_at");--> statement-breakpoint
CREATE INDEX "fee_dues_runs_org_idx" ON "fee_dues_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_heads_one_system_uq" ON "fee_heads" USING btree ("school_id") WHERE "is_system";