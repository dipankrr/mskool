# Mobile Step 2 Chunk C — People flows (slice plan)

Date: 2026-10-24 · Branch `feature/mobile-step2`. Companions: chunk A plan
(F1, ordering), chunk B plan (hub pattern).

## 1. Actor / task / context

**Task:** complete a student's people record from the phone — enroll them in
the running session, assign a section, record guardians, and open the
family's portal link — closing the step's acceptance journey: admit → enroll
→ assign section → guardian recorded → link status visible.

**Actors** (permission-gated): `enrollment:read` sees enrollment facts;
`enrollment:create` enrolls; `enrollment:update` assigns sections and
transitions; `student:read` sees guardians; `student:update` records them;
`portal_access:activate` sees and opens links (SENSITIVE — fresh cache);
`portal_access:change_phone` revokes. Defaults: principal/VP hold the
enrollment writes, only the principal the portal ones.

**Context:** the running session anchors enrollment (ADR-047); guardians and
portal links are student-addressed reads (`guardian.list` already renders on
detail).

## 2. Structure

Student detail grows two live sections and hangs the flows off itself:

- **Enrollment** — class · section · roll · status for the running session
  (from `enrollment.list` for the active year, the web's own pattern, joined
  client-side by studentId). Actions: **Enroll** (no row, `enrollment:create`)
  → `/enrollment-form`; **Assign section** (row is `admitted`,
  `enrollment:update`) → same form in assign mode; **Move along** (a legal
  transition exists) → the transitions sheet with the service's legal map.
- **Guardians** — existing rows become tappable (`student:update`) →
  `/guardian-form` (edit, detach); an **Add guardian** row appears with the
  same grant.
- **Portal access** — new section listing `portalAccess.status`
  (`portal_access:activate`): username, pending/active, credential state;
  **Open a link** (ensureLink — pick a guardian, phone prefilled) and
  **Revoke** per active row (`portal_access:change_phone`, behind a
  consequence confirm). The claim-not-handoff rule is the copy: staff never
  set or see passwords; the parent claims from home.

The teacher persona sees the facts read-only and no action rows.

## 3. Named operations, not patches

The contract forbids patching a enrollment's identity: creation derives the
status (admitted / section_assigned), `assignSection` is the only first
assignment, and transitions follow the service's legal map
(admitted→withdrawn; section_assigned→active|withdrawn;
active→transferred_out|withdrawn|passed_out; terminal states are final).
`update` carries labels only (roll/stream/house) — mobile edits the roll
number on an assigned enrollment. The mid-year section move is a transfer —
not built — and the UI never offers it.

## 4. Screen states

Every screen: skeleton, error+retry, read/write denial, submitting,
unsaved-changes guard, offline save preserving input, success only after the
server confirms. `gcTime: 0` on edit loads. Writes invalidate the enrollment
list, `guardian.list`, `portalAccess.status` and the detail's queries.

## 5. Acceptance

1. The full journey on one fresh student: admit (chunk A) → enroll in
   9-B → guardian recorded → portal link visible (pending) — each write
   verified in Postgres.
2. Permission split: teacher read-only; principal full.
3. Refusals surfaced: assigning a section to an already-sectioned
   enrollment (server wording), an illegal transition (sheet never offers
   one), detaching a guardian (consequence confirm).

## 6. Endpoint table (chunk C)

| Procedure | Gate | Screen | Done |
|---|---|---|---|
| `enrollment.list` | `enrollment:read` | detail enrollment facts | ☐ |
| `enrollment.create` | `enrollment:create` | enrollment form | ☐ |
| `enrollment.update` | `enrollment:update` | enrollment form (roll edit) | ☐ |
| `enrollment.assignSection` | `enrollment:update` | enrollment form (assign mode) | ☐ |
| `enrollment.transition` | `enrollment:update` | detail transitions sheet | ☐ |
| `guardian.add` / `.update` / `.detach` | `student:update` | guardian form | ☐ |
| `portalAccess.status` | `portal_access:activate` | portal access screen | ☐ |
| `portalAccess.ensureLink` | `portal_access:activate` | portal access screen | ☐ |
| `portalAccess.revokeLink` | `portal_access:change_phone` | portal access screen | ☐ |

`portalAccess.verifyLink` is the parent's own claim step — no staff UI.

## 7. Files

```
.kilo/plans/2026-10-24-mobile-step2c-people.md
apps/mobile/src/screens/students/{enrollment-form,guardian-form,portal-access,people-logic}.tsx/.ts (+ people-logic.test.ts)
apps/mobile/src/screens/students/detail.tsx   (enrollment + actions + portal row)
apps/mobile/src/lib/copy.ts                   (people.*)
apps/mobile/src/app/(staff)/{enrollment-form,guardian-form,portal-access}.tsx
```

## 8. Walk plan

Admin (principal persona): enroll Aditi in 9-B with a roll number (psql:
row + derived status), record a guardian (psql + auto-link rule observed),
open the portal link (status shows pending), revoke it. Teacher persona:
facts visible, no actions. 360×640 pass on the enrollment form.

## 9. Commit plan

1. `feat(mobile): enroll students and move them along`
2. `feat(mobile): guardians and the portal link on the student record`
