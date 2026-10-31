ALTER TABLE "subject_types" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_types_school_default_uq" ON "subject_types" USING btree ("school_id") WHERE is_default = true;--> statement-breakpoint
-- Schools that took the starter set start with its everyday type as the default.
UPDATE "subject_types" SET "is_default" = true WHERE "name" = 'Main Subjects' AND "is_active" = true;
