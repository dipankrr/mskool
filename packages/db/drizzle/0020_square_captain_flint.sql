-- The two Phase 5 result actions were already added by 0019; this
-- migration adds only the ADR-007 credential actions.
--
-- Fresh-database note: ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block, and `drizzle-kit migrate` wraps each file in one —
-- so a from-scratch migrate fails on 0019-0021 unless those statements
-- are applied outside a transaction first (plain psql), after which the
-- IF NOT EXISTS below makes the migrate a no-op for them. `db:verify`
-- names the enum's values post-hoc.
ALTER TYPE "public"."authz_audit_action" ADD VALUE IF NOT EXISTS 'portal_activated';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE IF NOT EXISTS 'portal_password_reset';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE IF NOT EXISTS 'portal_phone_changed';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");