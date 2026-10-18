# mskool staff app: design direction (working folder)

Status: **Design gate PASSED 2026-10-18.** The owner approved the v3 direction
("good, it has improved a lot. the design is good.") and re-cut the attendance
interaction (tap-to-change + long-press sheet + bulk pills) — v3.1 below. The
probe is the approved 6-frame set (`native.html` -> `shots/native/`: home,
marking, sheet, saved, fee find, collect; scan clean, three intended hue warns
on the attendance frames). **Next: the production shell + teacher attendance,
per `.kilo/plans/2026-10-18-mobile-shell-attendance.md`.** The console
direction and the themed exploration below are kept as the rejected trail.

## Brief (self-authored)

The owner has been driving via "what should we do now?" rather than answering
an interview; the product facts below are already established in the repo, and
the three feel-words are a proposal for confirmation when the exploration
sheet is shown. No image-generation tool is connected, and none may be used.

1. **What it is, and for whom.** mskool is the staff app of a multi-tenant
   school management system for private schools in India (CBSE / ICSE). Its
   users are school staff at work: class teachers, subject teachers,
   accountants at the fee counter, the admissions desk, vice-principals and
   principals. A native iOS + Android app (Expo), Android-first, used in
   classrooms, corridors and at counters: bright light, time pressure, often
   one hand.
2. **The core action.** In the first ten seconds, a class teacher marks
   today's attendance for their section, between periods, standing at the
   door. (The other core loops, fee collection and admission, are specified in
   `../02-accountant-fees.md` and `../03-front-office-admission.md`.)
3. **Feel (proposed).** Orderly, warm, exact. References from outside apps:
   a real Indian school attendance register (blue ink, red corrections, ruled
   columns, the red date stamp); a railway departure board (calm clarity under
   density); the assembly ground at 8:30 (order, morning warmth, everyone
   counted).
   The web console (brand amber primary #B45309, sharp corners,
   Space Grotesk, light admin tone) which the mobile app must NOT port; the
   native Step-0 shell (auth flows only, no design system yet); seeded demo
   data (Demo Trust, Demo Public School Main + North campuses, Class 6-A,
   Aditi Sharma DEMO-0001, AY 2025-26); the journey briefs one folder up; a
   machine-history row for "mskool Family" (see anti-repeat below).
5. **What is needed.** The Step-0 design gate: rendered, phone-sized visual
   specs the owner reviews and approves before the production shell is built.
   The deliverable here is the three-direction exploration; then the full
   5-8 screen set plus the app icon.
6. **Imagery reality (checked).** No image-generation tool; photography of
   children is barred by privacy (a staff tool holds student data; no staged
   children either). So the richness sources for all three directions are
   drawable: shape language, colour-material, illustration. Stated, not
   promised otherwise.

## Constraints carried from the repo

- Native app, not a web port (AGENTS.md mobile rule 1). iOS 26 structure per
  this skill; Android parity when built.
- Cross-platform type reality: the app ships on Android too. The themed set
  proposed bundled web fonts (Oswald / Baloo 2 / Archivo via
  `@expo-google-fonts`) because Apple-only faces cannot ship or render on this
  Windows machine. The utility direction below removes the problem: platform
  system stack.
- Dense staff data; money and student records demand measured contrast.
- Online-only (ADR-043): screens fail visibly; no offline theatre.
- Accessibility: 44pt targets, no colour-only status, Dynamic Type tolerance.

## Anti-repeat ledger

`~/.app-designer/history.md` row: **mskool Family** (2026-10-05) — object
(school bench) · light · rounded-grotesque (Figtree) · blue · colour-material
(varnish, steel, rivets). Any direction chosen below must differ from that row
on at least 3 of the 5 columns. Two of the three concepts are built to do so
by construction; the third (register, light ground) must earn it via type,
hue, and richness.

## The three concepts

Same screen, same content, same mid-use state in all three: Class 6-A's
attendance roster at 8:52, mid-mark (34 present, 2 absent, 1 late, 1 on leave
of 38), between periods.

| | A: The Register | B: The Blackboard | C: The Assembly |
|---|---|---|---|
| Concept sentence | mskool is the attendance register itself, open on the desk, ink still wet | mskool is the classroom blackboard at the bell, chalked and counted | mskool is the assembly ground at morning light, everyone counted in rows |
| Source family | printed | object | place |
| Ground | light (warm paper) | dark (board green) | colour-field (marigold) |
| Type | condensed (Oswald) | rounded (Baloo 2) | expanded (Archivo, wdth axis) |
| Richness | shape (ruled register grid, ink marks, stamp) | colour-material (board paint, chalk, wood) | illustration (garland and bead figures, one hand) |
| Accent hue | red (correction stamp) | yellow (chalk) | orange (marigold, deepened) |
| Signature idea | the pen tick that settles on the page | the chalk ring left around the mark just made | a bead per child; marking turns a bead |

One printed form only (A), per slop.md §7. The register must be rendered
warmly (paper, blue ink, one red), not as the grey-paper-and-mono rut.

## Exploration outcome

Rendered: `explore.html` -> `shots/explore/` (3x PNGs + `sheet.png` + `scan.txt`).
Scan result: 3/3 directions clean; the only warn left is the cross-direction
aggregate type-scale note, which is expected (three competing scales, not one).
Kit fonts: the device kit's SF Pro loads from macOS system paths; on this
Windows machine the renders use the loaded web fonts (Oswald / Baloo 2 /
Archivo) and system-ui falls back to Segoe. Native faces get their own check in
the iOS walk at the Mac/EAS gateway. No imagery: no image-generation tool is
connected, and children are not photographed in a staff tool (privacy);
richness is drawn, as stated in the brief.

### Owner decision (2026-10-17): themed directions rejected

Verdict on the three-concept sheet, verbatim: "no wtf.. we do not need any this
flashy eye catching theme for admin side screens". Read as an owner scope call,
not a tweak: staff screens in a school operations tool are instruments, not
brand worlds. The register / blackboard / assembly metaphors are dropped for
the staff app; `explore.html` and `shots/explore/` stay in this folder as the
rejected trail. Warmth and "world" are not deleted from the product — they
belong to the family-facing side if it is built, never to the
corridor-and-counter tool.

Owner priorities, re-stated 2026-10-17 and binding from here on:
**functionality, usability, good UI/UX, mobile friendliness.** Visual novelty
is not a goal for the staff app; every remaining frame and every build is
judged against those four, not against how it looks in isolation.

### Superseding direction: "the console in your pocket" (RETIRED — kept as trail; rejected by the owner 2026-10-17, see the v3 section below)

The staff app is the quiet, native version of the console the schools already
use: same tokens, no theatre. White ground, warm ink, and colour only where it
carries meaning — attendance status and the one primary action.

- Source of truth: `apps/web/src/app/globals.css` — primary
  oklch(0.555 0.163 49) (amber, #B45309), foreground #0C0A09, muted-foreground
  #79716B, border #E7E5E3, destructive red #E7000B. The console's radius 0
  relaxes to 10pt on controls for native touch; edges stay hairline.
- Palette (draft): ground #FFFFFF; ink #0C0A09; muted #79716B; hairline
  rgba(12,10,9,.08); on-accent warm white #FFFBEA; accent (pending pick) =
  console amber #B45309 on action + active tab, or neutral ink; status:
  absent #E7000B, late #A16207, present = quiet grey check, on-leave = muted
  text.
- Type: platform system stack (-apple-system / Roboto / Segoe); no bundled
  face in the staff app — at 7 sizes on a 402pt screen, the utility is the
  voice. (Console's Space Grotesk stays a web signature; adding it later is a
  one-file change.)
- Richness: none beyond structure — density, hairlines, tabular numerals, one
  4pt progress rule. No photography, illustration or themed surfaces.
- Signature: none. The discipline is the signature — exceptions are the only
  colour in the roster; one accent within thumb reach.
- Status system: unchanged from the briefs — every state is a word or glyph,
  never colour alone.
- Navigation: one bottom bar carries action and tabs (Save attendance + Home /
  Attendance / Students / More), flat white with a hairline top.
- Anti-repeat vs the mskool Family history row (school bench, light,
  rounded-grotesque, blue, colour-material): differs on type, hue and
  richness; only "light" is shared.

Rendered: `admin.html` -> `shots/admin/` (2 screens — same screen, accent on
the action in console amber vs neutral ink; 3x PNGs + `sheet.png` +
`scan.txt`). Scan: both clean; the app-wide note is the single 7-step type
scale, which is the intended one system.

Flow specs rendered (the design-gate set): `flows.html` -> `shots/flows/` — 8
frames, scan-clean (one intended warn on 03: red/amber/green, each earning its
place). Coverage: 01 home + branch menu (the cross-branch context switch), 02
attendance mid-mark (a row opens its five status options; everything defaults
to present, only exceptions get touched), 03 attendance saved (inline
confirmation after the server confirms; Edit for same-day changes), 04 fee
search with dues, 05 collect (amount pre-filled, mode chips, optional UPI
ref), 06 the ambiguous timeout (unconfirmed collection; "Check status" reuses
the same reference, so a posted payment can never be collected twice), 07
admission form with a validation error (all values preserved), 08 admitted
with no section yet ("Assign section" is the next step).

Grounding the specs carry: the demo school marks attendance DAILY,
homeroom-authoritative (`seed.ts` `markingMode: "daily"`), so the frames say
"Attendance · Wednesday 15 Oct" — no period copy (a correction over the
admin.html direction frame). Fee narrative rides the real seed (Tuition Fee
₹12,000/yr, monthly instalments, one cleared payment -> ₹11,000 open for
Aditi). The admission result matches the seeded enrolled-without-section case
(Rohan Verma); "Section is assigned after admission" is the F3 finding (no
section-capacity data exists).

### Owner rejection #2 (2026-10-17): "this is not mobile app"

Verdict on the flow-spec set, verbatim: "this is not mobile app. this is simply
web app. im tired of this using single color that too brown. ngl the web which
is very bad still had better UI UX than this. this is not now mobile apps are
designed. so many bad UI UX point."

Read plainly, and accepted: the console-derived frames were web tables in a
phone frame — text rows on flat white, hairline-led, one drab accent repeated
everywhere, none of the anatomy a 2026 phone app actually shows (cards on a
canvas, avatars, stat tiles, status pills, sheets, materials, a floating tab
bar). Comparing them to the web console and finding the web better is the
correct judgment. The console tokens are therefore retired for mobile; the
console remains the web's own language. The 8 flow *states and copy decisions*
(B2: all-present default; 03 inline saved + Edit; 06 "Check status" reusing the
same clientReference; 07/08 admission) survive — they were never the problem —
but their visuals will be re-rendered in the v3 language below.

### Superseding direction: v3, "the app that looks like an app" (current)

The staff app is a modern, native, information-rich tool: a phone app that
happens to run a school. Nothing themed, nothing austere — the two failure
modes this folder has now produced in turn.

What is on the screen (the native anatomy):

- Tinted canvas #F2F3F7 with white surface cards, radius 16 — the iOS grouped
  look; depth from materials and grouping, not from borders.
- Initials avatars on every person row (no student photography — privacy rule;
  initials are the standard Indian-staff-app fallback).
- Status always as a tinted *pill with the word in it* (Present / Absent /
  Late / On leave) plus tinted stat tiles above the roster. Colour = state,
  never decoration, and never the only carrier (the word is always there).
- A floating glass tab bar (iOS 26 `.glass`), capsule primary actions,
  large titles, and a real bottom sheet for marking — modal sheets, not pushed
  pages, for row-level edits.
- Pushed screens (back chevron, centred title) for money flows; search as a
  filled field, not a bordered box.

Colour system: **one accent, emerald `#0F7A44`** (`#0B6B3A` on tints), with
semantic green / red / amber / slate only as status. Rationale, in order of
weight: (1) the console amber read as "brown" and is the token the owner
rejected; (2) attendance must show green-present / red-absent / amber-late —
three semantic hue families — so a *fourth* saturated family for a decorative
primary would be pure decoration (and is a hard fail in the kit's colour
discipline); the accent therefore has to be one of the semantic families, and
green ("counted, present, done"; Google Classroom precedent) is the school
one; (3) it is a single-hue step away from any comfort zone this folder has
already burned.

Type stays the platform system stack — no bundled face in the staff app.

Carried from the flow set unchanged: every state word (Present…), the daily
homeroom model, the ₹11,000 Aditi fee narrative, DEMO-0001, the inline-saved
decision, the same-clientReference timeout recovery, admission validation
behaviour.

Probe rendered: `native.html` -> `shots/native/` — 6 frames (01 home, 02
attendance mid-mark, 03 marking sheet, 04 attendance saved, 05 fee find, 06
collect), 3x PNGs +
`sheet.png` + `scan.json`. Scan: no FAILs; two intended warns (the three
semantic hue families on 02/03/04 — green/red/amber, each carrying a status,
and nowhere else in the app). Contrast passes WCAG AA everywhere; type scale 9
steps app-wide {11,12,13,14,15,16,20,30,34}, every screen has an element that
owns it. The remaining flow states (fee timeout, admission form, admission
result) are re-rendered in this language when their slices reach design —
the shell and the attendance slice build against this set.

v3.1 (owner feedback, 2026-10-18): the attendance interaction was re-cut.
**Tap a student row toggles present / absent in one tap** — a change per tap,
no sheet in the way; any exception state (late / leave / half day) returns to
present on tap. The five-status sheet moved to **long-press** for the finer
states. Two bulk actions — **"All present" / "All absent"** — sit between the
stat tiles and the roster, with a one-line gesture hint under them ("Tap:
present / absent · Hold: late, leave, half day"). Re-rendered: `shots/native/`
(02, 03), plus the new saved frame (04).

### Owner review (2026-10-18): direction accepted; gate closed

Verdict, verbatim: "good, it has improved a lot. the design is good." followed
by the concrete interaction findings now folded into v3.1 above. Read as: the
language is approved; interaction depth is the bar each screen still meets.
Frame 04 (attendance saved) closes the attendance journey in the approved
language: the CTA's slot becomes a persistent green **"Attendance saved"** bar
with a white **Edit** pill — no decoration, the state itself is the
confirmation. The `docs/MOBILE_PLAN.md` review gate is closed for the shell +
attendance scope; build order: `.kilo/plans/2026-10-18-mobile-shell-attendance.md`.

Probe-only calls the owner may overrule: 3 tabs in the probe
(Home / Attendance / More — Students lives under More so labels centre clear
of the left third) instead of the proposed Home / Attendance / Students / More;
"Main Campus" as a text-only context chip; no period copy (daily model, as
established).

### Open questions — status after the 2026-10-18 review

1. Emerald as the action colour (v3) — **no objection raised; stands as the
   built token** unless the owner names a hue later.
2. Feel words: "orderly, exact" — no objection; carried into the shell.
3. Tab set: **Home / Attendance / More as probed** — stands; the shell builds
   this set role-aware (Students remains under More for now; restoring it as a
   tab is a one-line change if wanted).
4. From the journey briefs (F1): who holds front-desk credentials for
   admission — **still open**; blocks the admission slice only, not the shell
   or attendance. Recommendation in `../03-front-office-admission.md`.
5. Offline stance (ADR-043 online-only) — no objection; attendance builds
   online-only with visible failure states. Revisit at pilot if a scenario
   forces otherwise.
6. New build-time questions (half-day stat tile, day-picker pattern,
   subject-teacher home copy, read-only hint) — recorded in the slice plan's
   "Open questions"; resolve in the attendance device walk.


