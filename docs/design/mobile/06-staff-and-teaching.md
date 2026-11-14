# Journey 6: Staff, sign-in and teacher assignment

Status: **proposal for owner review, v1 (2026-11-14).** Nothing is built, and no ADR or other doc
is changed yet.
Mockups: `prototype/staff-teaching.html` (18 phone frames, grouped by journey; the numbers match this doc).

This journey covers four things that only work together: the staff record, how staff sign in,
how a new teacher joins, and who teaches what. Teacher assignment is what most of the app
depends on. Marks entry, homework, attendance, Home and the exams "Your paper" labels all
read it. Until now it was set up one section at a time, in two places that don't talk to
each other.

---

## 1. Who, how often, and what "good" means

| Actor | How often | The job |
|---|---|---|
| Office / admin | Start of session, then a few times a term | Add staff, invite them, fill in who teaches what, fix gaps, hand over when someone leaves |
| Principal / VP | Weekly | "Does every section have its teachers? Who's overloaded?" |
| Teacher | Once, then never thinks about it | Join, sign in, and find their own classes waiting |

**Measurable targets** (to check on a mid-range Android during the device walk):

- **Add and invite** one teacher: **under 45 seconds**, ending on a WhatsApp message ready to send.
- **A teacher joins**: from opening the app to seeing their classes, **under 2 minutes**.
- **Assign** one teacher to one subject in four sections: **about 6 taps**.
- **Fill a whole section** (class teacher + 7 subjects): **under a minute**.
- **New session**: copy last session's teachers, review and save, **under 5 minutes** for a 20-section branch.

## 2. What we agreed (owner, 2026-11-09 to 11-14)

1. **One kind of person, "Teacher".** There are no "class teacher" or "subject teacher" people.
   A teacher **teaches subjects in sections**, and may also be **class teacher of one section**.
2. **Assigning gives access.** The office assigns, the teacher can work. There's no second step
   in Roles. Under the hood the assignment writes the matching role grant (see section 8).
3. **One class teacher per section, any number of teachers per subject in a section.** Two
   teachers can share 6-A Maths (Mon–Tue and the rest). The timetable says which day.
4. **Class teachers are optional.** A school setting, "We have class teachers", turns the
   slot on or off. Off hides it everywhere, and nobody sees empty-class-teacher warnings.
5. **A class teacher can enter marks for every subject in their section** (owner, 2026-11-14).
6. **Designation is free text, with suggestions** (PRT, TGT, PGT, Principal…). A separate
   **"Teaches classes"** switch decides who shows up in the teacher picker. Neither grants access.
7. **Who manages assignments is a permission** (`teacher_assignment:*`), not a fixed role.
   Proposed defaults: org admin, principal, vice principal. A school can give it to anyone.
8. **Staff sign in with their phone number and a password.** No email, no SMS. Email stays on
   the record as a contact detail only. The same goes for non-teaching staff and the org admin.
9. **First sign-in uses a joining code** the office shares (WhatsApp, read out or printed).
10. **Staff and family logins are separate**, even on the same phone number.
11. **A staff login belongs to one org.** A number that is active staff in another org is
    refused, with no override from our side.
12. **When someone leaves**, their login is switched off and the number is freed. A rehire gets
    a new login. Their past work keeps their name.
13. **Ending an assignment sets an end date, never deletes it.** There's no history screen.
14. **Phone first.** These screens are designed for the phone. Web catches up later.

## 3. The model, in plain words

### The staff record
Name, phone, branch, designation (free text), **Teaches classes** (on/off), employee code
(suggested automatically), email (optional, contact only), status.

### The login
Created when the person joins. The username is `staff.` + their 10-digit phone
(`staff.9876543210`). Families keep the bare number (`9876543210`). Nobody ever types the
prefix: the app adds it from the "I'm staff" choice.

### Teaching assignments
Each one is a row: **session · section · subject (or "class teacher") · teacher · from–to**.
Rows point at the **staff record**, not the login, so the office can fill in the year
before anyone has joined.

### What each one lets a teacher do (defaults, editable per school)

| | Teaches Maths in 6-A | Class teacher of 6-A, on top |
|---|---|---|
| 6-A's student list | ✓ | ✓ full details and export |
| Mark 6-A's attendance | ✓ | ✓ |
| Correct attendance later | | ✓ |
| Marks | Maths only | **Every subject** in 6-A |
| Homework | Maths only | Every subject in 6-A |
| Report card remark | | ✓ |
| Fee status, to remind parents | | ✓ |
| Announcements to 6-A | | ✓ |

With class teachers switched off, the right-hand column falls to the office, or the school
gives those permissions to every teacher in the permission editor.

## 4. Sign-in and joining (frames 01–04)

1. **Welcome** (already built) → **I'm staff**.
2. **Sign in** (01): phone + password. Under it: **First time here? Join with a code**.
3. **Join** (02): phone + the 6-digit code from the office.
4. **Set a password** (03): twice, with the rule shown as you type.
5. **Welcome** (04): "Hi Priya. You're at Main Campus." Their classes as cards. A short tour
   (attendance, homework, marks) that can be skipped. If nothing is assigned yet:
   "The office hasn't given you any classes yet." (frame 18).

**Joining code rules:** valid **7 days**, works **once**, **5 wrong tries** kills it, and a new
code cancels the old one. **Forgot password** = ask the office for a new code.

## 5. Staff screens (frames 05–08, 14)

- **Staff list** (05): search, filter chips (All, Teaching, Not joined, Left), each row with a
  join status pill: **Not invited · Invited · Joined**.
- **Add staff** (06): one short form. Designation suggestions as chips. "Teaches classes" is
  on when the designation looks like a teacher. **Save and invite** is the main button.
- **Invite sheet** (07): the code in large digits, how long it lasts, **Share on WhatsApp**
  with the message written, and **Copy**.
- **Staff profile** (08): call / WhatsApp / classes, **This session** (what they teach, with
  an edit link), office roles, the login (status, resend code, remove access), **Mark as left**.
- **Mark as left** (14): a date, then each thing they taught with a picker for who takes it
  over. Lines can stay empty and then count as gaps.

## 6. Teaching screens (frames 09–13, 15–17)

- **Teaching overview** (09): how complete the session is ("38 of 47 filled"), the gaps by
  kind, and a **By section / By teacher** switch. Reached from More → Teaching and from the
  admin Home card (16).
- **Section** (10): class teacher at the top, then every mapped subject with its teachers.
  Empty slots are amber with **Assign**. **Class teacher + all subjects** is one tap, for
  primary sections where one teacher does everything.
- **Teacher picker** (11): teaching staff only, a search box, each person's current load.
  People who already teach this subject elsewhere come first.
- **By teacher** (12): pick Priya Rao, tick sections under each subject. Her load at the top.
- **Change teacher** (13): replacing someone is a confirm sheet with a **from** date that
  defaults to today, plus an optional **until** date for a substitute. When the until date
  passes, the slot goes back to the original teacher.
- **Copy from last session** (15): matches sections by name (6-A → 6-A), lists what didn't
  match (a section that's gone, a teacher who left), and nothing goes live until **Save**.
- **Admin Home** (16): a "Teaching" card showing gaps, which opens the overview on the first one.
- **Settings** (17): "We have class teachers", and who can manage assignments (a pointer to
  the permission).

**Elsewhere:** teacher Home shows the real line ("Class teacher of 6-A · Maths in 6-A, 6-B,
7-A"), replacing today's guess. Exams and homework say "No teacher assigned to 7-B Science"
with a link, instead of a bare refusal.

## 7. The timetable

The timetable (`prototype/timetable.html`, separate review) reads assignments and never grants
access. Picking "Maths" in a period fills in 6-A's Maths teacher automatically. If two share
it, it offers just those two. If someone puts an unassigned teacher in a period, the warning
offers **"Assign her to 6-A Maths?"**, but only to people with the assignment permission.

## 8. What changes underneath (for review, not for the owner to design)

**Permissions (option A).** The permission core stays as it is. Around it:

1. Saving an assignment writes a **section-level** role grant in the same transaction (class
   teacher → the class teacher grant; a subject → the teaching grant). Ending it removes the grant.
2. The server refuses hand-made class/subject teacher grants. The Roles screen stops offering them.
3. The permission cache is cleared on every assignment change, so access changes take effect at once.
4. A teacher who hasn't joined has assignments but no login. Their grants are created when they join.
5. Leaving ends every assignment and grant. Copying to a new session creates new ones.
6. Ending an assignment checks the **section**, like creating one does (today it asks for the
   whole branch, so a section-level manager could add but never change).
7. Class teacher default scope moves from the whole class to the section.
8. A new ADR amends ADR-012. Authz tests, smoke checks and the seed move to section-level grants.

**Assignments.** Point at the staff record. Two kinds only (`co_teacher` and
`activity_teacher` go). One open class teacher per section, enforced by the database.

**Logins.** `staff.` usernames, joining codes (stored hashed), freeing the number on leaving
(`left.<id>`), refusing a number that's active staff elsewhere. Seed, smoke, Playwright and
Maestro sign-ins move from email to phone.

## 9. Open questions

1. **Subject colours.** The mockup gives each subject a soft tinted tile with an icon, so a
   list of subjects isn't a wall of text. This is the first colour in the staff app that
   isn't a status. Keep it?
2. **Can a teacher see the whole teaching grid** (read-only), or only their own classes?
3. **Substitute "until" date**: keep it in v1, or leave substitutes to the timetable later?
4. **Where Teaching lives**: More → Teaching only, or also inside Academic setup as the last step?

## 10. Out of scope here

Electives across sections (needs student subject choices; a results-sized change), leave,
staff attendance, payroll, staff documents, bulk import, branch moves, staff ID cards on
mobile, the colleague directory, and admin password recovery. Each is a separate decision.
