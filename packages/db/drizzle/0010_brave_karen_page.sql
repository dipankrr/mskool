CREATE TYPE "public"."fee_head_category" AS ENUM('regular', 'one_time', 'optional', 'fine', 'refundable');--> statement-breakpoint
CREATE TYPE "public"."fee_installment_frequency" AS ENUM('inherit', 'monthly', 'quarterly', 'half_yearly', 'annual', 'term_wise');--> statement-breakpoint
CREATE TYPE "public"."fee_installment_mode" AS ENUM('upfront', 'term_wise', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."late_fee_calculation_type" AS ENUM('flat', 'percentage', 'per_day');--> statement-breakpoint
CREATE TABLE "fee_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"short_code" varchar(20),
	"description" varchar(255),
	"category" "fee_head_category" DEFAULT 'regular' NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"tax_percentage" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_structure_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"fee_structure_id" uuid NOT NULL,
	"fee_head_id" uuid NOT NULL,
	"annual_amount" numeric(10, 2) NOT NULL,
	"installment_frequency" "fee_installment_frequency" DEFAULT 'inherit' NOT NULL,
	"applicable_from_month" smallint DEFAULT 1 NOT NULL,
	"applicable_to_month" smallint DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structure_lines_amount_non_negative" CHECK ("annual_amount" >= 0),
	CONSTRAINT "fee_structure_lines_month_range" CHECK (("applicable_from_month" BETWEEN 1 AND 12)
          AND ("applicable_to_month" BETWEEN 1 AND 12)),
	CONSTRAINT "fee_structure_lines_month_order" CHECK ("applicable_from_month" <= "applicable_to_month")
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"installment_mode" "fee_installment_mode" DEFAULT 'term_wise' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "late_fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"fee_structure_id" uuid,
	"grace_period_days" smallint DEFAULT 0 NOT NULL,
	"calculation_type" "late_fee_calculation_type" NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"max_late_fee" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_fee_rules_value_positive" CHECK ("value" > 0),
	CONSTRAINT "late_fee_rules_date_order" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_fee_structure_id_fee_structures_id_fk" FOREIGN KEY ("fee_structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_fee_head_id_fee_heads_id_fk" FOREIGN KEY ("fee_head_id") REFERENCES "public"."fee_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_fee_structure_id_fee_structures_id_fk" FOREIGN KEY ("fee_structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_heads_school_name_uq" ON "fee_heads" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "fee_heads_school_idx" ON "fee_heads" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_heads_org_idx" ON "fee_heads" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structure_lines_structure_head_uq" ON "fee_structure_lines" USING btree ("fee_structure_id","fee_head_id");--> statement-breakpoint
CREATE INDEX "fee_structure_lines_structure_idx" ON "fee_structure_lines" USING btree ("fee_structure_id");--> statement-breakpoint
CREATE INDEX "fee_structure_lines_org_idx" ON "fee_structure_lines" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structures_class_year_uq" ON "fee_structures" USING btree ("school_id","academic_year_id","class_id");--> statement-breakpoint
CREATE INDEX "fee_structures_school_year_idx" ON "fee_structures" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "fee_structures_org_idx" ON "fee_structures" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "late_fee_rules_school_active_idx" ON "late_fee_rules" USING btree ("school_id") WHERE is_active = TRUE;--> statement-breakpoint
CREATE INDEX "late_fee_rules_structure_idx" ON "late_fee_rules" USING btree ("fee_structure_id");--> statement-breakpoint
CREATE INDEX "late_fee_rules_org_idx" ON "late_fee_rules" USING btree ("organization_id");