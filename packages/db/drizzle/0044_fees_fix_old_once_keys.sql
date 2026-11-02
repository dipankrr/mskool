-- 0039 keyed old one-time dues as `n:1`, but a one-time line's period is `once`. The
-- generator didn't recognise them and created each fee a second time. Cancel those
-- never-paid twins (no money or ledger row is on them), then give the old dues the
-- right key so the generator sees them from now on.
UPDATE "fee_installments" twin
SET "payment_status" = 'cancelled', "period_key" = 'once-dup:' || twin."id"
FROM "fee_installments" old
WHERE twin."period_key" = 'once'
  AND twin."paid_amount" = 0
  AND old."period_key" LIKE 'n:%'
  AND old."student_fee_assignment_id" = twin."student_fee_assignment_id"
  AND old."fee_head_id" = twin."fee_head_id"
  AND NOT EXISTS (SELECT 1 FROM "payment_allocations" pa WHERE pa."installment_id" = twin."id");--> statement-breakpoint
UPDATE "fee_installments" i
SET "period_key" = 'once'
FROM "student_fee_assignments" a, "fee_structure_lines" l
WHERE i."period_key" LIKE 'n:%'
  AND a."id" = i."student_fee_assignment_id"
  AND l."fee_structure_id" = a."fee_structure_id"
  AND l."fee_head_id" = i."fee_head_id"
  AND l."frequency" = 'once'
  AND NOT EXISTS (
    SELECT 1 FROM "fee_installments" other
    WHERE other."student_fee_assignment_id" = i."student_fee_assignment_id"
      AND other."fee_head_id" = i."fee_head_id"
      AND other."period_key" = 'once'
  );
