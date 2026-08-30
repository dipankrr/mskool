CREATE TYPE "public"."enrollment_status" AS ENUM('admitted', 'section_assigned', 'active', 'transferred_out', 'withdrawn', 'passed_out');--> statement-breakpoint
CREATE TYPE "public"."promotion_status" AS ENUM('pending', 'promoted', 'detained', 'compartment', 'promoted_with_improvement');--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"section_id" uuid,
	"roll_number" varchar(20),
	"stream" varchar(50),
	"house" varchar(50),
	"enrollment_date" date DEFAULT CURRENT_DATE NOT NULL,
	"enrollment_status" "enrollment_status" DEFAULT 'admitted' NOT NULL,
	"promotion_status" "promotion_status",
	"promotion_pending" boolean DEFAULT false NOT NULL,
	"created_from_template" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_enrollments_student_year_uq" ON "student_enrollments" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_school_year_idx" ON "student_enrollments" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_student_idx" ON "student_enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_section_idx" ON "student_enrollments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_class_year_idx" ON "student_enrollments" USING btree ("class_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_school_idx" ON "student_enrollments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_org_idx" ON "student_enrollments" USING btree ("organization_id");