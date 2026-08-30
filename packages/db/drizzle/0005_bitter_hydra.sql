CREATE TYPE "public"."term_result_mode" AS ENUM('cumulative', 'terminal');--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"sequence_number" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"result_mode" "term_result_mode" DEFAULT 'cumulative' NOT NULL,
	"weightage" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_end_after_start" CHECK ("end_date" >= "start_date"),
	CONSTRAINT "terms_weightage_range" CHECK ("weightage" > 0 AND "weightage" <= 100)
);
--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_year_sequence_uq" ON "terms" USING btree ("academic_year_id","sequence_number");--> statement-breakpoint
CREATE INDEX "terms_year_idx" ON "terms" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "terms_school_idx" ON "terms" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "terms_org_idx" ON "terms" USING btree ("organization_id");--> statement-breakpoint
-- =============================================================================
-- HAND-WRITTEN (ADR-013 territory) — drizzle-kit cannot see this block. If this
-- migration is ever regenerated, RE-PASTE it. `pnpm db:verify` queries pg_trigger
-- for terms_dates_within_year_trg and proves it still bites.
--
-- A term must sit INSIDE its parent year's dates. A CHECK constraint cannot
-- reference another table, so this is a trigger. It reports itself with the
-- constraint name below, so translateErrors words it and db:verify can name it.
-- =============================================================================

CREATE OR REPLACE FUNCTION terms_dates_within_year_check() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM academic_years y
    WHERE y.id = NEW.academic_year_id
      AND (NEW.start_date < y.start_date OR NEW.end_date > y.end_date)
  ) THEN
    RAISE EXCEPTION 'term dates fall outside their academic year'
      USING ERRCODE = '23514',
            CONSTRAINT = 'terms_dates_within_year_trg',
            TABLE = 'terms';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER terms_dates_within_year_trg
  BEFORE INSERT OR UPDATE OF start_date, end_date, academic_year_id ON terms
  FOR EACH ROW
  EXECUTE FUNCTION terms_dates_within_year_check();
