CREATE TYPE "public"."subject_category" AS ENUM('scholastic', 'coscholastic', 'vocational', 'language');--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"short_name" varchar(20),
	"code" varchar(20),
	"category" "subject_category" DEFAULT 'scholastic' NOT NULL,
	"counts_toward_result" boolean DEFAULT true NOT NULL,
	"is_graded_only" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_school_name_uq" ON "subjects" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "subjects_school_idx" ON "subjects" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "subjects_org_idx" ON "subjects" USING btree ("organization_id");