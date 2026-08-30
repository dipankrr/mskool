CREATE TYPE "public"."attendance_daily_status_rule" AS ENUM('homeroom_authoritative', 'threshold_percentage');--> statement-breakpoint
CREATE TYPE "public"."attendance_marking_mode" AS ENUM('daily', 'period_wise');--> statement-breakpoint
CREATE TYPE "public"."calendar_day_type" AS ENUM('working', 'holiday', 'half_day', 'weekend', 'exam_day');--> statement-breakpoint
CREATE TABLE "academic_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"date" date NOT NULL,
	"day_type" "calendar_day_type" NOT NULL,
	"reason" varchar(255),
	"created_from_template" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"marking_mode" "attendance_marking_mode" DEFAULT 'daily' NOT NULL,
	"daily_status_rule" "attendance_daily_status_rule" DEFAULT 'homeroom_authoritative' NOT NULL,
	"threshold_percentage" smallint,
	"late_arrival_minutes" smallint DEFAULT 15 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_policies_threshold_range" CHECK ("threshold_percentage" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"sequence_number" smallint NOT NULL,
	"is_homeroom" boolean DEFAULT false NOT NULL,
	"subject_id" uuid,
	"teacher_id" text,
	"start_time" time,
	"end_time" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_calendar" ADD CONSTRAINT "academic_calendar_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_calendar" ADD CONSTRAINT "academic_calendar_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_calendar" ADD CONSTRAINT "academic_calendar_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_calendar" ADD CONSTRAINT "academic_calendar_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_calendar_school_year_date_uq" ON "academic_calendar" USING btree ("school_id","academic_year_id","date");--> statement-breakpoint
CREATE INDEX "academic_calendar_school_date_idx" ON "academic_calendar" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "academic_calendar_org_idx" ON "academic_calendar" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_policies_school_uq" ON "attendance_policies" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "attendance_policies_org_idx" ON "attendance_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "periods_section_year_sequence_uq" ON "periods" USING btree ("section_id","academic_year_id","sequence_number");--> statement-breakpoint
CREATE INDEX "periods_section_year_idx" ON "periods" USING btree ("section_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "periods_school_idx" ON "periods" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "periods_org_idx" ON "periods" USING btree ("organization_id");