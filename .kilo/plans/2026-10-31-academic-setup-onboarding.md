# Academic setup revamp and setup card: design for owner review

Status: **revision 5. Approved and built on `feat/academic-setup`. Device walk pending.**
Date: 2026-11-01.

## Owner changes after the mockups (these win over the frames)

The owner asked for these without re-editing the mockups:

- Section chips show shift as an icon (sunrise, sun, moon), not the word.
- Each class card has its own fold button beside the pencil, in Expanded view, with no added height.
- The Expanded/Compact toggle sits beside the "x without section" chip, not in the header.
- Expanded is the default view.
- The line under headings shows the school only for multi-branch staff, and no session name, across the app.
Mockups: `docs/design/mobile/prototype/academic-setup.html`, rendered to
`docs/design/mobile/prototype/shots/academic-setup/sheet.png`. Frame numbers below refer to them.

Design read: a school operations tool for an admin setting up on a phone, in the approved v3
language (white cards on a tinted canvas, Clash Grotesk, one emerald accent, colour only as status),
Android first. Premium here means precision and restraint, not decoration: exact type, aligned
grids, real data on every row, changes that appear in place, and no dead ends.

## 1. Actor, task, context

- **Developers:** create the org, the admin login and the first school with a script.
- **Actor:** the org admin or principal, on a phone, likely in short sittings over several days.
- **Job:** get a school ready to mark attendance and run exams.
- **Not forced:** every screen stays usable whether or not setup is finished.
- **Teachers:** see a calm "being set up" message only (frame 19).

## 2. Agreed decisions

| Topic | Decision |
|---|---|
| Setup help | A compact card on Home, plus a popup. Tapping a step opens its screen |
| Popup | Fresh launch only |
| Who sees it | Permission based |
| Presets and templates | Later, inside the create pages. Not in this work |
| `subject_mapping` | Removed; merged into `subject:*` |
| Order | The revamp comes before the card |
| Sessions | Joins the Academic setup list |
| Class & Section | One screen, single list (owner sketch 2) |
| Subject & Mapping | One screen, class chips (owner sketch 1) |
| Subject type | Required. "School default" removed. A real default exists. One type is picked automatically |
| Map subject sheet | Layout and bulk flow stay |
| Name | "Subject type" everywhere; "Result type" goes |
| Sections done | Every active class has at least one section |
| Class subjects done | Every active class has at least one mapped subject |
| Subject types entry | Button at the top right of Subject & Mapping |
| Password | Fixed default, forced change at first login |
| First session | Runs automatically (owner delegated this call; see 7) |
| Icons | Real icons through `AppIcon`, never emojis. Section seats use a chair icon |
| Section row | Two sections and "+" always fit on one line. As many classes on screen as possible |
| Compact view | A button shows class name and section count only |
| Map to every class | A subject can be mapped to every class in one action |

## 3. Screens

### Academic setup (frames 1, 17)
Five rows: Sessions, Class & Section, Subject & Mapping, Terms, Teacher assignments. Each shows a
live fact ("15 classes · 28 sections") rather than a description. With no session, the rows stay
visible: Sessions asks for the first session, and Terms and Teacher assignments show a lock and
"Needs a running session". This removes the dead end at `hub.tsx:120`.

### Class & Section (frames 2 to 5, 18)
- Header: back, view toggle (icon button), "Add class". Summary: "15 classes · 28 sections", plus an
  amber pill when any class has no section.
- **Cards view (default):** one white card per class in class order: name, section count, pencil to
  edit the class, then one section row.
- **The section row never wraps.** Two equal section columns, with "+" pinned at the right.
  - Every card is the same height, and the columns and "+" line up down the whole list. At 360 wide,
    almost 5 classes fit on screen.
  - One section takes the left column, so alignment holds.
  - Three or more scroll sideways under the pinned "+", with the next chip peeking in as the hint.
  - This holds at any font size: larger text scrolls the row rather than dropping "+" to a new line.
- **Section chip:** name with shift on the first line, room and seats with door and chair icons on the
  second. Empty facts are left out, so a chip never shows blanks.
- **No section:** an amber "No section yet" in the chip area, with the same pinned "+".
- **Compact view:** one grouped list of class name and "2 sections", or amber "No section". 11 classes
  fit on screen. Tapping a class opens it in place with its section row and pencil; opening another
  closes the first. The choice of view is remembered on the device.
- Add and edit section use a bottom sheet instead of a pushed form, so the new chip appears in
  place. The class is already chosen and the next letter is filled in.
- Add class: order is prefilled with the next number.

### Subject & Mapping (frames 6 to 12)
- Header: back, "Subject types" (needs `exam:read`).
- Chip row that scrolls sideways, staying visible while the list scrolls: All subjects, then each
  class. An amber dot marks a class with no subjects, and its spoken label says so.
- **All subjects:** count, "Add subject", grouped list, edit in the existing sheet. Each row shows how
  many classes have the subject ("HIN · 13 of 15 classes"), with a "Map" button until all do.
- **Map to every class (frames 7, 8):** a sheet from "Map". "Every class" is on by default and covers
  only classes without the subject, so nothing is mapped twice. Turning it off lets the admin tick
  classes as chips. The subject type field follows the same rules as the Map subject sheet. Saving
  shows progress and retries only failures, as "Add subjects" already does.
- **A class:** "10 of 12 subjects mapped to Class 6", "Map subjects", then rows with core or elective
  and the subject type as a pill. An older row with no type shows an amber "No subject type" pill;
  tapping opens the edit sheet.
- Report-card position moves out of the row and stays editable in the edit sheet, because "Position
  0" on every row is noise.
- Opens on All subjects, or on a named class when arriving from the setup card.

### Map subject sheet (frames 10, 11)
Same layout and bulk flow. Only the type field changes:

| School's types | Field starts on |
|---|---|
| A default is set | The default |
| No default, one type | That type |
| No default, several | Empty, must choose before saving |
| None | Field replaced by a notice and "Add a subject type" |

The edit sheet loses "School default" too.

### Subject types (frame 12)
Default shown as a pill on one row. "Make default" lives in the type's editor, as grading scales do.
Retiring the default leaves no default. The starter set marks Main Subjects as the default.

## 4. Setup card and popup

### Card (frames 13, 14, 16)
Compact by default: title, "3 of 8 done", an 8-part meter, the one next step, and "All steps" to
expand in place. Sits under the Home header. With everything done it renders nothing. If the last
step finishes while the app is open, a green "Main Campus is ready" card shows once, with a success
haptic.

### Popup (frame 15)
A bottom sheet listing only what is left, with "Continue: {next step}" and "Later".

- Shows once per fresh launch, held in memory, so returning from another app never triggers it.
- Waits for Home, after any forced password change, and only after status has loaded.
- If status fails to load: no popup and no card. Setup help never blocks or nags with an error.
- Switching branch updates the card but does not reopen the popup.
- Backdrop and Android back mean "Later".

### Steps

| Step | Done when | Waits for | Opens | Shown with |
|---|---|---|---|---|
| Session | A session is running | | Sessions | `academic_year:create` |
| Terms | Running session has at least 1 term | Session | Terms | `academic_year:create` |
| Classes | At least 1 active class | | Class & Section | `class:create` |
| Sections | Every active class has a section | Session, Classes | Class & Section | `section:create` |
| Subjects | At least 1 active subject | | Subject & Mapping | `subject:create` |
| Subject types | At least 1 active type | | Subject types | `exam:create` |
| Class subjects | Every active class has a mapped subject | Session, Classes, Subjects, Subject types | First class missing them | `subject:create` |
| Working days | Running session has calendar rows | Session | Attendance calendar | `attendance:update` |

- **Whole-card gate:** `academic_year:create`. Without it, no card and no popup. This keeps class
  teachers out: they hold `attendance:update`, so a per-row check alone would show them a popup with
  only Working days. Inside the gate, steps the person can't do are hidden and not counted.
- **Next step:** the first unfinished step that isn't waiting on another.
- **Known behaviour:** a new class, or an unused one, reopens Sections and Class subjects. The school
  clears that by completing the class or retiring it.
- **Next year:** a new running session starts these steps again, which is correct.
- **Per branch:** the card follows the active branch, so a new school starts fresh.
- **Teachers:** without the gate and with no running session, Home shows frame 19 instead of "Ask your
  administrator".

## 5. Backend changes

1. **Merge permissions (ADR-054):** `subject_mapping:read/create/update/delete` become the matching
   `subject:*` in routers, the matrix, mobile, web and tests. Saved `org_role_permissions` rows are
   converted, not deleted. By default only vice principals change: they gain reading class subjects.
2. **Subject type required:** required on mapping create, and can't be cleared on update. The service
   also checks that the type belongs to the school (a gap today, `assignment.service.ts:165`).
3. **Real default (ADR-055):** `subject_types.is_default`, one per school by partial unique index, a
   make-default action, the same pattern as grading scales. Migration needed.
4. **First session runs automatically (ADR-056):** creating a session when the school has no running
   one also makes it running. Later sessions keep the confirm.
5. **Status read:** one `academic.setupStatus` read returning the counts and the classes missing
   sections or subjects, gated on `academic_year:create`. Needed because class subjects can only be
   listed per class.
6. **Subject coverage read:** one `assignment.subjectMapping.coverage` read for a session, returning
   which classes have which subjects, gated on `subject:read`. It powers "13 of 15 classes" and the
   classes offered when mapping, since mappings can only be listed per class today. Saving uses the
   existing create call per class, so no new write is needed.
7. **Provisioning script:** `apps/api/scripts/provision-tenant.ts` creates the org with its matrix, the
   school with its scope node, the admin with `must_change_password`, and the `org_admin` assignment.
   Refuses an existing slug. Creates no session, so the admin's first step is real.
8. **Same-password check:** the change-password screen refuses the current password, so the forced
   change can't be skipped by retyping it.

## 6. Craft and states

**Motion** (Reanimated 4.5.1, Expo SDK 57; verify against current docs at build): press scale 0.98;
new chips and rows fade in while neighbours slide (200 ms); the meter fills on change (320 ms);
selection haptic on chips; success haptic only after the server confirms. All respect Reduce Motion.

**Type and layout:** token sizes only, tabular numbers for counts, chips aligned to the 4-pt grid.
New `AppIcon` entries for room, chair and the two view icons. Material names are confirmed in the
installed package (`meeting-room`, `chair-alt`, `view-headline`, `view-agenda`). SF Symbol names are
not yet confirmed; they are compile-checked at build.

| State | Behaviour |
|---|---|
| Loading | Skeletons shaped like the real class cards and rows |
| Empty | One clear action (frame 18) |
| Error | Existing error card with retry; typed sheet values are kept |
| Offline | Same as error, online-only per ADR-043 |
| No permission | Add, edit and "+" hidden; existing denied state if the list can't be read |
| No session | Classes and subjects work; section "+" and class tabs say a session is needed |
| Submitting | Button shows loading; nothing appears as saved until the server confirms |
| 1.3x text | Section row scrolls sideways and "+" stays pinned; nothing is cut off |

**Accessibility:** 44pt or larger targets on the pencil, "+", chips and tabs. Status is never colour
alone. A chip announces "Section A, day shift, room 09, 30 seats".

## 7. Calls I made for you to check

- **First session runs automatically:** covers every school, including ones added later from Branches.
  The script doesn't create one, since we'd have to know each school's dates.
- **Section add and edit become a sheet** rather than the pushed form. It's more work, but adding 30
  sections through push and back is the slowest part of setup.
- **Next letter and next order number are prefilled.** Not a preset, just less typing.
- **Cards is the default view,** because setup needs the sections visible. The toggle is remembered.
- **Three or more sections scroll sideways** instead of wrapping, so all cards stay the same height.
- **Mapping to every class saves as core subjects.** Electives are set per class in the edit sheet.
- **Grouped lists** for subjects instead of separate cards: calmer and denser for 12 or more rows.
- **The Subject types screen stays reachable from exam setup too,** alongside the new button.
- **Web's "Result type" label** changes too, one string, so the apps match.

Known risk, by your choice: until first login, anyone who knows the admin's email can sign in with the
default password. Hand over credentials shortly after provisioning.

## 8. Not in this work

Presets and templates; copying from last session; adding staff on mobile (so no Teachers step); exam
setup prompts for grading scales and pass rules; student import.

## 9. Acceptance

- [ ] A script-created admin signs in, must change password, and can't reuse the same one.
- [ ] On a fresh school, every unlocked step opens a screen that can complete it.
- [ ] The first session runs without a second step, and Terms and Sections unlock.
- [ ] Popup shows on fresh launch, not when returning from another app, and never for a teacher.
- [ ] A class with no section or subjects keeps its step open and shows the gap on screen.
- [ ] The card disappears when finished, and every screen works when unfinished.
- [ ] A class subject can't be saved without a type on mobile, web or API.
- [ ] Two sections and "+" stay on one line at 360 wide, at 1.0x and 1.3x text.
- [ ] Compact view shows name and count, opens a class in place, and is remembered after a restart.
- [ ] Mapping a subject to every class skips classes that have it, and retries only failures.
- [ ] A vice principal sees class subjects; nobody loses access in the default matrix.
- [ ] Device walk at 360 wide, at 1.0x and 1.3x text, on Android, and iOS at its release gate.
- [ ] `pnpm check-types` and tests pass.

## 10. Delivery

Each chunk ends at its gates with a commit message and file list. The owner commits.

| Chunk | Contents |
|---|---|
| A | Merge `subject_mapping` into `subject`, ADR-054 |
| B | Subject type required, real default, the rename, ADR-055 |
| C | Revamp: Academic setup, Class & Section, Subject & Mapping |
| D | First session runs automatically, ADR-056; provisioning script; same-password check |
| E | Status read, setup card, popup, teacher message; device walk |

`docs/TASKS.md` and the route ledger in `docs/MOBILE_PLAN.md` are updated as chunks land.
