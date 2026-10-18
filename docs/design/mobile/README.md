# Step-0 mobile design outputs

The review gate required by `docs/MOBILE_PLAN.md` (sections "Step-0 design
outputs" and "Mobile UX workflow", lines ~344–401): **no production shell or
shared UI until the owner reviews these journeys and locks navigation.**

Status: **reviewed and approved 2026-10-18.** The owner read the briefs, then
the rendered probe set (`prototype/shots/native/`, 6 frames) and approved the
direction with one interaction re-cut (attendance: tap-to-change, long-press
sheet, bulk pills — record in `prototype/DIRECTION.md`). The production shell
and the first slice (teacher attendance) build next per
`.kilo/plans/2026-10-18-mobile-shell-attendance.md`.

Everything here is grounded in the real repository: exact permission strings
(`packages/authz/src/defaultPermissions.ts`), exact tRPC procedures
(`packages/trpc/src/routers/*`), and the seed data
(`apps/api/scripts/seed.ts`) as of commit `6e1984b`. Nothing is invented; where
something does **not exist** (a front-office role, an offline queue, section
capacity checks), the doc says so and raises it as a decision.

## Contents and reading order

| File | What it is |
|---|---|
| `00-personas-and-permissions.md` | The four real actors, their exact grants, scope, and the gaps this review must decide |
| `01-teacher-attendance.md` | Journey 1 — class teacher marks a section's attendance between periods |
| `02-accountant-fees.md` | Journey 2 — accountant finds dues, collects money, recovers from an ambiguous timeout |
| `03-front-office-admission.md` | Journey 3 — admissions desk admits a student and assigns a section |
| `04-navigation-proposal.md` | The navigation decision informed by the three journeys, including the principal's cross-branch switch |

Each journey brief follows the required template
(`docs/MOBILE_PLAN.md` lines 76–90): persona/permission/context; one measurable
outcome; entry-to-done journey and wireflow; screens with realistic sample
content; a state/recovery table; procedure-to-screen mapping; platform and
accessibility notes; and — at the end — **numbered review questions for the
owner**.

## What happened after your read

1. **Rendered prototypes** of these journeys were produced under this folder
   (`prototype/native.html` -> `prototype/shots/native/`, 6 frames; earlier
   passes kept as the rejected trail).
2. **Your review (2026-10-18) locked:** the tab structure (Home / Attendance /
   More for the teacher profile), the branch context chip, sheet conventions,
   and the first shared primitives — with the attendance interaction re-cut
   (tap-to-change + long-press + bulk pills).
3. The production shell + attendance slice build per
   `.kilo/plans/2026-10-18-mobile-shell-attendance.md`. The remaining journey
   states (fee timeout, admission form/result) re-render when their slices
   reach design.

## What this is not

Not final UI code, not a screen-by-screen pixel spec, and not a substitute for
the per-slice plan template that each feature needs before implementation.
Exact RN/Expo implementation choices (component APIs, SDK-pinned patterns) are
made at build time against the pinned SDK docs, per the repo's mobile rules.
