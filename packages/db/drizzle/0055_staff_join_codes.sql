ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_invited';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_joined';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_left';--> statement-breakpoint
CREATE TABLE "staff_join_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_join_codes" ADD CONSTRAINT "staff_join_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_join_codes" ADD CONSTRAINT "staff_join_codes_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_join_codes" ADD CONSTRAINT "staff_join_codes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_join_codes_staff_idx" ON "staff_join_codes" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_join_codes_open_idx" ON "staff_join_codes" USING btree ("staff_id") WHERE "staff_join_codes"."used_at" IS NULL AND "staff_join_codes"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_org_phone_current_uq" ON "staff" USING btree ("organization_id","phone") WHERE "staff"."phone" IS NOT NULL AND "staff"."status" IN ('active', 'on_leave', 'suspended');--> statement-breakpoint
CREATE INDEX "staff_phone_idx" ON "staff" USING btree ("phone");