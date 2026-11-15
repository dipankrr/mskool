ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_suspended';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_reinstated';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_phone_changed';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'staff_moved';--> statement-breakpoint
ALTER TYPE "public"."authz_audit_action" ADD VALUE 'role_extended';--> statement-breakpoint
CREATE TABLE "staff_pending_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role_type" "role_type" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"assignment_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "status_until" date;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "staff_pending_roles" ADD CONSTRAINT "staff_pending_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pending_roles" ADD CONSTRAINT "staff_pending_roles_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pending_roles" ADD CONSTRAINT "staff_pending_roles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pending_roles" ADD CONSTRAINT "staff_pending_roles_assignment_id_role_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."role_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pending_roles" ADD CONSTRAINT "staff_pending_roles_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_pending_roles_staff_idx" ON "staff_pending_roles" USING btree ("staff_id");