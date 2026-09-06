-- The two Phase 5 result actions were already added by 0019; this
-- migration adds only the ADR-007 credential actions.
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'portal_activated';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'portal_password_reset';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'portal_phone_changed';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");