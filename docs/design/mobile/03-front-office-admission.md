# 03 — Journey 3: front desk admits a student and assigns a section

Status: draft for owner review (2026-10-17, grounded at commit `6e1984b`).
Related ledger row: `/students`, `/students/[studentId]` (mobile phase 2 —
"Roster search/filter, student detail, admit/edit/enroll, guardian and
portal-access flows").
**Blocked on decision F1** in `00-personas-and-permissions.md`: there is no
front-office role, and the vice-principal default lacks `enrollment:create`.

---

## 1. Persona, permission, context

**Actor:** the admissions desk — a *job*, not a role today. The credential
must hold: `student:create` (admit), `student:update` (guardian writes gate on
the student family), `enrollment:update` (assign section), `section:read`,
`class:read`. `enrollment:create` (enroll into the year) exists **only** on
`principal` / `org_admin` by default.

**Default operator in this walkthrough:** vice-principal — everything except
`enrollment:create`; the gap is decision F1 (add the grant to defaults, create
a front-office role, or run admissions on a principal credential).

**Where/when:** front desk, parent and child physically present, paperwork in
hand, frequent interruptions (calls, other parents). One sitting should
finish. Typing is done by the desk, not the parent.

## 2. Measurable outcome

> In one front-desk sitting (≤ 5 minutes), the desk admits a walk-in child
> onto the register with a school-issued admission number, records the
> parent's phone, enrolls the child into the active session, and assigns a
> section — the register ends in the exact completed state with nothing lost
> to an interruption.

## 3. Entry-to-done journey and wireflow

```
[Students] / [Home "Admit student"]      gated student:create
  ▼
[Admit form] — identity: names, DOB, gender,
  │   admission number (manual, help text, immutable, unique per school),
  │   admission date; contact: parent phone(s)
  │   student.create ── duplicate admission number → DB refusal → inline
  │   field error, ENTIRE form kept (ADR-022: DB is the referee, not a pre-check)
  ▼
[Guardian writes] — one write per phone (student:update gate)
  │   failure here is NON-BLOCKING: the child is already on the register
  │   (web parity); toast + retry affordance
  ▼
[Enroll] — class required · section optional; session = ACTIVE context
  │   (not a picker — same rule as web); enrollment.create
  │   → status "admitted" (no section) or "section_assigned" (with one)
  ▼
[Assign section] — enrollment.assignSection (first assignment only;
  │   roll number optional; mid-year moves are the transfer flow — not this journey)
  ▼
[Done] — register card: admission no, Class 6 · A, guardian phone
        (family credential — ADR-037)
```

Backend truths this design obeys:

- **Admission number is caller-supplied and immutable.** No generation logic
  exists; uniqueness is enforced by `students_school_admission_number_uq`.
  The form keeps the number editable until the server accepts it.
- **Two-step admission is the model.** `createEnrollment` with no section
  yields status `admitted`; the seed child **Rohan Verma (DEMO-0002)** sits in
  exactly this state — the walkthrough's intermediate example.
- **Section assignment is a named operation** (`enrollment.assignSection`,
  first assignment only) — never an edit of the enrollment row.
- **No capacity data exists anywhere** (finding F5) — section lists show
  names, never a fabricated "18/40 seats".

## 4. Screens, hierarchy, realistic sample content

| Screen | Content (seed reality) |
|---|---|
| S1 Students | Register with admission numbers; "Admit student" action (deep-linkable, `?create=1` parity) |
| S2 Admit form | "Aarav Singh · DOB 11 Mar 2019 · Boy · DEMO-0042 · admitted today"; parent phone "98XXXXXX01"; help text under admission number: "School-issued, permanent, never reused" |
| S3 Guardians | "Parent phone recorded — the family will use this number for portal access" + retry row if the write failed |
| S4 Enroll | "Class 6 — Section A (optional, can assign later)"; active session "2025-26" shown as context, not edited here |
| S5 Assign section | "Class 6 sections: A (only seeded section)"; roll number optional |
| S6 Done | Summary card: "DEMO-0042 · Aarav Singh · Class 6 · Section A · Parent 98XXXXXX01" |

## 5. State / recovery table

| State | Design |
|---|---|
| Loading | Skeleton on register/class/section lists only |
| Empty | No sections for a class → enroll without section (supported) + "assign later" affordance on the student profile |
| Error | Inline retry; the form is never cleared by a query failure |
| Offline | ADR-043 online-only: banner + disabled submit; **all typed fields kept**; retry on reconnect |
| Denied | Missing `student:create` → explain and hide the action (F1's whole point) |
| Validation | Required fields inline; DOB via native date picker; admission-number help text; nothing validated client-side that the DB owns (uniqueness) |
| Duplicate refusal | Inline on the admission-number field with server wording; every other field preserved |
| Guardian failure | Non-blocking toast; the admission is complete without it; retry visible |
| Submitting | Submit locked; back gesture disabled in flight |
| Success | Success only after server confirms (plan rule); register card is the terminal state |
| Interruption / resume | Multi-field form keeps all input across backgrounding, navigation, validation failures and retries; **app killed = draft lost** (in-memory only, ADR-043) — the one place this hurts most; validate with owner (Q5) |

## 6. Procedure-to-screen mapping

| Screen | Procedures |
|---|---|
| S1 | `student.list` (gate `student:read`; server-side search) |
| S2 | `student.create` (gate `student:create`); optional later: `student.uploadPhoto` |
| S3 | Guardian family (list/add/update/detach — gates on the **student** family, writes need `student:update`); exact procedures verified in the phase-2 slice |
| S4 | `academic.class.list`; `academic.year.current` / `.list`; `enrollment.create` (gate `enrollment:create`) |
| S5 | `academic.section.list`; `enrollment.assignSection` (gate `enrollment:update`) |
| S6 | — (client summary of confirmed writes) |

## 7. Platform, keyboard, accessibility

- The longest form in the staff app: keyboard-safe scrolling (fields never
  under the keyboard), next/previous field actions, DOB picker is native.
- Back mid-form keeps the draft; leaving the journey asks once before discard.
- Screen reader labels on every field; error text announced on refusal.
- Large touch targets; text scaling supported; Latin + Devanagari names both
  fine (no truncation games — full name fields).
- Parent phone field uses the phone keyboard; no formatted-mask games beyond
  what the server stores.

## 8. Device targets

Portrait phone primary (the desk phone). A desk tablet/broken-out form is a
later consideration; not designed now.

## 9. Open questions for the owner

1. **F1 credential decision** — see `00-personas-and-permissions.md`: grant
   `enrollment:create` to the vice-principal default, create a front-office
   role, or run the desk on a principal credential?
2. **Duplicate admission numbers:** web does no pre-check (DB refuses).
   Match that exactly on mobile, or add a best-effort early lookup for nicer
   UX (DB stays the referee either way)?
3. **Photo capture:** `student.uploadPhoto` exists but the bulk-photo slice
   owns photos. Ship admission without photo (recommended) or include a
   single-child photo step now?
4. **Enroll anchoring:** class required + section optional, anchored to the
   active session (model + web parity) — agree, with "assign section now or
   later" as an explicit choice on the done screen?
5. **Killed-app drafts:** for this form only, is a killed-app draft loss
   acceptable under ADR-043, or does the admission form deserve local draft
   persistence before the slice ships?
