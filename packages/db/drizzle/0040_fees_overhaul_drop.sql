ALTER TABLE "fee_structure_lines" DROP CONSTRAINT "fee_structure_lines_month_range";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" DROP CONSTRAINT "fee_structure_lines_month_order";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" DROP CONSTRAINT "fee_structure_lines_amount_non_negative";--> statement-breakpoint
DROP INDEX "fee_installments_assignment_head_number_uq";--> statement-breakpoint
DROP INDEX "fee_structures_class_year_uq";--> statement-breakpoint
DROP INDEX "opening_balances_student_year_origin_uq";--> statement-breakpoint
ALTER TABLE "fee_installments" ALTER COLUMN "student_fee_assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_installments" ALTER COLUMN "period_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ALTER COLUMN "frequency" SET DEFAULT 'monthly';--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ALTER COLUMN "frequency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ALTER COLUMN "amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "opening_balances" ALTER COLUMN "origin_academic_year_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_installments_assignment_head_period_uq" ON "fee_installments" USING btree ("student_fee_assignment_id","fee_head_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structures_class_year_name_uq" ON "fee_structures" USING btree ("school_id","academic_year_id","class_id","name") WHERE is_active = TRUE;--> statement-breakpoint
ALTER TABLE "fee_installments" DROP COLUMN "installment_number";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" DROP COLUMN "annual_amount";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" DROP COLUMN "installment_frequency";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" DROP COLUMN "applicable_from_month";--> statement-breakpoint
ALTER TABLE "fee_structure_lines" DROP COLUMN "applicable_to_month";--> statement-breakpoint
ALTER TABLE "fee_structures" DROP COLUMN "installment_mode";--> statement-breakpoint
ALTER TABLE "student_fee_assignments" DROP COLUMN "base_annual_amount";--> statement-breakpoint
ALTER TABLE "student_fee_assignments" DROP COLUMN "net_annual_amount";--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_student_year_origin_uq" UNIQUE NULLS NOT DISTINCT("student_id","academic_year_id","origin_academic_year_id");--> statement-breakpoint
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_amount_non_negative" CHECK ("amount" >= 0);--> statement-breakpoint
DROP TYPE "public"."fee_installment_frequency";--> statement-breakpoint
DROP TYPE "public"."fee_installment_mode";