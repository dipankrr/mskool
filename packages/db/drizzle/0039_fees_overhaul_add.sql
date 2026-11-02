CREATE TYPE "public"."fee_concession_status" AS ENUM('active', 'void');--> statement-breakpoint
CREATE TYPE "public"."fee_line_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'term_wise', 'once');--> statement-breakpoint
CREATE TYPE "public"."fee_who_pays" AS ENUM('everyone', 'new_students');--> statement-breakpoint
CREATE TYPE "public"."late_fee_apply_per" AS ENUM('fee', 'month');--> statement-breakpoint
ALTER TYPE "public"."opening_balance_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "fee_line_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"fee_structure_line_id" uuid NOT NULL,
	"period_key" varchar(60) NOT NULL,
	"label" varchar(100) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"term_id" uuid,
	"amount_edited" boolean DEFAULT false NOT NULL,
	"due_date_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_line_periods_amount_non_negative" CHECK ("amount" >= 0),
	CONSTRAINT "fee_line_periods_date_order" CHECK ("end_date" >= "start_date")
);
--> statement-breakpoint
CREATE TABLE "fee_session_settings" (
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"charged_months" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_day" smallint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_session_settings_school_id_academic_year_id_pk" PRIMARY KEY("school_id","academic_year_id"),
	CONSTRAINT "fee_session_settings_due_day" CHECK ("due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "fee_structure_sections" (
	"fee_structure_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	CONSTRAINT "fee_structure_sections_fee_structure_id_section_id_pk" PRIMARY KEY("fee_structure_id","section_id")
);
--> statement-breakpoint
ALTER TABLE "fee_installments" DROP CONSTRAINT "fee_installments_net_matches_parts";--> statement-breakpoint
ALTER TABLE "fee_installments" DROP CONSTRAINT "fee_installments_concession_capped";--> statement-breakpoint
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_amount_positive";--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "fee_generation_mode" SET DEFAULT 'monthly_auto';--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD COLUMN "covered_periods" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD COLUMN "status" "fee_concession_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD COLUMN "void_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "fee_installments" ADD COLUMN "period_key" varchar(60);--> statement-breakpoint
ALTER TABLE "fee_installments" ADD COLUMN "discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD COLUMN "late_fee_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD COLUMN "discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD COLUMN "frequency" "fee_line_frequency";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD COLUMN "amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD COLUMN "who_pays" "fee_who_pays" DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD COLUMN "billing_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD COLUMN "apply_per" "late_fee_apply_per" DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "late_fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "late_fee_waived" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD COLUMN "is_new_student" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_line_periods" ADD CONSTRAINT "fee_line_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_line_periods" ADD CONSTRAINT "fee_line_periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_line_periods" ADD CONSTRAINT "fee_line_periods_fee_structure_line_id_fee_structure_lines_id_fk" FOREIGN KEY ("fee_structure_line_id") REFERENCES "public"."fee_structure_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_line_periods" ADD CONSTRAINT "fee_line_periods_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_session_settings" ADD CONSTRAINT "fee_session_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_session_settings" ADD CONSTRAINT "fee_session_settings_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_session_settings" ADD CONSTRAINT "fee_session_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_sections" ADD CONSTRAINT "fee_structure_sections_fee_structure_id_fee_structures_id_fk" FOREIGN KEY ("fee_structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_sections" ADD CONSTRAINT "fee_structure_sections_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_line_periods_line_key_uq" ON "fee_line_periods" USING btree ("fee_structure_line_id","period_key");--> statement-breakpoint
CREATE INDEX "fee_line_periods_school_idx" ON "fee_line_periods" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_line_periods_org_idx" ON "fee_line_periods" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structure_sections_section_uq" ON "fee_structure_sections" USING btree ("section_id");--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_transactions_school_receipt_idx" ON "financial_transactions" USING btree ("school_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "student_optional_fee_subscriptions_one_active_uq" ON "student_optional_fee_subscriptions" USING btree ("student_id","academic_year_id","fee_head_id") WHERE status = 'active';--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_net_matches_parts" CHECK ("net_amount" = "amount" - "concession_amount" - "discount_amount");--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_concession_capped" CHECK ("concession_amount" + "discount_amount" <= "amount");--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_discount_non_negative" CHECK ("discount_amount" >= 0);--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_non_negative" CHECK ("amount_allocated" >= 0);--> statement-breakpoint
UPDATE "fee_installments" i SET "period_key" = k.key FROM (
  SELECT id,
    CASE WHEN rn = 1 THEN base ELSE base || ':' || installment_number END AS key
  FROM (
    SELECT id, installment_number, base,
      row_number() OVER (PARTITION BY student_fee_assignment_id, fee_head_id, base ORDER BY installment_number) AS rn
    FROM (
      SELECT id, installment_number, student_fee_assignment_id, fee_head_id,
        CASE
          WHEN period_month IS NOT NULL THEN period_year || '-' || lpad(period_month::text, 2, '0')
          WHEN term_id IS NOT NULL THEN 'term:' || term_id
          ELSE 'n:' || installment_number
        END AS base
      FROM "fee_installments"
    ) a
  ) b
) k WHERE k.id = i.id;--> statement-breakpoint
UPDATE "fee_structure_lines" l SET
  "frequency" = (CASE
    WHEN l.installment_frequency = 'inherit' AND s.installment_mode = 'upfront' THEN 'once'
    WHEN l.installment_frequency = 'inherit' THEN s.installment_mode::text
    WHEN l.installment_frequency = 'annual' THEN 'once'
    ELSE l.installment_frequency::text
  END)::"fee_line_frequency",
  "amount" = l.annual_amount
FROM "fee_structures" s WHERE s.id = l.fee_structure_id;
