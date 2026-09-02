CREATE TYPE "public"."fee_assignment_status" AS ENUM('active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fee_concession_calculation" AS ENUM('flat', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."fee_concession_type" AS ENUM('sibling_discount', 'staff_ward', 'merit_scholarship', 'need_based', 'rte_waiver', 'management_discount', 'other');--> statement-breakpoint
CREATE TYPE "public"."fee_installment_payment_status" AS ENUM('unpaid', 'partial', 'paid', 'waived', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fee_payment_mode" AS ENUM('cash', 'upi', 'cheque', 'neft_rtgs', 'card', 'dd', 'online_portal');--> statement-breakpoint
CREATE TYPE "public"."fee_payment_status" AS ENUM('pending', 'cleared', 'bounced', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fee_refund_mode" AS ENUM('cash', 'upi', 'cheque', 'neft_rtgs', 'dd');--> statement-breakpoint
CREATE TYPE "public"."fee_refund_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fee_subscription_status" AS ENUM('active', 'cancelled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."financial_transaction_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."financial_transaction_type" AS ENUM('fee_payment', 'fee_refund', 'late_fee_charged', 'concession_applied', 'waiver_applied', 'opening_balance', 'opening_balance_payment', 'advance_payment', 'cheque_bounce_charge', 'security_deposit_received', 'security_deposit_refunded');--> statement-breakpoint
CREATE TYPE "public"."opening_balance_status" AS ENUM('unpaid', 'partial', 'paid', 'waived');--> statement-breakpoint
CREATE TABLE "fee_concessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_fee_assignment_id" uuid NOT NULL,
	"fee_head_id" uuid,
	"concession_type" "fee_concession_type" NOT NULL,
	"calculation_type" "fee_concession_calculation" NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"concession_amount" numeric(10, 2) NOT NULL,
	"reason" varchar(500),
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_concessions_value_positive" CHECK ("value" > 0),
	CONSTRAINT "fee_concessions_amount_non_negative" CHECK ("concession_amount" >= 0),
	CONSTRAINT "fee_concessions_percentage_range" CHECK ("calculation_type" <> 'percentage' OR "value" <= 100),
	CONSTRAINT "fee_concessions_validity_order" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from")
);
--> statement-breakpoint
CREATE TABLE "fee_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_fee_assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"fee_head_id" uuid NOT NULL,
	"term_id" uuid,
	"installment_number" smallint NOT NULL,
	"description" varchar(150),
	"amount" numeric(10, 2) NOT NULL,
	"concession_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(10, 2) NOT NULL,
	"due_date" date NOT NULL,
	"period_month" smallint,
	"period_year" smallint,
	"paid_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"balance_amount" numeric(10, 2) GENERATED ALWAYS AS ("net_amount" - "paid_amount") STORED,
	"payment_status" "fee_installment_payment_status" DEFAULT 'unpaid' NOT NULL,
	"late_fee_applicable" numeric(10, 2) DEFAULT '0' NOT NULL,
	"late_fee_charged" numeric(10, 2) DEFAULT '0' NOT NULL,
	"late_fee_waived" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_installments_amount_non_negative" CHECK ("amount" >= 0),
	CONSTRAINT "fee_installments_net_matches_parts" CHECK ("net_amount" = "amount" - "concession_amount"),
	CONSTRAINT "fee_installments_month_shape" CHECK ("period_month" IS NULL OR "period_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"receipt_number" varchar(50) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"late_fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(10, 2) GENERATED ALWAYS AS ("amount" + "late_fee_amount") STORED,
	"payment_date" date NOT NULL,
	"payment_mode" "fee_payment_mode" NOT NULL,
	"transaction_reference" varchar(150),
	"bank_name" varchar(100),
	"cheque_date" date,
	"payment_status" "fee_payment_status" DEFAULT 'cleared' NOT NULL,
	"status_updated_at" timestamp with time zone,
	"status_updated_by" text,
	"status_reason" varchar(255),
	"remarks" varchar(500),
	"collected_by" text,
	"client_reference" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "fee_payments_late_fee_non_negative" CHECK ("late_fee_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"original_payment_id" uuid NOT NULL,
	"refund_amount" numeric(10, 2) NOT NULL,
	"refund_date" date NOT NULL,
	"refund_mode" "fee_refund_mode" NOT NULL,
	"transaction_reference" varchar(150),
	"reason" varchar(500) NOT NULL,
	"status" "fee_refund_status" DEFAULT 'processed' NOT NULL,
	"approved_by" text,
	"processed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_refunds_amount_positive" CHECK ("refund_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid,
	"academic_year_id" uuid NOT NULL,
	"transaction_type" "financial_transaction_type" NOT NULL,
	"direction" "financial_transaction_direction" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"fee_head_id" uuid,
	"reference_id" uuid,
	"reference_table" varchar(50),
	"receipt_number" varchar(50),
	"description" varchar(500),
	"transaction_date" date NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"tax_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_transactions_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "opening_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"origin_academic_year_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" varchar(255),
	"paid_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"balance_amount" numeric(10, 2) GENERATED ALWAYS AS ("amount" - "paid_amount") STORED,
	"status" "opening_balance_status" DEFAULT 'unpaid' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balances_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount_allocated" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount_allocated" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_number_sequences" (
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"prefix" varchar(20) DEFAULT 'RCP' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_number_sequences_school_id_academic_year_id_pk" PRIMARY KEY("school_id","academic_year_id")
);
--> statement-breakpoint
CREATE TABLE "student_fee_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"fee_structure_id" uuid NOT NULL,
	"base_annual_amount" numeric(10, 2) NOT NULL,
	"net_annual_amount" numeric(10, 2) NOT NULL,
	"fee_effective_from" date NOT NULL,
	"joining_month_full_charge" boolean DEFAULT true NOT NULL,
	"status" "fee_assignment_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_optional_fee_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"fee_head_id" uuid NOT NULL,
	"service_detail" varchar(255),
	"monthly_amount" numeric(10, 2) NOT NULL,
	"annual_amount" numeric(10, 2) NOT NULL,
	"subscribed_from" date NOT NULL,
	"subscribed_to" date,
	"status" "fee_subscription_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_student_fee_assignment_id_student_fee_assignments_id_fk" FOREIGN KEY ("student_fee_assignment_id") REFERENCES "public"."student_fee_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_fee_head_id_fee_heads_id_fk" FOREIGN KEY ("fee_head_id") REFERENCES "public"."fee_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_student_fee_assignment_id_student_fee_assignments_id_fk" FOREIGN KEY ("student_fee_assignment_id") REFERENCES "public"."student_fee_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_fee_head_id_fee_heads_id_fk" FOREIGN KEY ("fee_head_id") REFERENCES "public"."fee_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_status_updated_by_user_id_fk" FOREIGN KEY ("status_updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_collected_by_user_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_original_payment_id_fee_payments_id_fk" FOREIGN KEY ("original_payment_id") REFERENCES "public"."fee_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_processed_by_user_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_fee_head_id_fee_heads_id_fk" FOREIGN KEY ("fee_head_id") REFERENCES "public"."fee_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_origin_academic_year_id_academic_years_id_fk" FOREIGN KEY ("origin_academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fee_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."fee_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_fee_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."fee_installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_number_sequences" ADD CONSTRAINT "receipt_number_sequences_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_number_sequences" ADD CONSTRAINT "receipt_number_sequences_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_fee_structure_id_fee_structures_id_fk" FOREIGN KEY ("fee_structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_optional_fee_subscriptions" ADD CONSTRAINT "student_optional_fee_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_optional_fee_subscriptions" ADD CONSTRAINT "student_optional_fee_subscriptions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_optional_fee_subscriptions" ADD CONSTRAINT "student_optional_fee_subscriptions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_optional_fee_subscriptions" ADD CONSTRAINT "student_optional_fee_subscriptions_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_optional_fee_subscriptions" ADD CONSTRAINT "student_optional_fee_subscriptions_fee_head_id_fee_heads_id_fk" FOREIGN KEY ("fee_head_id") REFERENCES "public"."fee_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_optional_fee_subscriptions" ADD CONSTRAINT "student_optional_fee_subscriptions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_concessions_assignment_idx" ON "fee_concessions" USING btree ("student_fee_assignment_id");--> statement-breakpoint
CREATE INDEX "fee_concessions_school_idx" ON "fee_concessions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_concessions_org_idx" ON "fee_concessions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_installments_assignment_head_number_uq" ON "fee_installments" USING btree ("student_fee_assignment_id","fee_head_id","installment_number");--> statement-breakpoint
CREATE INDEX "fee_installments_school_due_date_idx" ON "fee_installments" USING btree ("school_id","due_date");--> statement-breakpoint
CREATE INDEX "fee_installments_student_year_idx" ON "fee_installments" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "fee_installments_open_status_idx" ON "fee_installments" USING btree ("school_id","payment_status") WHERE payment_status IN ('unpaid', 'partial');--> statement-breakpoint
CREATE INDEX "fee_installments_assignment_idx" ON "fee_installments" USING btree ("student_fee_assignment_id");--> statement-breakpoint
CREATE INDEX "fee_installments_org_idx" ON "fee_installments" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payments_school_receipt_uq" ON "fee_payments" USING btree ("school_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payments_school_client_reference_uq" ON "fee_payments" USING btree ("school_id","client_reference") WHERE client_reference IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fee_payments_student_year_idx" ON "fee_payments" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "fee_payments_school_date_idx" ON "fee_payments" USING btree ("school_id","payment_date");--> statement-breakpoint
CREATE INDEX "fee_payments_school_status_idx" ON "fee_payments" USING btree ("school_id","payment_status");--> statement-breakpoint
CREATE INDEX "fee_payments_org_idx" ON "fee_payments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fee_refunds_payment_idx" ON "fee_refunds" USING btree ("original_payment_id");--> statement-breakpoint
CREATE INDEX "fee_refunds_student_idx" ON "fee_refunds" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "fee_refunds_school_idx" ON "fee_refunds" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_refunds_org_idx" ON "fee_refunds" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "financial_transactions_school_date_idx" ON "financial_transactions" USING btree ("school_id","transaction_date");--> statement-breakpoint
CREATE INDEX "financial_transactions_student_year_idx" ON "financial_transactions" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "financial_transactions_school_type_idx" ON "financial_transactions" USING btree ("school_id","transaction_type");--> statement-breakpoint
CREATE INDEX "financial_transactions_org_idx" ON "financial_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_balances_student_year_origin_uq" ON "opening_balances" USING btree ("student_id","academic_year_id","origin_academic_year_id");--> statement-breakpoint
CREATE INDEX "opening_balances_student_year_idx" ON "opening_balances" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "opening_balances_org_idx" ON "opening_balances" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_installment_uq" ON "payment_allocations" USING btree ("payment_id","installment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_installment_idx" ON "payment_allocations" USING btree ("installment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_org_idx" ON "payment_allocations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_fee_assignments_student_year_uq" ON "student_fee_assignments" USING btree ("school_id","student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_fee_assignments_student_idx" ON "student_fee_assignments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_fee_assignments_school_year_idx" ON "student_fee_assignments" USING btree ("school_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_fee_assignments_org_idx" ON "student_fee_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "student_optional_fee_subscriptions_student_year_idx" ON "student_optional_fee_subscriptions" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_optional_fee_subscriptions_school_idx" ON "student_optional_fee_subscriptions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_optional_fee_subscriptions_org_idx" ON "student_optional_fee_subscriptions" USING btree ("organization_id");
-- =============================================================================
-- HAND-WRITTEN (the Phase 4 plan, F2). Drizzle cannot express this; it is
-- appended to the generated migration like the academic_years EXCLUDEs in
-- 0001 and the double-mark guard in 0008. drizzle-kit will not drop it on a
-- diff, but a REGENERATED 0011 will not contain it either — this block must
-- be re-pasted, and `pnpm db:verify` proves it still bites.
-- =============================================================================

-- HARD RULE 3: the ledger is append-only.
--
-- financial_transactions is never updated, never deleted — corrections are
-- NEW offsetting rows, like double-entry bookkeeping. An application-only
-- rule protects nothing at 2am with psql open, so the database itself is the
-- last line of defense (the plan's money-safety layer 1).
--
-- UPDATE is blocked outright: a ledger row's past is its only value, and the
-- table deliberately carries no updated_at to make that legible.
-- DELETE is blocked outright: history is not negotiable. A mistaken row is
-- corrected by appending, not by erasing.
--
-- INSERT stays open — that is the entire point of an append-only ledger.
CREATE OR REPLACE FUNCTION financial_transactions_block_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'financial_transactions is append-only (hard rule 3): % is forbidden. Corrections are new offsetting rows.',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_transactions_append_only_trg
    BEFORE UPDATE OR DELETE ON "financial_transactions"
    FOR EACH ROW EXECUTE FUNCTION financial_transactions_block_mutation();
