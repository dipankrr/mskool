CREATE TYPE "public"."id_card_orientation" AS ENUM('landscape', 'portrait');--> statement-breakpoint
CREATE TYPE "public"."id_card_template_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "storage_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_card_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"orientation" "id_card_orientation" DEFAULT 'landscape' NOT NULL,
	"canvas" jsonb NOT NULL,
	"elements" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"status" "id_card_template_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_photos" ADD CONSTRAINT "student_photos_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_photos" ADD CONSTRAINT "student_photos_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_photos" ADD CONSTRAINT "student_photos_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_card_templates" ADD CONSTRAINT "id_card_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_card_templates" ADD CONSTRAINT "id_card_templates_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_card_templates" ADD CONSTRAINT "id_card_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_objects_org_idx" ON "storage_objects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "storage_objects_org_sha_idx" ON "storage_objects" USING btree ("organization_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "student_photos_student_uq" ON "student_photos" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "id_card_templates_school_name_uq" ON "id_card_templates" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "id_card_templates_school_default_uq" ON "id_card_templates" USING btree ("school_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "id_card_templates_org_idx" ON "id_card_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "id_card_templates_school_idx" ON "id_card_templates" USING btree ("school_id");