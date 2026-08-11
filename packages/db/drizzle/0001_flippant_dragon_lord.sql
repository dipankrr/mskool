CREATE TYPE "public"."academic_year_status" AS ENUM('upcoming', 'active', 'closing', 'closed');--> statement-breakpoint
CREATE TYPE "public"."section_shift" AS ENUM('morning', 'day', 'evening');--> statement-breakpoint
CREATE TYPE "public"."section_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(20) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"original_end_date" date NOT NULL,
	"status" "academic_year_status" DEFAULT 'upcoming' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"numeric_order" smallint NOT NULL,
	"description" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"shift" "section_shift",
	"stream" varchar(50),
	"house" varchar(50),
	"max_students" smallint,
	"room_number" varchar(20),
	"status" "section_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_school_name_uq" ON "academic_years" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "academic_years_school_idx" ON "academic_years" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "academic_years_org_idx" ON "academic_years" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_school_order_uq" ON "classes" USING btree ("school_id","numeric_order");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_school_name_uq" ON "classes" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "classes_school_idx" ON "classes" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "classes_org_idx" ON "classes" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_year_class_name_uq" ON "sections" USING btree ("academic_year_id","class_id","name");--> statement-breakpoint
CREATE INDEX "sections_class_year_idx" ON "sections" USING btree ("class_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "sections_school_idx" ON "sections" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "sections_org_idx" ON "sections" USING btree ("organization_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- HAND-WRITTEN (ADR-013). Drizzle cannot express these; they are
-- re-applied by hand if this migration is ever regenerated.
--
-- drizzle-kit does not model EXCLUDE constraints at all. It will not
-- drop them on a diff (it cannot see them), but a regenerated 0001
-- will not contain them either — re-paste this block.
--
-- `pnpm db:verify` proves each one rejects the row it targets and
-- still accepts the legitimate row that most resembles it.
-- ─────────────────────────────────────────────────────────────

-- gist indexes over scalar types (uuid, boolean) need btree_gist.
-- Without it the two constraints below fail with "data type uuid has no
-- default operator class for access method gist".
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint

-- One school cannot run two overlapping academic years.
--
-- A plain UNIQUE cannot say this: the collision is between RANGES, not
-- values. Two years with different names and different start dates are
-- individually unique and still overlap by five months.
--
-- daterange(..., '[]') is inclusive at both ends, so a year ending
-- 2026-03-31 and the next starting 2026-03-31 is a conflict, not a
-- clean handover. That is deliberate — a student cannot be enrolled in
-- two years on the same day, and attendance for that date would have
-- two homes.
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_no_overlap_excl"
    EXCLUDE USING gist (
        "school_id" WITH =,
        daterange("start_date", "end_date", '[]') WITH &&
    );--> statement-breakpoint

-- At most one current year per school.
--
-- The WHERE clause is what makes this possible: every non-current row
-- is exempt, so a school may keep twenty closed years and still be
-- constrained to a single is_current = true.
--
-- This is an EXCLUDE rather than a partial unique index because the
-- rule is "no two rows may collide", not "this column is a key" — and
-- because promoting the next year is a two-statement operation whose
-- failure must be visible immediately.
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_one_current_excl"
    EXCLUDE USING btree ("school_id" WITH =)
    WHERE ("is_current");
