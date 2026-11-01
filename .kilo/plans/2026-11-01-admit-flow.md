# Admit a student: guided flow (web + mobile)

Branch `feat/admit-flow`, cut from `main` on 2026-11-01. The owner asked for a top-notch flow to
replace "an ugly long form" and for the work to stay on a branch (no merge, no push). No API,
contract or schema change.

## Actor, task, context

- **Actor:** front-desk or admin staff holding `student:create`.
- **Task:** put a child on the register, in a class, with a parent phone that becomes the family's
  sign-in (ADR-037).
- **Context:** usually at a counter, often with the family standing there, sometimes in a batch of
  admissions in a row.

## What was wrong

- **Mobile:** 23 fields on one scroll, in five cards. Aadhaar, religion and pincode got the same
  weight as the child's name. It captured neither class nor parents, so the desk then had to open
  the record, add the enrollment, then add each guardian. Saving just dropped back to the roster.
- **Web:** 13 fields in a narrow dialog with no class step. The form closed onto the register, so
  the next step was invisible. A failed parent save was swallowed with `.catch(() => undefined)`,
  so the desk could believe a family was linked when it wasn't. A parent name typed without a phone
  was silently dropped.
- **Both:** nothing helped with the admission number, the one permanent field.

## The journey

```
Student  ->  Class  ->  Family  ->  Check  ->  Done
```

1. **Student.** First and last name, date of birth, gender (one tap), then admission number and
   date. Middle name sits behind a link. Admission date defaults to today.
2. **Class.** Tap a class, then a section, in the active session. Sections show current strength
   when the caller can read enrollments. Skippable: "Continue without a class".
3. **Family.** Father, mother, and an optional other guardian. A name and 10-digit phone per person.
   When two or more are given, one question: who does the school call first? Skippable.
4. **Check.** One summary, with Edit on each group. Edit returns straight to Check.
5. **Done.** What was saved and what wasn't, with Retry for anything that failed. Then Admit another
   (the batch case), Open record, Collect fees, or Add address, health and more.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Steps, not sections on one page | The problem is too much at once. Only 5 fields are required, plus class and family, which are what the desk needs today. |
| D2 | Address, background, health and blood group leave admission | They are still one tap away from Done, on the existing edit form. Nothing is lost. |
| D3 | Class and family are part of admitting | That is the real job, and it used to take three screens afterwards. |
| D4 | Client composes `student.create`, `enrollment.create`, `guardian.add` | No backend change. They hold different permissions, and a child on the register with a failed class is a valid state. Done reports each result and offers Retry, never a false success. |
| D5 | A step disappears without its permission | No `enrollment:create`: no Class step. No `student:update`: no Family step. F1 still holds, and nobody hits a dead end. |
| D6 | A parent needs a name and a phone, or neither | Web used to store "Father" as the name, and dropped a name with no phone. |
| D7 | Two people can't share one phone in this flow | The server would link the same guardian twice and refuse the second. Caught on the step, in words. |
| D8 | Admission number: offered, never auto-filled | The number is permanent, so filling it needs a decision. "Next: 2026-015" is one tap, worked out from the newest admission. Formats without a trailing number get no suggestion. |
| D9 | Early warnings use the already-loaded register | A used number is refused at the step, not at the end. Same name and birth date gives a caution that doesn't block, because twins and namesakes exist. The server stays the authority (ADR-022, ADR-048). |
| D10 | Web stays a dialog, wider, with a step rail | Keeps the register behind it, the `?create=1` deep links, and the modal focus trap. A page would lose typed work on any sidebar click. |
| D11 | Mobile stays one route with in-screen steps | Back goes to the previous step via `usePreventRemove`, which covers the header, hardware back and swipes alike. Back on step 1 with typed work asks before discarding. |
| D12 | `/student-form` becomes edit-only | Two ways to admit would drift. |

## States

- **Loading classes:** skeleton. **Failed:** Retry, and the step can still be skipped.
- **No classes, or no active session:** says so, and the step can be skipped.
- **No branch chosen:** web keeps the button disabled, as before. Mobile shows the no-school state.
- **Denied:** the existing denied state.
- **Submitting:** the action is busy and closing is blocked.
- **Student refused** (duplicate number): back to Student with the error on the field.
- **Enrollment or guardian refused:** Done shows that row with the server's words and Retry.
- **Offline:** the same paths, using the friendly network wording.

## Acceptance

- Admit with all steps: student active, enrollment `section_assigned`, guardians linked, one primary.
- Admit with class and family skipped: student only, and Done says what is left.
- Duplicate number returns to Student with the field error.
- A failed enrollment or guardian shows on Done, and Retry completes it without a new student.
- Back moves one step on every platform control, and step 1 guards typed work.
- Edit student still works, and `/student-form` no longer creates.

## Build record

**Built:** 2026-11-01 on `feat/admit-flow`. Uncommitted, so the owner can split it. No backend change.

**Departures from the design above:**

- Web keeps the permanent-number warning in the footer of Check, because in the scroll it sat below the fold at 800px tall. Mobile keeps it in the body, where it fits.
- Web has no "Add address, health and more" link on Done, because its edit dialog doesn't hold those fields. It offers Open record and Collect fees.

**Walked on Android (emulator-5554, principal or admin, dev DB):**

- Full journey with class, section and two parents. Postgres shows `section_assigned`, the right section, two guardians, one primary, portal on.
- Back from the header and hardware key, Edit returning to Check, and the discard prompt on step 1.
- A used number the register can't see (a deactivated student): the server refused it, the flow returned to the field, and the next suggestion skipped it.
- A forced enrollment failure: Done showed the failure and Retry saved it. The forcing code is removed.
- 1.3x text on the class and Check steps.

**Walked on web (Playwright, 1280x800 light and dark, 390x844):**

- The same journey, focus on each step, Enter to continue, and a clean form closing with no prompt.
- A blocked `guardian.add` showing on Done, then Retry saving it.
- Admit another starting a fresh form, and a used number refused on the step.
- No horizontal overflow at phone width.

**Not walked:** iOS, TalkBack, a caller without `enrollment:create` or `student:update`, a multi-branch admin, offline on mobile, and a real server refusal of an enrollment.

**Fixes the walks found:**

- Continue left the keyboard covering the refused fields, so it now closes the keyboard.
- Skip buttons wore the accent colour, which read as a recommendation. They are secondary now.
- A refused number kept being suggested.
- An untouched web form asked before closing, because its inputs started as `""` against `undefined` defaults.
- The sheet's `data-[side=bottom]:h-auto` beat a plain height class on phone-width web.

**Known limits:**

- The suggestion and early clash check only see active students. A deactivated student's number gets through to the server's refusal, which is handled.
- The contract requires a last name, so a child with one name can't be admitted. That was already true and is unchanged.
- If a network failure hits a save that actually landed, Retry gets the server's duplicate refusal and shows it. The row stays failed until the desk checks the record.
