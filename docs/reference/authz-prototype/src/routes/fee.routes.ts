import { Router } from 'express';
import { and, or, eq } from 'drizzle-orm';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { p } from '../policies';
import { buildScopeWhere } from '../authz/scope';
import { db } from '../db/client';
import { feeHeads, feePayments } from '../db/schema.app';

// ============================================================================
// Fee routes — demonstrate the sub-resource split.
//
// The fee domain is deliberately split into multiple resources so permissions
// can be fine-grained:
//
//   fee_head:read            → see what fee types exist
//   fee_head:create/update   → define or change fee structures (admin-only)
//   fee_payment:create       → record a payment (accountant)
//   fee_payment:approve      → approve a payment (principal/org admin)   ← SENSITIVE
//   fee_waiver:approve       → approve a fee waiver                      ← SENSITIVE
//   fee_report:read/export   → see financial summaries
//
// An accountant might have: fee_head:read, fee_payment:create, fee_payment:read
// A principal might have:   fee_head:read, fee_payment:read, fee_payment:approve
// An org admin might have:  everything above + fee_head:create/delete
//
// All fee operations are school-scoped (or org-scoped for org accountants).
// URL: /orgs/:orgId/schools/:schoolId/fee-heads
//      /orgs/:orgId/schools/:schoolId/fee-payments
// ============================================================================

const router = Router();
router.use(authenticate);

// ── Fee Heads ─────────────────────────────────────────────────────────────────

router.get(
  '/orgs/:orgId/schools/:schoolId/fee-heads',
  authorize(p.one('fee_head:read')),
  async (req, res) => {
    const rows = await db.select()
      .from(feeHeads)
      .where(and(...buildScopeWhere(req.dataScope!, feeHeads)));
    res.json(rows);
  }
);

// Only org admins or specifically configured roles have fee_head:create.
// Default accountant template does NOT include this.
router.post(
  '/orgs/:orgId/schools/:schoolId/fee-heads',
  authorize(p.one('fee_head:create')),
  async (req, res) => {
    const scope = req.dataScope!;
    const [created] = await db.insert(feeHeads).values({
      orgId:    scope.orgId,
      schoolId: scope.schoolId ?? req.params.schoolId,
      name:     req.body.name,
      amount:   req.body.amount,
    }).returning();
    res.status(201).json(created);
  }
);

router.patch(
  '/orgs/:orgId/schools/:schoolId/fee-heads/:id',
  authorize(p.one('fee_head:update')),
  async (req, res) => {
    const updated = await db.update(feeHeads)
      .set({ name: req.body.name, amount: req.body.amount })
      .where(and(eq(feeHeads.id, req.params.id), ...buildScopeWhere(req.dataScope!, feeHeads)))
      .returning();
    if (!updated.length) { res.status(404).json({ error: 'Fee head not found' }); return; }
    res.json(updated[0]);
  }
);

router.delete(
  '/orgs/:orgId/schools/:schoolId/fee-heads/:id',
  authorize(p.sensitive('fee_payment:delete')),
  async (req, res) => {
    const deleted = await db.delete(feeHeads)
      .where(and(eq(feeHeads.id, req.params.id), ...buildScopeWhere(req.dataScope!, feeHeads)))
      .returning();
    if (!deleted.length) { res.status(404).json({ error: 'Fee head not found' }); return; }
    res.json({ deleted: true });
  }
);

// ── Fee Payments ──────────────────────────────────────────────────────────────

router.get(
  '/orgs/:orgId/schools/:schoolId/fee-payments',
  authorize(p.list('fee_payment:read')),
  async (req, res) => {
    const scopes = req.dataScopes!;
    const rows = await db.select()
      .from(feePayments)
      .where(
        scopes.length === 1
          ? and(...buildScopeWhere(scopes[0], feePayments))
          : or(...scopes.map(s => and(...buildScopeWhere(s, feePayments))))
      );
    res.json(rows);
  }
);

// Record a new payment — standard (not sensitive, just creates a pending record)
router.post(
  '/orgs/:orgId/schools/:schoolId/fee-payments',
  authorize(p.one('fee_payment:create')),
  async (req, res) => {
    const scope = req.dataScope!;
    const [created] = await db.insert(feePayments).values({
      orgId:      scope.orgId,
      schoolId:   scope.schoolId ?? req.params.schoolId,
      studentId:  req.body.studentId,
      feeHeadId:  req.body.feeHeadId,
      amountPaid: req.body.amountPaid,
      paidAt:     req.body.paidAt,
      status:     'pending',
    }).returning();
    res.status(201).json(created);
  }
);

// Approve a payment — SENSITIVE: money operation, stale cache must not slip through
router.post(
  '/orgs/:orgId/schools/:schoolId/fee-payments/:id/approve',
  authorize(p.sensitive('fee_payment:approve')),
  async (req, res) => {
    const updated = await db.update(feePayments)
      .set({ status: 'approved' })
      .where(and(eq(feePayments.id, req.params.id), ...buildScopeWhere(req.dataScope!, feePayments)))
      .returning();
    if (!updated.length) { res.status(404).json({ error: 'Payment not found' }); return; }
    res.json(updated[0]);
  }
);

// Delete a payment — SENSITIVE
router.delete(
  '/orgs/:orgId/schools/:schoolId/fee-payments/:id',
  authorize(p.sensitive('fee_payment:delete')),
  async (req, res) => {
    const deleted = await db.delete(feePayments)
      .where(and(eq(feePayments.id, req.params.id), ...buildScopeWhere(req.dataScope!, feePayments)))
      .returning();
    if (!deleted.length) { res.status(404).json({ error: 'Payment not found' }); return; }
    res.json({ deleted: true });
  }
);

export default router;
