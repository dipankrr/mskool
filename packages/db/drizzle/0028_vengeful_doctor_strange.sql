CREATE TYPE "public"."object_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "visibility" "object_visibility" DEFAULT 'private' NOT NULL;