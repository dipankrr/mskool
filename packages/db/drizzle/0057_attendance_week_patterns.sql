CREATE TABLE "attendance_week_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"weekdays" "calendar_day_type"[] NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_week_patterns_seven_days" CHECK (cardinality("attendance_week_patterns"."weekdays") = 7)
);
--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ADD CONSTRAINT "attendance_week_patterns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ADD CONSTRAINT "attendance_week_patterns_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ADD CONSTRAINT "attendance_week_patterns_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ADD CONSTRAINT "attendance_week_patterns_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_week_patterns_school_year_uq" ON "attendance_week_patterns" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "attendance_week_patterns_org_idx" ON "attendance_week_patterns" USING btree ("organization_id");