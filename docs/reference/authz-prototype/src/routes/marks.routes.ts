import { Router } from 'express';
import { and, or, eq } from 'drizzle-orm';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { p, checkSubjectAccess } from '../policies';
import { buildScopeWhere } from '../authz/scope';
import { db } from '../db/client';
import { marks } from '../db/schema.app';

const router = Router();
router.use(authenticate);

// ── Create marks ────────────────────────────────────────────────────────────
// Two-layer check:
//   1. Authz gate (p.one): can this user enter marks for this section at all?
//   2. Subject check: is this their subject? (business logic, not authz)
//
// The subject check only fires for section-level assignments (scope.sectionId != null).
// Principals and class teachers (scope.sectionId = null) skip it.
router.post(
  '/orgs/:orgId/sections/:sectionId/marks',
  authorize(p.one('marks:create')),
  async (req, res) => {
    const scope     = req.dataScope!;
    const subjectId = req.body.subjectId;

    if (!subjectId) { res.status(400).json({ error: 'subjectId is required' }); return; }

    // Subject check — only for section-level assignments
    await checkSubjectAccess(scope, req.user!.userId, req.params.sectionId, subjectId);

    const [created] = await db.insert(marks).values({
      orgId:     scope.orgId,
      schoolId:  scope.schoolId  ?? '',
      classId:   scope.classId   ?? '',
      sectionId: scope.sectionId ?? req.params.sectionId,
      subjectId,
      examType:  req.body.examType,
      records:   req.body.records,
      published: 'N',
    }).returning();

    res.status(201).json(created);
  }
);

// ── Update marks ────────────────────────────────────────────────────────────
router.patch(
  '/orgs/:orgId/sections/:sectionId/marks/:id',
  authorize(p.one('marks:update')),
  async (req, res) => {
    const scope     = req.dataScope!;
    const subjectId = req.body.subjectId;

    // Subject check on update too
    if (subjectId) await checkSubjectAccess(scope, req.user!.userId, req.params.sectionId, subjectId);

    const updated = await db.update(marks)
      .set({ records: req.body.records, ...(subjectId ? { subjectId } : {}) })
      .where(and(eq(marks.id, req.params.id), ...buildScopeWhere(scope, marks)))
      .returning();

    if (!updated.length) { res.status(404).json({ error: 'Record not found' }); return; }
    res.json(updated[0]);
  }
);

// ── Read marks ──────────────────────────────────────────────────────────────
router.get(
  '/orgs/:orgId/sections/:sectionId/marks',
  authorize(p.one('marks:read')),
  async (req, res) => {
    const rows = await db.select()
      .from(marks)
      .where(and(...buildScopeWhere(req.dataScope!, marks)));
    res.json(rows);
  }
);

// ── List (all accessible marks) ─────────────────────────────────────────────
router.get(
  '/orgs/:orgId/marks',
  authorize(p.list('marks:read')),
  async (req, res) => {
    const scopes = req.dataScopes!;
    const rows = await db.select()
      .from(marks)
      .where(or(...scopes.map(s => and(...buildScopeWhere(s, marks)))));
    res.json(rows);
  }
);

// ── Publish marks — SENSITIVE ────────────────────────────────────────────────
// p.sensitive() does a DB auth_version check before proceeding.
// Publishing is irrevocable (students/parents see results) — stale cache
// must not be allowed to slip through.
router.post(
  '/orgs/:orgId/sections/:sectionId/marks/:id/publish',
  authorize(p.sensitive('marks:publish')),
  async (req, res) => {
    const updated = await db.update(marks)
      .set({ published: 'Y' })
      .where(and(eq(marks.id, req.params.id), ...buildScopeWhere(req.dataScope!, marks)))
      .returning();

    if (!updated.length) { res.status(404).json({ error: 'Record not found' }); return; }
    res.json(updated[0]);
  }
);

// ── Delete marks — SENSITIVE ─────────────────────────────────────────────────
router.delete(
  '/orgs/:orgId/sections/:sectionId/marks/:id',
  authorize(p.sensitive('marks:delete')),
  async (req, res) => {
    const deleted = await db.delete(marks)
      .where(and(eq(marks.id, req.params.id), ...buildScopeWhere(req.dataScope!, marks)))
      .returning();

    if (!deleted.length) { res.status(404).json({ error: 'Record not found' }); return; }
    res.json({ deleted: true });
  }
);

export default router;
