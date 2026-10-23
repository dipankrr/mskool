# Mobile Step 2 Chunk B — Academic setup (slice plan)

Date: 2026-10-24 · Branch `feature/mobile-step2`. Companion to chunk A's plan
(F1 resolution and chunk-order rationale live there).

## 1. Actor / task / context

**Task:** a trust onboards a branch's structure from the phone — classes,
sections, subjects, terms, the class↔subject curriculum, and staffing —
without touching the web. **Actors:** permission-gated; defaults — principal
writes everything except terms' create (admin), VP reads/updates classes +
sections, teachers read. Every gate is a permission string; the server
re-checks.

**Context:** the active branch and its running session come from
`useActiveContext` (ADR-047: no year picker — sections/terms/mappings/
assignments are all bound to the branch's current session; changing it is an
admin act in Sessions). A screen that needs a session and finds none renders
the honest "no session is set" state.

## 2. Structure — one hub, six surfaces

More ▸ Manage ▸ **Academic setup** → hub with six rows (each gated to its own
`*:read`): Classes, Sections, Subjects, Terms, Subject mappings, Teacher
assignments. Static descriptive subtitles (live counts would fire six reads
for numbers nobody acts on). The hub row appears with any of the six reads.

## 3. Per-surface design (list + pushed form, the Branches/Sessions pattern)

| Surface | List | Form fields | Special rules |
|---|---|---|---|
| Classes `class.*` | active-only, order = numericOrder | name, order (−10…20; negatives are pre-primary), description | deactivate on edit (`class:delete`) |
| Sections `section.*` | current year, optional class filter (ChoiceSheet) | class (locked in edit — moving relocates students, ADR-015), name, shift, room, max students | deactivate on edit |
| Subjects `subject.*` | active-only | name, short name, code | deactivate on edit |
| Terms `academic.term.*` | current year | name, sequence (1…50), start/end dates, result mode, weightage % | no delete; end≥start; DB trigger keeps dates inside the year (refusal surfaced) |
| Subject mappings `assignment.subjectMapping.*` | per (year, class) — class picker on the list; subject names joined client-side from `subject.list` | create: subject, elective, sequence. Edit: elective + sequence only (the triple is not patchable — end and re-create) | End behind a consequence confirm (ADR-033); a mapping with term-grade entries refuses with the server's worded error |
| Teacher assignments `assignment.teacherAssignment.*` | per section — section picker (sections of the current year); names joined from `assignment.teacherDirectory` | teacher (directory), role (4 pills), subject — only when role = subject_teacher (DB CHECK) | End behind a confirm; no successor on mobile v1 (the endpoint accepts one; a hand-over needs the successor journey — recorded, not silent) |

## 4. Screen states

Every screen: initial skeleton, error+retry, empty (vs filtered-empty for
sections/mappings/assignments), read-denial, write-denial on direct form deep
links, submitting, unsaved guard, offline save failure preserving input.
Forms load `byId` with `gcTime: 0`. Writes invalidate their list + the hub's
lists and never render success before the server confirms.

## 5. Acceptance

1. Onboard a fresh branch's structure end-to-end on the phone (the step-level
   acceptance, first half): class → sections → subjects → mappings →
   assignments, all writes verified in Postgres — **including `scope_nodes`
   rows for the class and section (hard rule 12)**.
2. Permission split: teacher sees the surfaces read-only (no add/edit
   affordances, denial screens on deep links); principal writes; sections'
   class/year fields locked in edit with the reason stated.
3. Mapping end refuses when term-grade entries exist (server wording); term
   dates outside the year refuse (server trigger wording).
4. Gates green; walk recorded; ledger ticked.

## 6. Endpoint table (chunk B)

| Procedure | Gate | Screen | Done |
|---|---|---|---|
| `academic.class.list/.byId/.create/.update/.deactivate` | `class:read/create/update/delete` | classes + form | ☐ |
| `academic.section.list/.byId/.create/.update/.deactivate` | `section:read/create/update/delete` | sections + form | ☐ |
| `subject.list/.byId/.create/.update/.deactivate` | `subject:read/create/update/delete` | subjects + form | ☐ |
| `academic.term.list/.byId/.create/.update` | `academic_year:read/create/update` | terms + form | ☐ |
| `assignment.subjectMapping.list/.byId/.create/.update/.end` | `subject_mapping:read/create/update/delete` | mappings + form | ☐ |
| `assignment.teacherAssignment.list/.byId/.create/.end` + `assignment.teacherDirectory` | `teacher_assignment:read/create/update` | assignments + form | ☐ |

Note: `subjectTypeId` on mapping create is deliberately omitted on mobile v1 —
no subject-type read exists on the phone; the field is optional server-side.
Recorded, not silent.

## 7. Files

```
.kilo/plans/2026-10-24-mobile-step2b-academic.md
apps/mobile/src/screens/academic/{hub,classes,class-form,sections,section-form,
  subjects,subject-form,terms,term-form,mappings,mapping-form,assignments,
  assignment-form,form-logic}.tsx/.ts (+ form-logic.test.ts)
apps/mobile/src/app/(staff)/{academic-setup,classes,class-form,sections,
  section-form,subjects,subject-form,terms,term-form,subject-mappings,
  subject-mapping-form,teacher-assignments,teacher-assignment-form}.tsx
apps/mobile/src/lib/copy.ts            (academic.* additions)
apps/mobile/src/screens/more/index.tsx (Academic setup row)
```

## 8. Walk plan

Emulator, admin persona: create class 6 → section B of class 6 → subject
"Art" → map Art to class 6 → assign a subject teacher to 6-B; psql verifies
each row AND its scope_nodes ancestor (hard rule 12). Term create for the
running year; mapping end; term-outside-year refusal. Teacher persona:
read-only, denial deep links. 360×640 @1.3× pass on hub + two forms.

## 9. Commit plan

1. `feat(mobile): academic setup hub, classes and subjects`
2. `feat(mobile): sections and terms for the running session`
3. `feat(mobile): subject mappings and teacher assignments`
