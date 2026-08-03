import { Router } from 'express';
import { and, or, eq } from 'drizzle-orm';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { p } from '../policies';
import { buildScopeWhere } from '../authz/scope';
import { db } from '../db/client';
import { attendance } from '../db/schema.app';

const router = Router();
router.use(authenticate);

// ── URL design ─────────────────────────────────────────────────────────────
// Short, section-based. resolveCtx() loads the full ancestry (school, class)
// from scope_nodes — no need to encode it all in the URL.
//
//   POST /orgs/:orgId/sections/:sectionId/attendance    → mark attendance
//   GET  /orgs/:orgId/sections/:sectionId/attendance    → view a section's records
//   GET  /orgs/:orgId/attendance                        → list everything I can see
//   PATCH /orgs/:orgId/sections/:sectionId/attendance/:id → correct a record

// ── Mark attendance (section-level) ────────────────────────────────────────
router.post(
  '/orgs/:orgId/sections/:sectionId/attendance',
  authorize(p.one('attendance:create')),
  async (req, res) => {
    const scope = req.dataScope!;

    // Always write using scope values, never raw body values.
    // A teacher cannot mark attendance for a different section by changing the body.
    const [created] = await db.insert(attendance).values({
      orgId:     scope.orgId,
      schoolId:  scope.schoolId  ?? req.params.sectionId, // scope.schoolId for section-level assignments
      classId:   scope.classId   ?? '',
      sectionId: scope.sectionId ?? req.params.sectionId,
      date:      req.body.date,
      records:   req.body.records,
    }).returning();

    res.status(201).json(created);
  }
);

// ── Read one section's attendance for a date ────────────────────────────────
router.get(
  '/orgs/:orgId/sections/:sectionId/attendance',
  authorize(p.one('attendance:read')),
  async (req, res) => {
    const rows = await db.select()
      .from(attendance)
      .where(and(
        ...buildScopeWhere(req.dataScope!, attendance),
        req.query.date ? eq(attendance.date, req.query.date as string) : undefined,
      ).filter(Boolean) as any);

    res.json(rows);
  }
);

// ── List: everything the requesting user can see across all their scopes ────
// A teacher with two section assignments sees both sections' records.
// A principal sees the whole school. An org admin sees everything.
router.get(
  '/orgs/:orgId/attendance',
  authorize(p.list('attendance:read')),
  async (req, res) => {
    const scopes = req.dataScopes!;

    const rows = await db.select()
      .from(attendance)
      .where(
        scopes.length === 1
          ? and(...buildScopeWhere(scopes[0], attendance))
          : or(...scopes.map(s => and(...buildScopeWhere(s, attendance))))
      );

    res.json(rows);
  }
);

// ── Correct a record (after submission error) ───────────────────────────────
router.patch(
  '/orgs/:orgId/sections/:sectionId/attendance/:id',
  authorize(p.one('attendance:update')),
  async (req, res) => {
    const updated = await db.update(attendance)
      .set({ records: req.body.records })
      .where(and(
        eq(attendance.id, req.params.id),
        // Scope filter prevents updating a record outside this user's scope,
        // even if they somehow know the UUID.
        ...buildScopeWhere(req.dataScope!, attendance),
      ))
      .returning();

    if (!updated.length) {
      // Either doesn't exist OR outside this user's scope — same response, no info leak.
      res.status(404).json({ error: 'Record not found' }); return;
    }

    res.json(updated[0]);
  }
);

// ── Export ──────────────────────────────────────────────────────────────────
router.get(
  '/orgs/:orgId/attendance/export',
  authorize(p.list('attendance:export')),
  async (req, res) => {
    const scopes = req.dataScopes!;
    const rows = await db.select()
      .from(attendance)
      .where(or(...scopes.map(s => and(...buildScopeWhere(s, attendance)))));

    // In production: stream as CSV. Here: JSON for brevity.
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.json"');
    res.json(rows);
  }
);

export default router;
