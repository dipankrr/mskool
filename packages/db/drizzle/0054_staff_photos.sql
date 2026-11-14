CREATE TABLE "staff_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "teaches_classes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_photos_staff_uq" ON "staff_photos" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_photos_object_idx" ON "staff_photos" USING btree ("object_id");--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN "photo_url";