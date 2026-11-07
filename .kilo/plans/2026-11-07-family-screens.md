# Family screens: build plan (simple look, built to be redesigned)

Status: **draft for owner review, 2026-11-07. Nothing built.**

Owner brief (2026-11-07):

- Build the family (parent/student) screens now with a **simple** look, but
  with good code and good UX.
- The premium redesign comes later, **one component at a time** ("one day the
  button, another day the cards"), so every look decision must live in one
  place.
- Changing a colour or a button radius must be a one-line change.
- Transitions must be smooth.
- English first, but **other languages are coming soon**; code so adding one
  is easy.
- Visual reference for now: `docs/design/mobile/student-side-theme-ref-only.png`.

Backend is done (ADR-061, ADR-062, `a5d8461`). Parent and student logins see
exactly the same thing.

Out of scope: homework (revamp coming), results and report cards (the
partial term card problem), notifications, payments online.

---

## 1. Reading the reference

What we take now (simple, cheap, already beautiful):

| Element | In the reference | Our token / component |
|---|---|---|
| Ground | white with a faint cool-to-warm wash | `color.canvas` (flat white now; the wash is a later premium step) |
| Headings | very heavy grotesk, tight tracking | Clash Grotesk Bold (already in the app), `type.display` |
| Rows | soft grey, large radius, no border, no shadow | `FRow` / `FCard`, `card.radius`, `card.bg` |
| Big numbers | heavy, right-aligned | `FNumber` |
| Segmented control | black pill on a light grey track | `FSegment` |
| Primary button | black pill | `FButton` |
| Tab bar | floating white bar, black pill on the active tab | `FTabBar` |
| Up / down | muted grey up, orange-red down | tones `positive` / `critical` |

What we leave for the premium pass: the stamp, the handwritten note, the
mascot, the background wash, motion flourishes.

---

## 2. Theme: three layers, one place

All under `apps/mobile/src/family/theme/`.

1. **`palette.ts`: raw values.** Hex colours, radii, font files. Nothing
   outside the theme folder imports it.
2. **`roles.ts`: meaning.** `canvas`, `surface`, `surfaceMuted`, `ink`,
   `muted`, `accent`, `onAccent`, `hairline`, and tones `positive`,
   `caution`, `critical`, `neutral` (fg + bg each). Spacing, type scale and
   touch sizes come from the existing `theme/tokens.ts` where they are the
   same.
3. **`components.ts`: one block per component.** For example:

   ```ts
   button: { height: 52, radius: r.full, bg: c.accent, fg: c.onAccent,
             pressedScale: 0.97, font: type.label },
   card:   { radius: r.xl, bg: c.surfaceMuted, padding: s.lg, gap: s.md },
   segment:{ trackBg: c.surfaceMuted, activeBg: c.accent, radius: r.full },
   ```

   Making the button premium later means changing the `button` block, or
   swapping the `FButton` file. No screen changes.

**`useFamilyTheme()`** returns the theme. Components read it through the hook,
never by importing a file. Today it returns one static object; later it can
switch for dark mode or a school's own colour without touching any screen.

**Guard:** an ESLint rule on `src/family/**` and `src/app/(family)/**` that
fails on hex colour literals and numeric `borderRadius` in screen files. Only
`src/family/theme/` may hold them.

---

## 3. Family component kit

Under `apps/mobile/src/family/ui/`, prefix `F` so they never get mixed up
with staff components. Each component:

- takes **content and meaning** as props (`tone="critical"`, `size="lg"`),
  never colours or radii,
- reads its look only from its `components.ts` block,
- owns its own press feedback, loading and disabled states,
- has a jest test for its logic where it has any.

First set: `FText` (variants), `FButton`, `FCard`, `FRow` (title, sub,
trailing value, chevron), `FSegment`, `FPill`, `FNumber` (formatted, counts
up), `FSheet`, `FTabBar`, `FHeader`, `FChildSwitcher`, `FSkeleton`,
`FEmptyState`, `FErrorState`, `FScreen` (safe area, pull to refresh, scroll).

Shared with staff where it is not visual: haptics, the bottom-sheet engine,
the tRPC client, error mapping, session handling.

---

## 4. Motion

Reanimated 4 (already installed). Motion values live in the theme
(`motion.press`, `motion.enter`, `motion.spring`), so the feel is tuned in one
place.

Shared motion pieces, used everywhere:

- **Press:** scale and haptic, never delaying the action.
- **Load:** the skeleton has the exact shape of the content, then a
  cross-fade, so nothing jumps.
- **Numbers:** percentages and amounts count up once on first show.
- **Lists:** rows fade and rise in a short stagger on first load only.
- **Child switch:** content cross-fades; the header name slides.
- **Screens:** the native stack's own push, so it stays at 60 fps.

Respects the phone's "reduce motion": everything becomes an instant change.
Checked on a cheap Android phone, not only the emulator.

---

## 5. Languages (i18n)

English only now, built so a new language is "add files, touch no screen".

- **Library:** `i18next` + `react-i18next` + `expo-localization`, as
  `docs/MOBILE_PLAN.md` section 4 already plans. The family side starts on it
  from day one. The staff side keeps `lib/copy.ts` for now; moving it is a
  separate job.
- **Keys:** `t("family.fees.dueNow")`, one namespace per area
  (`family.common`, `family.auth`, `family.attendance`, `family.fees`,
  `family.exams`), English in `src/family/i18n/en/*.json`.
- **No string building in code.** Whole sentences with named values
  (`"{{count}} days present"`), plurals through i18next (`_one` / `_other`),
  never `"Up " + n + " since " + name`. Word order differs between languages.
- **One formatter module** for dates, months, times, money (₹ with Indian
  grouping, 1,25,000) and percentages, using `Intl` with the current
  language. Screens never format by hand.
- **Server text is shown as is.** Subject names, fee head names, exam names
  and holiday labels are typed by the school and stay in their language.
  The month `label` the fee read sends is English, so the app formats the
  month itself from its key instead.
- **Layouts handle longer text.** Hindi and Bengali run longer and taller: no
  fixed-width labels, text wraps, 1.3x text size checked.
- **Fonts for other scripts.** Clash Grotesk has Latin only. When a new
  language arrives, its script needs a matching font (for example Noto Sans
  Devanagari / Bengali) in the type tokens; the plan leaves room for a
  per-language font family in `FText`.
- **In-app language choice,** stored on the phone, because one family phone
  is shared by several readers. The picker comes with the second language.
- **Tests:** a jest check that every key used exists in `en`, and no raw
  string literals inside `FText` in family screens (lint).

Not covered now: server-made PDFs (receipts, statements) stay English; that's
a later backend job.

---

## 6. Screens and UX

### 6.1 Login (shared screen, Staff / Parent switch)

- **Parent / student:** phone number, then the server decides:
  password, or first-time claim (verify against the child's details, set a
  password, signed in straight away). Forgot password. Forced password
  change.
- One clear error line, never which part was wrong (the server's uniform
  refusal).
- Keyboard: numeric pad for the phone, return moves to the next field.
- After sign-in, the app sends a family login to `(family)`; the "staff
  only" notice goes away.

### 6.2 Shell

- **Tabs:** Home, Attendance, Fees, Exams. Homework hidden until the revamp.
- **Child switcher** in every tab's header ("Aarav, Class 6 · A"), a sheet
  listing the children. The chosen child is remembered on the phone. One
  child: the header shows the name, with no switcher.
- **Pull to refresh** on every tab. Offline: last data stays with a quiet
  "Offline, showing last update" line.

### 6.3 Home

A short "today" view for the chosen child, built from the existing reads:

- attendance today and this month's percentage
- fees: due now, or "All paid", with the next due date
- next exam: name and first paper date, or nothing
- each card opens its tab

### 6.4 Attendance

- **Header number:** this year's "so far" percentage, with days attended of
  working days.
- **Period segment:** Month / Term / Year.
- **Month calendar:** each day coloured by status (present, absent, late,
  half day, leave, holiday, not marked yet, before joining). Tap a day for its
  status and the holiday name. Swipe or arrows for the month.
- **Ranking card:** "Rank 4 of 38 in Class 6 · A", the top 10 list with
  full names, the child highlighted. "Not ranked yet: needs 15 days" when
  below the minimum. Hidden list when the school switched it off (own rank
  stays).
- Late counted as present or not follows the school's setting, and the
  screen says so in the counts.

### 6.5 Fees

- **Header number:** due now, or "All paid".
- **Months strip:** each month's state (paid, due, overdue, upcoming), the
  same months the admin page shows.
- **Dues list:** fee head, period, balance; overdue first.
- **Previous dues** and **concessions** (type and amount) when present.
- **Payments:** receipt number, date, mode, amount, status (cleared, cheque
  pending, bounced, cancelled, refunded). Tap for what it paid.
- **Receipt and statement:** open, share or save as PDF, the same way the
  staff app prints.

**Relation to the admin student fee page** (`screens/fees/student-desk.tsx`
and friends): same information and order, rebuilt with the `F` kit. Not
reused as components: the staff ones are hard-wired to the staff palette and
carry desk actions (Collect, concession, one-off, void, refund). Pure logic
in `lib/fees.ts` (`isPayable`, `ledgerTotals` and similar) is shared; its
English label maps are not, since family text goes through i18n keys.

### 6.6 Exams

- **List:** upcoming first, then ongoing, then past; each with its state
  (upcoming, ongoing, marks being checked, results out) and date range.
  Mock and class tests included.
- **Detail:** the child's own date sheet: day, date, time, duration, venue,
  parts with max marks. "Today" and "next paper" highlighted. "Results out"
  says where to look; no marks here.

### 6.7 States every screen has

Loading (skeleton), empty (a friendly line, never a blank screen), error
(one line and Retry), offline (last data plus a note), and "no data for this
year yet".

---

## 7. Backend gap found while planning

**The child switcher has no read.** `me.get` gives only the owned student
ids, and `portal.enrollment.list` gives enrolment rows without names or class
names. Proposed: `portal.children.list`: for each owned child, name, photo
url, school name, current class and section, current year. Small, same
ownership door as ADR-062, with an integration test and a smoke check.

---

## 8. Order of work

Each chunk: build, jest, typecheck and lint, walk on the emulator, then the
owner reviews.

1. **Foundation:** theme layers and hook, i18n setup and formatter module,
   lint guards, the `F` kit, motion pieces. A hidden dev screen shows every
   component in every state, so a redesign can be checked in one place.
2. **Login and shell:** family sign-in, the `(family)` route group, tabs,
   `portal.children.list` and the child switcher, Home with its cards.
3. **Attendance.**
4. **Fees.**
5. **Exams.**

---

## 9. Owner answers, 2026-11-07

- **Premium extras** (stamp, note, mascot): not now. **Background wash:** yes
  if easy. It is: React Native 0.86 draws CSS `linear-gradient` through the
  `experimental_backgroundImage` style on the New Architecture, no new
  library. One `canvas.wash` token; flat white if it misbehaves on a device.
- **Q1 login:** see 9.1, awaiting the owner's pick.
- **Q2 tabs:** Home, Attendance, Fees, Exams for now.
- **Q3 Home:** keep it simple now; the thoughtful Home comes later.
- **Q4 cheques:** show uncleared cheques as pending.
- **Q5 language:** no single pick needed; build RTL-safe and script-safe
  from day one (9.2).

### 9.1 One login screen

Staff sign in with email, families with phone. One screen still works: a
single "Email or phone number" field, and the app decides by what is typed
(an `@` means staff email; digits mean a family phone), then shows the right
next step. Alternatives: a Staff / Parent switch above the form, or a choice
before the form. Edge: one person who is both staff and a parent has two
logins (email and phone) and lands in whichever they used.

### 9.2 What any second language needs

- **Hindi, Bengali, Marathi and other Indian scripts:** a matching font,
  more line height, longer labels. Covered by section 5.
- **Urdu (right to left):** the whole layout mirrors. Cheap if built in now:
  `start`/`end` instead of `left`/`right` in every style, icons that flip
  where direction matters, and a lint check. Expensive to retrofit later.
- **Mandarin and other CJK:** a large font file and different line breaking;
  unlikely for Indian schools, nothing extra now.

### 9.3 Owner answers, round 2 (2026-11-07)

- **Login:** the one smart field is rejected. Remaining shapes: a Staff /
  Parent switch, a choice before the form, or (new) the parent phone form by
  default with a small "Staff sign in" link below. Awaiting the pick.
- **Languages:** Indian scripts only. Right-to-left support (Urdu) drops out;
  section 5's font, line height and longer-text rules stay.
- **Bookie** (`components/bookie.tsx`, commit `817d719`): use it on the
  family side. Its colours move behind the family theme (a `mascot` block in
  `components.ts` reading `brand-bookie.ts`), so the redesign stays in one
  place. Where it appears: login, empty states ("No exams yet"), the "All
  paid" fees state, the child's own ranking card (happy mood in the top 10),
  and offline/error states. Not on every screen. Decorative, so no screen
  reader label unless it carries meaning. Needs a new dev build
  (react-native-svg).
- **Fees:** same information and order as the admin student fee page, in the
  family theme (see 6.5 note).

### Questions as asked

- **Q1. Login:** one screen with a Staff / Parent switch (proposed), or a
  choice before the form?
- **Q2. Tab names:** Home, Attendance, Fees, Exams. Fine?
- **Q3. Home:** the three cards above, or skip Home for now and open on
  Attendance?
- **Q4. Payments with a pending cheque:** count them in "paid" or show them
  as pending until cleared? (Proposed: pending.)
- **Q5. First second language** you expect (Hindi, Bengali, other)? It only
  decides which font to keep room for.

---

## 10. Chunk 1 build record: foundation (2026-11-07, uncommitted)

Owner said "okay then start?"; login shape defaulted to the parent phone form
with a small "Staff sign in" link (9.3 option, still to confirm in chunk 2).

### What exists

- **Languages** (`src/family/i18n/`): i18next + react-i18next +
  expo-localization; English JSON per namespace (`common`, `kit`); typed keys
  (`i18next.d.ts`, a key typo is a compile error); saved in-app language
  choice (`loadSavedLanguage`, `setLanguage`); `currentScript()` feeds the
  theme's font and line height. `format.ts` (`useFormat()`): dates, ranges,
  months, 12-hour times, durations with plurals, percentages, money with
  Indian grouping; month and weekday names come from the language files.
- **Theme** (`src/family/theme/`): `palette.ts` (raw values, the only hex and
  radius numbers), `roles.ts` (meaning, type scale, motion, spacing),
  `components.ts` (one block per component), `index.tsx`
  (`FamilyThemeProvider`, `useFamilyTheme()`, fonts and line height by
  script). The background wash uses `experimental_backgroundImage`; setting
  `color.wash` to `null` makes it flat.
- **Motion** (`src/family/motion/`): `usePress`, `Enter` (fade and rise with
  stagger), `Reveal` (placeholder to content cross-fade), `useCountUp`. All
  follow Reduce Motion.
- **Kit** (`src/family/ui/`): `FText`, `FButton`, `FCard`, `FRow` /
  `FRowStack`, `FSegment` (sliding pill), `FPill`, `FNumber` (counts up),
  `FSkeleton` (pulse), `FMascot` (Bookie in theme colours), `FEmptyState`,
  `FErrorState`, `FOfflineNote`, `FScreen`, `FHeader`, `FSheet`,
  `FChildSwitcher`, `FTabBar` / `FTabBarView`.
- **Bookie** (`src/components/bookie.tsx`): new optional `colors` prop,
  default unchanged.
- **Lint guards** (`eslint.config.js`): in `src/family/**` and
  `src/app/(family)/**` (theme folder and tests excepted), hex and rgb
  literals, numeric radii and raw JSX text are errors. Proven with a
  throwaway file (3 errors caught), then deleted.
- **Showcase**: `src/app/family-kit.tsx` (dev builds only,
  `mskool://family-kit`) shows every component in every state.

### Gates

- `pnpm check-types`: 9/9.
- Mobile jest: 45 suites, 768 tests (new: `format.test.ts`,
  `resources.test.ts`, which also fails if a future language misses a key).
- Mobile lint: 0 errors.

### Commit hand-off

Shared files hold the owner's own edits too: `apps/mobile/package.json` (my
part: `expo-localization`, `i18next`, `react-i18next`), `apps/mobile/app.json`
(my part: the `expo-localization` plugin line), `pnpm-lock.yaml`. New files:
`apps/mobile/src/family/`, `apps/mobile/src/app/family-kit.tsx`. Edited:
`apps/mobile/eslint.config.js`, `apps/mobile/src/components/bookie.tsx`.

A new dev build is needed (react-native-svg, expo-localization).

### Emulator walk (emulator-5554, new dev build, 2026-11-07)

Opened by deep link `mskool://family-kit` (no taps on staff screens).
Checked: text variants, buttons (all four states), segment slide Month to
Year, pills, rows and card, count-up numbers, skeleton to content, offline
note, empty and error states with Bookie, mascot moods, sheet open and
close (Back), child switcher sheet and switch, tab bar switching, the
background wash.

Fixed during the walk:
1. A loading button shrank to a blob: the label now stays, invisible, under
   the spinner.
2. Content scrolled under the clock: `FScreen` draws a status bar band
   (`components.screen.statusBarBg`).
3. A newly active tab pill drew square on Android (a background switching
   from transparent loses its rounding): the active pill is now its own
   view with an exact radius (`components.tabBar.iconPill`).

Not checked: iOS, 1.3x text, Reduce Motion on the device, TalkBack, a cheap
real phone.

---

## 11. Chunk 2 build record: login, shell, Home (2026-11-07, uncommitted)

Owner: Staff sign in "not that small", so it is a full secondary button.

### What exists

- **Backend:** `portal.children.list` (contract `portalChildSummarySchema`,
  `listPortalChildren` in `packages/services/src/portal-child.ts`, route in
  `enrollment.router.ts` beside `portal.enrollment`). Ownership only; children
  without an enrolment are left out. Integration test added to
  `portal-family.integration.test.ts` (12/12 pass).
- **Login** (`src/app/(auth)/login.tsx`): parent phone form by default; "Staff
  sign in" opens the old staff form (moved unchanged to
  `src/screens/auth/staff-login-form.tsx`, plus a "Parent or student sign in"
  button back). The phone remembers the last form used (`login.mode`).
- **Family sign-in** (`src/family/screens/family-login.tsx`,
  `src/family/lib/sign-in.ts` + tests): phone → server picks password or
  first-time setup; Forgot password is the same claim; date of birth masked
  as DD / MM / YYYY; one uniform refusal line. New kit part `FTextField`.
- **Shell** (`src/app/family/`): guard (session, forced change, owns a
  child), language load, theme, `FamilyChildProvider`
  (`src/family/child-context.tsx`, remembers the chosen child), tabs Home /
  Attendance / Fees / Exams with `FTabBar`. Attendance, Fees and Exams show
  "Coming soon" until chunks 3 to 5. Routes sit under `/family/...` because
  the staff tabs already own `/home`, `/fees` and so on.
- **Home** (`src/family/screens/home.tsx`): attendance this month, fees due
  now (or All paid / not set), next exam; each card opens its tab; loading
  skeletons, per-card retry, offline note, no-children state, sign out.
- **Dispatch** (`src/app/index.tsx`): staff first, then family; a login with
  neither gets an honest notice.
- **Lint guard** now covers `src/app/family/**`.

### Emulator walk (2026-11-07)

Walked: empty phone error; phone → password step; wrong password (uniform
line); Forgot password with a wrong date of birth (uniform refusal) and with
the right one (signed in); a login whose children have no enrolment (the
no-children state); sign out; the demo parent (9800000001) with the seed
password → forced change → Home with real figures (33.3%, ₹11,620 due,
Unit Test 2); card → Fees tab.

Fixed during the walk:
1. Later step titles overflowed: those steps use the smaller title.
2. "Change number" kept the previous admission number and date of birth:
   going back to the phone step now clears them.

Data notes: the demo parent's password is now `Family1234` (the forced change
was completed); reseeding resets it. Test login 9950420246's password was
reset through the claim flow. The emulator is left signed in as the demo
parent.

Not walked: first-time setup (no unclaimed login with an enrolled child
exists), the child switcher with two real children (none in the data; the kit
screen covers the sheet), offline, 1.3x text, TalkBack, iOS.

Known gaps:
- The forced password change still uses the staff screen's look.
- Home greets the child ("Hi, Aditi") even for a parent login; parent and
  student see the same app by design, so the wording may want a rethink.
- The no-children text says "not linked" even when links exist but the child
  has no enrolment.

### Gates

`pnpm check-types` 9/9; mobile jest 46 suites / 771; mobile lint 0 errors;
`check:openapi` passes (282 endpoints); `check:builders` fails only on
`public_site.router.ts`, the same on the last commit without these changes.

---

## 12. Chunk 3 build record: Attendance (2026-11-07, uncommitted)

### What exists

- `src/family/screens/attendance/index.tsx` (the tab), `calendar.tsx`,
  `ranking-card.tsx`; route `src/app/family/(tabs)/attendance.tsx`.
- Rules in `src/family/lib/attendance.ts` + tests: month stepping and
  bounds (first term's month to today's), the Monday-first grid, and how
  each day reads. A mark stored for a future date shows as "coming up",
  matching the counts, which stop at today.
- Strings in `src/family/i18n/en/attendance.json`; theme blocks
  `components.calendar` (a fill and text colour per day look) and
  `components.rank`. `format.day()` added.
- Screen: the session's "so far" percentage (counts up), Month / Term / Year
  segment, a stepper for month or term, five count tiles (present, absent,
  late, half day, leave) with the period summary and the school's late rule,
  the month calendar with a legend and a tap-a-day sheet (status, holiday
  name), and the ranking card: "Rank N of M", the top list with full names
  (ties share a rank; ties at 10th all show), the child's row outlined,
  Bookie happy in the top 10, "Not ranked yet" with the reason, or own rank
  only when the school hides the list. The chosen month and term are
  remembered per child for the session.

### Emulator walk (demo parent, Aditi, Class 6 · A)

Walked: November with two present days and today outlined; the ranking with
eight tied at 1st and four tied at 9th (12 rows); tap a day (Fri 6 Nov,
Present); Term 2 (counts, "needs 15 working days"); Year 2026-27; previous
month (October: before-joining days faint, unmarked days grey, "Nothing
marked yet").

Fixed during the walk: future-dated marks in the dev data showed as present
(now "coming up"); legend swatches were nearly invisible (now outlined).

Not walked: a holiday with a name, a hidden-ranking school, a child with no
section, offline, 1.3x text, TalkBack, iOS.

### Gates

Mobile tsc clean; jest 47 suites / 776; lint 0 errors.

---

## 13. Chunk 4 build record: Fees (2026-11-07, uncommitted)

Also in this round: cards and rows got a 1px hairline border
(`components.card.border`, `components.row.border`), owner's request.

### What exists

- `src/family/screens/fees/index.tsx` (the tab), `payment.tsx` (one
  payment), `use-fee-document.ts` (receipt / statement PDF through the
  existing `lib/fee-print.ts`), `use-due-label.ts`; routes
  `src/app/family/(tabs)/fees.tsx` and `src/app/family/payment/[id].tsx`.
- Rules in `src/family/lib/fees.ts` + tests: open dues oldest first, a
  month's dues, overdue, tones for month and payment states, mode and
  concession keys, and how a due is named ("Tuition Fee · May" for a monthly
  due, the school's own name for a one-off charge).
- Strings in `src/family/i18n/en/fees.json`; theme block
  `components.monthChip`.
- Tab: due now (counts up, red) with the overdue or this-month line, or
  "All paid" with a happy Bookie; tiles for paid this session, concession,
  still to come; the months strip (tap a month to list all its dues, paid
  ones included; "Show all months" goes back); "To pay"; earlier sessions'
  dues; concessions (type and amount only, F2); payments with any
  non-received status in the coloured second line (F3); Download statement
  (F4). Fees not set yet: an empty state.
- Payment: amount, date and mode, status pill with what it means, refund,
  what it paid (dues, the payment's late fee, earlier dues), Share receipt
  and Print.

### Emulator walk (demo parent, Aditi)

Walked: the tab with ₹11,620 due and ₹7,200 overdue; tiles; the months
strip; April's filter (three paid dues) and Show all months; earlier
sessions' ₹3,000; payments; the pending UPI payment's detail; Share receipt
(the PDF "Receipt-RCP-2026-00002.pdf" reached the share sheet, dismissed
without sending); back.

Fixed during the walk: raw due descriptions ("Lab Fee — 2026-05") are now
"Lab Fee · May"; the Pending pill squeezed the receipt number (status moved
into the second line); the payment's own late fee was missing from "What it
paid".

Not walked: the statement PDF, Print, a bounced or refunded payment, the
"All paid" and "fees not set" states, a one-off charge, offline, 1.3x text,
TalkBack, iOS. Making the receipt PDF took about 15 seconds on the emulator.

### Gates

Mobile tsc clean; jest 48 suites; lint 0 errors.

---

## 14. Chunk 5 build record: Exams (2026-11-07, uncommitted)

### What exists

- `src/family/screens/exams/index.tsx` (the tab) and `exam.tsx` (one
  exam's date sheet); routes `src/app/family/(tabs)/exams.tsx` and
  `src/app/family/exam/[id].tsx`. `screens/coming-soon.tsx` is gone: all four
  tabs are real.
- Rules in `src/family/lib/exams.ts` + tests: coming up (soonest first) vs
  done (latest first), days until, the date sheet grouped by day, the next
  paper day.
- Strings in `src/family/i18n/en/exams.json`; `format.marks()` added;
  `FCard` gained `highlighted` (theme `components.card.highlightBorder`).
- Tab: the next exam as a big card (name, type and term, "On now" / "Starts
  in N days", date range, paper count), then "Coming up" and "Done" rows with
  the state in the coloured second line; empty state.
- Date sheet: state pill and date range, a note for "marks being checked"
  and "results out", one card per day with each paper's subject, time,
  duration, room, max marks and parts (Theory 40, Practical 10). For a
  running or coming exam, today's and the next paper day are marked.

### Emulator walk (demo parent, Aditi)

Walked: the list (Unit Test 2 next and "On now", five done exams), the date
sheet with three days and a two-part paper, back, a "results out" exam.

Fixed during the walk: wide state pills squeezed exam names (state moved to
the second line); a finished exam with future dates marked a "Next" day (only
live exams mark days now).

Data note: Unit Test 2 reads "On now" after its last paper because its staff
status is still ongoing; that comes from the server's state rule, not the
app.

Not walked: an upcoming exam with a countdown, a venue, the empty state,
offline, 1.3x text, TalkBack, iOS.

### Gates

Mobile tsc clean; jest 49 suites / 785; lint 0 errors.
