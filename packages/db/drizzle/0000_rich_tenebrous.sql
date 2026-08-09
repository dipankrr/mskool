CREATE TYPE "public"."board_type" AS ENUM('cbse', 'icse', 'state', 'ib', 'unaffiliated');--> statement-breakpoint
CREATE TYPE "public"."authz_audit_action" AS ENUM('role_granted', 'role_revoked', 'role_expired', 'permission_added', 'permission_removed');--> statement-breakpoint
CREATE TYPE "public"."role_type" AS ENUM('org_admin', 'principal', 'vice_principal', 'class_teacher', 'subject_teacher', 'accountant', 'librarian', 'staff_coordinator');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('org', 'school', 'class', 'section');--> statement-breakpoint
CREATE TYPE "public"."blood_group" AS ENUM('a_positive', 'a_negative', 'b_positive', 'b_negative', 'o_positive', 'o_negative', 'ab_positive', 'ab_negative');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."guardian_relation" AS ENUM('father', 'mother', 'grandfather', 'grandmother', 'uncle', 'aunt', 'brother', 'sister', 'legal_guardian', 'other');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'on_leave', 'suspended', 'resigned', 'retired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."student_relationship_type" AS ENUM('sibling', 'twin', 'step_sibling');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'inactive', 'graduated', 'transferred_out', 'withdrawn', 'expelled');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_super_admin" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"registration_number" varchar(100),
	"pan_number" varchar(10),
	"email" varchar(255),
	"phone" varchar(20),
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(10),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"board" "board_type" DEFAULT 'cbse' NOT NULL,
	"affiliation_number" varchar(100),
	"udise_code" varchar(20),
	"email" varchar(255),
	"phone" varchar(20),
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(10),
	"principal_name" varchar(255),
	"established_on" date,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"action" "authz_audit_action" NOT NULL,
	"target_user_id" text,
	"actor_user_id" text,
	"role_type" "role_type",
	"scope_type" "scope_type",
	"scope_id" uuid,
	"permission" varchar(100),
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_type" "role_type" NOT NULL,
	"permission" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_type" "role_type" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "scope_type" NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid,
	"class_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100),
	"phone" varchar(20) NOT NULL,
	"alternate_phone" varchar(20),
	"email" varchar(255),
	"occupation" varchar(100),
	"annual_income" varchar(50),
	"qualification" varchar(100),
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(10),
	"aadhaar_number" varchar(12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "previous_school_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"school_name" varchar(255) NOT NULL,
	"board" varchar(100),
	"city" varchar(100),
	"state" varchar(100),
	"last_class_attended" varchar(50),
	"year_of_passing" varchar(20),
	"percentage_or_grade" varchar(20),
	"tc_number" varchar(100),
	"tc_date" date,
	"tc_document_url" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" text,
	"employee_code" varchar(50) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"middle_name" varchar(100),
	"last_name" varchar(100) NOT NULL,
	"gender" "gender",
	"date_of_birth" date,
	"phone" varchar(20),
	"email" varchar(255),
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(10),
	"designation" varchar(100),
	"department" varchar(100),
	"qualification" text,
	"date_of_joining" date,
	"date_of_leaving" date,
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"relation" "guardian_relation" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"can_access_portal" boolean DEFAULT true NOT NULL,
	"started_on" date,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"related_student_id" uuid NOT NULL,
	"relationship_type" "student_relationship_type" DEFAULT 'sibling' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"admission_number" varchar(50) NOT NULL,
	"admission_date" date,
	"first_name" varchar(100) NOT NULL,
	"middle_name" varchar(100),
	"last_name" varchar(100) NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" "gender" NOT NULL,
	"blood_group" "blood_group",
	"nationality" varchar(100),
	"religion" varchar(100),
	"category" varchar(50),
	"mother_tongue" varchar(100),
	"aadhaar_number" varchar(12),
	"phone" varchar(20),
	"email" varchar(255),
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(10),
	"medical_conditions" text,
	"emergency_contact_name" varchar(255),
	"emergency_contact_phone" varchar(20),
	"photo_url" text,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_audit_log" ADD CONSTRAINT "authz_audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_audit_log" ADD CONSTRAINT "authz_audit_log_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_audit_log" ADD CONSTRAINT "authz_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_permissions" ADD CONSTRAINT "org_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previous_school_records" ADD CONSTRAINT "previous_school_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_portal_access" ADD CONSTRAINT "student_portal_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_portal_access" ADD CONSTRAINT "student_portal_access_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_portal_access" ADD CONSTRAINT "student_portal_access_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_relationships" ADD CONSTRAINT "student_relationships_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_relationships" ADD CONSTRAINT "student_relationships_related_student_id_students_id_fk" FOREIGN KEY ("related_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_org_code_uq" ON "schools" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "schools_org_idx" ON "schools" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "authz_audit_log_org_idx" ON "authz_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "authz_audit_log_target_idx" ON "authz_audit_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "authz_audit_log_created_idx" ON "authz_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_role_permissions_uq" ON "org_role_permissions" USING btree ("organization_id","role_type","permission");--> statement-breakpoint
CREATE INDEX "org_role_permissions_org_role_idx" ON "org_role_permissions" USING btree ("organization_id","role_type");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_org_idx" ON "role_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "role_assignments_scope_idx" ON "role_assignments" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "scope_nodes_org_idx" ON "scope_nodes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scope_nodes_school_idx" ON "scope_nodes" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "scope_nodes_class_idx" ON "scope_nodes" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "guardians_org_idx" ON "guardians" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "guardians_phone_idx" ON "guardians" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "previous_school_records_student_idx" ON "previous_school_records" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_org_employee_code_uq" ON "staff" USING btree ("organization_id","employee_code");--> statement-breakpoint
CREATE INDEX "staff_school_idx" ON "staff" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "staff_user_idx" ON "staff" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_guardians_student_idx" ON "student_guardians" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_guardians_guardian_idx" ON "student_guardians" USING btree ("guardian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_portal_access_uq" ON "student_portal_access" USING btree ("user_id","student_id");--> statement-breakpoint
CREATE INDEX "student_portal_access_user_idx" ON "student_portal_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_portal_access_student_idx" ON "student_portal_access" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_relationships_uq" ON "student_relationships" USING btree ("student_id","related_student_id");--> statement-breakpoint
CREATE INDEX "student_relationships_student_idx" ON "student_relationships" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_school_admission_number_uq" ON "students" USING btree ("school_id","admission_number");--> statement-breakpoint
CREATE INDEX "students_org_idx" ON "students" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "students_school_status_idx" ON "students" USING btree ("school_id","status");
--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────
-- HAND-WRITTEN (ADR-013). Drizzle cannot express these; they are
-- re-applied by hand if this migration is ever regenerated.
--
-- These encode invariants that packages/authz ALREADY ASSUMES. Without
-- them a violating row does not error — it silently authorizes the wrong
-- rows, which is the worst failure mode available to us.
-- ─────────────────────────────────────────────────────────────

-- scopeCovers() answers an org-scoped grant with
-- `node.organizationId === assignment.scopeId`. If scope_id diverges from
-- organization_id the grant either never matches (dead role, looks like a
-- permissions bug) or matches against the wrong tenant's id.
ALTER TABLE "role_assignments"
  ADD CONSTRAINT "role_assignments_org_scope_id_matches_org"
  CHECK ("scope_type" <> 'org' OR "scope_id" = "organization_id");
--> statement-breakpoint

-- Shape of a denormalised ancestry row (ADR-015). dataScopeFromNode() reads
-- node.id as the schoolId of a school node, node.school_id as the schoolId of
-- a class/section node, and so on — so a NULL in the wrong place yields a
-- DataScope with a missing level, i.e. a filter that is too WIDE.
--
-- Org rows are synthetic (scope.ts: "Org scope has no scope_nodes row to
-- load") and normally absent; if one is ever written, it must at least be
-- shaped correctly rather than silently inconsistent.
ALTER TABLE "scope_nodes"
  ADD CONSTRAINT "scope_nodes_shape_matches_type"
  CHECK (
       ("type" = 'org'     AND "id" = "organization_id"
                           AND "school_id" IS NULL     AND "class_id" IS NULL)
    OR ("type" = 'school'  AND "school_id" IS NULL     AND "class_id" IS NULL)
    OR ("type" = 'class'   AND "school_id" IS NOT NULL AND "class_id" IS NULL)
    OR ("type" = 'section' AND "school_id" IS NOT NULL AND "class_id" IS NOT NULL)
  );
