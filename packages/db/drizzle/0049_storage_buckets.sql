DROP INDEX "storage_objects_org_idx";--> statement-breakpoint
ALTER TABLE "storage_objects" ALTER COLUMN "visibility" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "storage_objects" ALTER COLUMN "content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ALTER COLUMN "size_bytes" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "school_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "purpose" "storage_purpose" NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "status" "storage_object_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "path" varchar(300) NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "attached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_objects_org_purpose_idx" ON "storage_objects" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE INDEX "storage_objects_status_created_idx" ON "storage_objects" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "storage_objects_unattached_idx" ON "storage_objects" USING btree ("ready_at") WHERE status = 'ready' AND attached_at IS NULL;--> statement-breakpoint
CREATE INDEX "student_photos_object_idx" ON "student_photos" USING btree ("object_id");