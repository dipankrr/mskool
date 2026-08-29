CREATE TYPE "public"."teacher_assignment_role" AS ENUM('class_teacher', 'subject_teacher', 'co_teacher', 'activity_teacher');--> statement-breakpoint
CREATE TABLE "class_subject_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"is_elective" boolean DEFAULT false NOT NULL,
	"sequence_number" smallint DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_teacher_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "teacher_assignment_role" NOT NULL,
	"subject_id" uuid,
	"effective_from" date DEFAULT CURRENT_DATE NOT NULL,
	"effective_to" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sta_subject_matches_role" CHECK (("section_teacher_assignments"."role" = 'subject_teacher' AND "section_teacher_assignments"."subject_id" IS NOT NULL)
          OR ("section_teacher_assignments"."role" <> 'subject_teacher' AND "section_teacher_assignments"."subject_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD CONSTRAINT "class_subject_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD CONSTRAINT "class_subject_mappings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD CONSTRAINT "class_subject_mappings_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD CONSTRAINT "class_subject_mappings_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD CONSTRAINT "class_subject_mappings_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subject_mappings" ADD CONSTRAINT "class_subject_mappings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teacher_assignments" ADD CONSTRAINT "section_teacher_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_subject_mappings_year_class_subject_uq" ON "class_subject_mappings" USING btree ("academic_year_id","class_id","subject_id");--> statement-breakpoint
CREATE INDEX "class_subject_mappings_class_year_idx" ON "class_subject_mappings" USING btree ("class_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "class_subject_mappings_school_idx" ON "class_subject_mappings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "class_subject_mappings_org_idx" ON "class_subject_mappings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "section_teacher_assignments_section_idx" ON "section_teacher_assignments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "section_teacher_assignments_user_idx" ON "section_teacher_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "section_teacher_assignments_school_idx" ON "section_teacher_assignments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "section_teacher_assignments_org_idx" ON "section_teacher_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "section_teacher_assignments_active_idx" ON "section_teacher_assignments" USING btree ("section_id") WHERE "section_teacher_assignments"."effective_to" IS NULL;