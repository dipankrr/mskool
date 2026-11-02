# Fees backend needs

The list this file used to carry was built by the fees overhaul (ADR-058): session aggregates and
dues rows with student and class joined (`fees.dashboard.overview`, `.list`, `.student`), the
`sectionId` filter, and a late-fee preview (`fees.payment.quote`).

Still missing:

1. **Refund list endpoint.** The ledger's `fee_refund` rows are the read path today. The student
   read carries a per-receipt refunded total.
2. **Receipt PDF.** A listed go-live need.
3. **A real fee report.** "View detailed fee report" on the dashboard only opens Payments.
4. **Gateway.** The webhook route answers 404 until `FEE_WEBHOOK_SECRET` is set, and no gateway is
   wired up.
