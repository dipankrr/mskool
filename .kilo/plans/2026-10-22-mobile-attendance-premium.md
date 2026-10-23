# Mobile attendance premium pass — core screens

Status: **original scope approved 2026-10-22** (owner chose core screens first). Revision 1
(below) is built, device-walked, and previously E2E-green; it adds one additive half-day
migration and a bounded status-history read. **Revision 2** (owner UI feedback, 2026-10-23)
is built, gate-green, phone-walked, and E2E-green on the host SDK emulator. Committed
locally in the three prepared groups; owner review next, not pushed. The original pass had
no backend, migration, external UI kit, or iOS work.

## Design read

School staff operations app for teachers and principals in classrooms and corridors,
with a restrained native Android "instrument" interface. Dials: variance 4, motion 4,
density 7. This evolves the approved v3 language; it does not replace the palette,
system type, card surfaces, or native sheet patterns.

## Why this pass

The current screens are clean but read as a dashboard of equal-weight cards. The five
stat tiles, 40 dp segments, floating gear, large saved bar, and repeated "No roll number"
compete with the roster. The summary leads with 1.2% while only 6 of 311 days are marked,
so the most visible number is operationally misleading. Useful data already exists in
`attendance.summary`, `attendance.calendar.list`, and `attendance.status`; the pass uses
it before asking for a new endpoint.

## Scope

### 1. Mark — "the register, not the dashboard"

- Replace the five `StatTile`s with one **day pulse card**: hero present count, segmented
  status meter, exact counts for present / absent / late / on leave, and half day only
  when non-zero.
- Header: day button becomes a 48 dp target; add the calendar day type and a `Today`
  chip. Manage stays a 48 dp icon with the existing test ID.
- Roster: stop printing "No roll number" on every row; preserve roll in the
  accessibility label when present. Keep tap/long-press/bulk behaviour unchanged.
- Save bar: show the number of changed students when there are changes ("Save 4
  changes"); keep the approved saved bar and Edit action. Add success/error haptics.
- Day picker: replace the 31-row list with a month grid (Monday-first), day-type dots,
  selected ring, and a selected-day footer with day type and reason. Preserve every
  `day-option-<iso>` test ID and allow non-markable days to be selected so the refusal
  screen still explains the gate.

### 2. Summary — "coverage first"

- Year card leads with **days marked / working days** and a coverage bar. The official
  annual rate becomes a secondary, explainable line (the exam-eligibility figure), not
  the hero. Add a "How this is calculated" sheet.
- Add a section status strip: present / absent / late / on leave totals from the existing
  rows.
- Student rows: status meter scaled to marked days, exact bucket meta (retains
  `1 absent` for the E2E contract), right-side `present/marked` count, and a chevron.
- Tapping a student opens a **detail sheet**: coverage, official rate, marked-day
  breakdown, present share of marked days, and the known half-day limitation.
- No-data state offers "Mark today" and switches to the Mark panel.

### 3. Manage hub — live, not static

- Calendar: whole-session query, live working-day count, next non-working day with
  reason, fallback when the calendar is absent.
- Policy: include the late-arrival window in the live subtitle.
- Periods: keep the existing live count.
- Add a section label so the configuration card has a clear place in the hierarchy.

## Data mapping (no new endpoint)

| Surface         | Existing source                           | Use                                      |
| --------------- | ----------------------------------------- | ---------------------------------------- |
| Day pulse       | `attendance.status` + local draft counts  | present/absent/late/leave/half-day meter |
| Day context     | `attendance.calendar.list` (month)        | day type, reason, grid dots              |
| Coverage        | `attendance.summary` annual/term rows     | marked / working days                    |
| Official rate   | `attendance.summary.attendancePercentage` | secondary exam-eligibility figure        |
| Status strip    | summary bucket sums                       | present / absent / late / on leave       |
| Student row     | summary buckets                           | meter, meta, present/marked              |
| Manage calendar | `attendance.calendar.list` (session)      | working days, next holiday               |
| Manage policy   | `attendance.policy.get`                   | mode, rule, late window                  |
| Manage periods  | `attendance.period.list`                  | count for the section                    |

Half-day counts were **not** in the first pass; the 2026-10-23 revision below adds
`attendance_summary.days_half_day` and surfaces the bucket across Mark and Summary. The
detail sheet now explains how half day counts (marked day, not official present).

## States

Every data surface keeps the existing loading, error + retry, empty, permission-denied,
offline, submitting, success, and resume behaviour. New sheets are dismissible with
platform back, use 48 dp targets, and carry labels/hints. The status meter is decorative
where adjacent text already names the counts.

## Acceptance

- `pnpm check-types`, `pnpm test`, and `pnpm lint` are green.
- Existing E2E IDs and copy contracts survive: `attendance-save`, `attendance-saved`,
  `attendance-edit`, `attendance-manage-entry`, `attendance-view-summary`, `day-option-*`,
  `manage-*`, and the summary string `1 absent`.
- Mark, Summary, and Manage render on a phone-sized Android screen at normal and large
  font scales; no clipped labels or <48 dp interactive targets.
- Real API/Postgres behaviour is unchanged: no new writes, no schema changes.
- The E2E flows still pass when the Android emulator, API, and Metro are available.

## Out of scope

- Home "Today" cards, search/filter on long rosters, recent-day trend, streaks, section
  comparisons, dark mode, iOS. Half-day summary counts and recent history were deferred
  in the original pass but are delivered by the 2026-10-23 revision below.
- External premium UI kits. Use `@expo/ui` where it already fits, RN primitives, and the
  existing token/component layer. Reference libraries only if a concrete missing
  primitive justifies a separate dependency review.

## Walk record — 2026-10-22

Android emulator `emulator-5554`, dev client against API :4000 and Metro :8081.
Captures in `apps/mobile/.expo/walk/` (gitignored): `premium-mark-editing.png`,
`premium-summary.png`, `premium-summary-detail.png`, `premium-manage-3.png`,
`final-day-oct.png`, `final-day-mar.png`, `final-info2.png`, and the small-screen
set `premium-small-*.png`.

- Mark: header, day pulse, bulk actions, roster, saved/editing bar, and full-width
  save were checked at normal size. At 360×640 and 1.3× font the roster starts
  below the fold and scrolls under the pinned save bar; it remains reachable and
  has no clipped labels.
- Day sheet: month-grid height, selected footer, 48 dp rows, and the
  Half day / Holiday / weekend / Not set legend were checked for October (no
  calendar rows, so no hollow dots) and March (six rows, dots and footer visible).
- Summary: year card, status strip, visible calculation link, info sheet, and
  student sheet were checked. At 360×640 / 1.3× the student sheet scrolls; Close
  is reachable. The info sheet fits without scrolling.
- Manage: live subtitles wrap without clipping; the missing-day warning stays
  absent outside the session and is covered by `manage-summary.test.ts` for
  outside-session and partial-month cases.
- Gates: `pnpm check-types`, `pnpm lint`, mobile Jest (122 passed), and
  `pnpm e2e:android` (3/3 flows + Postgres checks, 2026-10-22). The demo fixture
  was reset and reseeded after the run.
- Intermittent emulator screenshots showed stale/duplicated glyphs (usually
  `2025-26` in place of other text); the UI hierarchy contained the correct
  strings and a cold app restart cleared it. Treat it as a frame-capture/GPU
  artifact, not a rendering bug, unless it reproduces in a fresh emulator boot.
- Dense month-grid cells are 48 dp tall and fill the available seven-column
  width; on a 360 dp screen they are narrower than 48 dp, which is the usual
  calendar-grid compromise. All non-grid controls use 48 dp floors.

## References

- Skills: `mobile-design` (design read, review checklist, visual system),
  `expo-design-system` (one token/component source of truth; avoid "everything is a card").
- Existing patterns: `@expo/ui/community/bottom-sheet` and date picker already pinned in
  `apps/mobile`; no new Expo API is introduced.
- Approved design direction: `docs/design/mobile/prototype/DIRECTION.md` (v3).
- E2E contract: `apps/mobile/e2e/flows/01-mark.yaml`–`03-manage.yaml`.

---

# Revision — owner feedback, 2026-10-23

Status: **built and verified 2026-10-23; committed locally; owner review next.** This
revision reopens two narrow backend additions that the first pass deliberately
deferred; both are read-model work, not a new domain:

1. `attendance.statusHistory` — one section's status rows for a date range, so the Mark
   screen can show a recent-day strip without N+1 calls.
2. `attendance_summary.days_half_day` — a fifth bucket so half day is counted and shown
   wherever attendance is reported. One additive migration; the generated percentage is
   unchanged (half day is not silently promoted to present).

> **Superseded in Revision 2.** The separate save progress line, the visible
> `N of M marked` count in the day pulse, the "STATUS SO FAR" label, and the long
> row meta are gone. See Revision 2 below; the backend and interaction decisions
> in this revision still stand.

## Design read

Same audience and restrained Android native direction. This pass is about **trust and
glanceability in a physical-register workflow**: an unmarked day must look unmarked, a
completed day must announce itself, and a teacher must be able to see the last few school
days without leaving the roster.

## Decisions

- **Blank is a real state.** An unmarked day starts with no statuses. Bulk controls are
  the fast path; a tap on a blank row marks present. Save is enabled only when every
  roster row has a status; the CTA's fill and `marked / roster` line track that work live.
  A partially stored day (written outside this UI) stays editable until the missing rows
  are filled rather than showing a false completion state.
- **Change wording is earned.** "Save N changes" appears only when a stored day is edited.
  A first mark of the day says "Save attendance", even when N rows are being filled.
- **Done is a card, not a bottom bar.** The saved bar is removed. A compact completion
  card above the roster announces "Attendance done", summarises the marked count, and owns
  the only Edit action. Rows are read-only until Edit is tapped.
- **Half day is never hidden.** The Day pulse includes it at zero, the status sheet gives it
  a large card, summary rows and detail sheets carry the bucket, and the year card shows
  it in the status composition.
- **The year card is coverage + composition.** Coverage percent/bar stays the hero, the
  official rate and present share are secondary tiles, and the five buckets sit inside the
  same card. "How this is calculated" becomes a 48 dp info icon.
- **Students can be re-ordered.** Roll order (default), top present share, and most absent
  are client-side sorts over the existing summary rows; no endpoint.
- **The custom month grid stays.** `react-native-ui-datepicker` is MIT, supports
  `minDate`/`maxDate` and a custom `Day`, and would meet the visual brief
  (https://github.com/farhoudshapouran/react-native-ui-datepicker, checked 2026-10-23).
  It would also add a dependency, duplicate the API-backed day-type mapping, and replace
  the `day-option-<iso>` Maestro contract. The existing grid is rebuilt instead with
  session-clamped navigation and tinted square day cells. The Expokit page is a component
  catalogue, not a versioned Expo SDK primitive, so it is not adopted.
- **Recent history is a strip, not a report.** The last five marked days appear under each
  student's name as labelled status squares (P/A/L/½/OL) with accessible dates. This
  directly mirrors the paper register; the full monthly report remains Summary's job.

## Acceptance for the revision

- An unmarked day renders no selected statuses; the save CTA is disabled until every roster
  row is marked and carries a live `marked / roster` progress fill.
- A saved, unchanged day renders the completion card and no bottom saved bar; Edit restores
  the editing affordances. A partially stored day is not treated as complete.
- Day picker cannot leave the academic session; out-of-session dates are not selectable;
  day cells use tinted squares and labels rather than 4 px dots.
- Status sheet cards are at least 72 dp tall with label + meaning; half day is present.
- Summary year card includes a 48 dp info icon, coverage, both rates, and five buckets;
  student list sorts by roll, top present share, or most absent.
- Recent strip shows the last five marked days before the selected day, with no N+1
  client calls.
- `pnpm check-types`, `pnpm lint`, mobile Jest, and `pnpm e2e:android` pass. The E2E flow
  expects the blank state, marks all present, toggles Aditi absent, saves, asserts the
  completion card, and still asserts `1 absent` in Summary.
- The demo fixture is reset/reseeded after E2E; committed locally, not pushed.

## References for the revision

- Skills: `mobile-design`, `expo-design-system`, `expo-ui` (bottom sheets).
- React Native UI Datepicker README (MIT, min/max, custom Day) — checked 2026-10-23.
- Expo SDK 57 / RN 0.86.3 / `@expo/ui` 57.0.23 pinned in `apps/mobile/package.json`.
- Decision record: `docs/DECISIONS.md` ADR-046 (half day as a marked, non-present
  bucket; bounded recent-history read).

## Walk record — 2026-10-23 (revision)

Android emulator `emulator-5554`, dev client against API :4000 and Metro :8081.
Normal walk at 1080×2400 @420 (411×914 dp); large-text walk at 1080×1920 @480
(360×640 dp) with `font_scale 1.3`. Clock pinned to Fri 6 Mar 2026 for the
attendance walk, then restored (`auto_time=1`); display size, density, and font
scale were restored to normal.

- **Mark, blank and edit.** The blank day showed no selected statuses, a
  disabled “Save attendance” CTA with `0 of 1 marked`, and the bulk controls as
  the fast path. Bulk-marking filled the CTA to `1 of 1 marked`; the first save
  used “Save attendance”. A clean saved day showed the completion card before
  the pulse and no bottom saved bar; Edit re-entered change mode, and an
  unchanged edit showed the “Done” action rather than a disabled save.
- **Status cards.** Long-press opened the five 76 dp tinted cards; all five
  labels and descriptions were present, half day included. Selecting half day
  on the saved day produced “Save 1 change” and the saved state again.
- **Day sheet.** Month navigation stayed inside the session; out-of-session
  days were disabled; cells used the 52 dp tinted square treatment with
  `½/EX/HOL/OFF`; the selected-day footer and preserved `day-option-*` IDs were
  checked. March’s six rows and the working/holiday legend fit at both sizes.
- **Recent strip.** Two earlier marked days (Wed 4 and Thu 5 Mar) produced two
  labelled status squares under Aditi on Fri 6 Mar from one
  `attendance.statusHistory` request; no per-student follow-up calls.
- **Summary.** The Year card, 48 dp info button, coverage percent/bar, official
  and present-share tiles, five buckets, sort chips (roll / top present / most
  absent), and the half-day-aware student detail sheet were checked. At
  360×640 / 1.3× the “How this is calculated” sheet fit fully, including its
  half-day note and Close. The detail sheet was checked at both sizes; at
  360×640 / 1.3× it scrolls, and scrolling exposed the half day and on-leave
  labels, the half-day note, and Close.
- **Real API/Postgres half-day walk.** Fri 6 Mar was changed from absent to
  half day through the status sheet, and Thu 5 / Wed 4 Mar were marked present.
  Summary returned 3 marked days, 2 present, 1 half day, official rate 0.7%,
  present share 66.7%; direct SQL confirmed the half-day bucket. This was on
  the disposable walk fixture, later reset.
- **Large-text findings, fixed.** At 360×640 / 1.3× the five pulse buckets
  collided (“Half day” / “On leave”), the completion card fell under the tab
  bar, the blank CTA still said “Mark a student to save”, the header context
  truncated “1 student”, and the Summary “Status so far” strip broke “Present”
  mid-word (`Presen` / `t`). The pulse and Summary strip now wrap 3 + 2 at
  `fontScale >= 1.2`, the completion card renders before the pulse, the CTA
  always uses “Save attendance” until a stored day is edited, and the context
  line may use two lines. Reference 360×640 frames after these fixes are
  `apps/mobile/.expo/walk/rev-small-done-clean.png` (clean) and
  `rev-small-summary-fixed-scroll.png` (confirms the 3 + 2 Summary strip;
  affected by the known ghosting artifact), plus the clean
  `rev-small-info.png` (gitignored).
- **Gates and E2E.** `pnpm check-types`, `pnpm lint`, mobile Jest 14 suites /
  137 tests, and `pnpm e2e:android` 3/3 with all Postgres checks passed after
  the final UI changes (2026-10-23). E2E re-ran the blank state, now asserts
  “Save attendance”, `0 of 1 marked`, and `1 of 1 marked`, then bulk present,
  Aditi absent, progress save, completion card, `1 absent`, `Half day`, and
  `Most absent`; the demo fixture was reset and reseeded afterward
  (`pnpm reset:demo -- --yes`, `pnpm db:seed`).
- **Emulator artifact.** Screenshots again intermittently showed stale glyphs
  (often `2025-26` in place of other strings) and once a stale system dialog;
  the UI hierarchy and Maestro assertions contained the correct text, and a
  clean frame was obtained after a tab switch. Treated as the known
  frame-capture/GPU artifact, not an app regression.

---

# Revision 2 — owner UI feedback, 2026-10-23

Status: **built, gate-green, phone-walked at normal and 360×640 / 1.3×, and E2E-green; committed locally; owner review next.**
This pass refines the screens from Revision 1. It adds no endpoint, migration,
schema, or permission; it reuses ADR-046's bounded `attendance.statusHistory` and
the existing `attendance.summary` half-day bucket.

## Decisions

- **Save is the progress indicator.** The separate save track/count is gone. The
  CTA is a ghost outline at 0 and fills with accent as rows are marked; its label
  stays `Save attendance` (or `Save N changes` on a stored-day edit). The exact
  `N of M marked` count is now accessibility-only, and the day pulse no longer
  prints a second progress count. Strict completion is unchanged: the button stays
  disabled until every roster row has a status.
- **Status is a tile, not a pill.** Each roster row carries a 48 dp full-height
  tinted tile with `P/A/½/L/OL` and `–` for unmarked, spanning both text rows. The
  row's accessibility label still names the full status.
- **Marked days are visible before opening a day.** The day sheet reads one month
  of `statusHistory` alongside `calendar.list`, draws a green dot on marked session
  days, adds a red dotted border to past markable days with no mark, and mutes
  `OFF/HOL` text. Its legend names `Marked` and `Past, not marked`.
- **Summary is composition, not a second dashboard.** The five status totals are
  light tinted cards inside the Year card; the `STATUS SO FAR` label is removed.
  Student rows use compact non-zero keys (`2P 1A 1L 1H 1OL`; `0P` when empty) while
  their accessibility label keeps full words. The detail sheet adds a month-by-month
  student map from the same bounded read. Its breakdown is labelled `Status mix`,
  so it does not repeat the coverage label `Days marked`.
- **Half day semantics are unchanged.** Half day remains a marked day in the
  present-share denominator and never becomes official present (ADR-046). Recent
  history, stored-day change detection, sorting, and read-only permission behavior
  are untouched.

## Acceptance

- Blank day: ghost save CTA, every row showing `–`, and no separate visible
  `N of M marked`.
- Bulk-marked day: the fill reaches 100%, one tap toggles a row, and Save is enabled
  only when the roster is complete. A stored day still says `Save N changes`.
- Day sheet: marked dot, red dotted past-unmarked session days, reduced-opacity
  `OFF/HOL`, and at most one month of `statusHistory` per request.
- Summary: tinted bucket cards, no `STATUS SO FAR`, compact non-zero row keys, and
  a detail map with loading, error, empty, and session-clamped month navigation.
- Gates: `pnpm check-types`, `pnpm test`, `pnpm lint`, and `pnpm db:verify` green;
  mobile Jest 15 suites / 141 tests.
- Bottom sheets stay on the light surface when the device is in dark system mode.
- The normal-scale and 360×640 / 1.3× phone walks and captures are complete on the
  physical SM-F415F.
- E2E is green on the host SDK emulator (`emulator-5554`, API 34, WHPX): `pnpm
  e2e:android` passed 3/3 flows and all four Postgres checks, artifact
  `apps/mobile/.expo/e2e/2026-10-23T06-58-23-828Z`. The run found and prompted a fix
  for a real policy success-state race: `policy-saved` was owned by the body keyed on
  `updatedAt`, so the post-save query invalidation remounted it and dropped the
  confirmation. The state now lives in `ManagePolicy`, keyed by the active context,
  and survives the refetch.
- The demo fixture was reset and reseeded after E2E; committed locally, not pushed.

## Walk record — 2026-10-23 (revision 2)

- **Device fallback.** The host emulator still cannot boot (`emulator -accel-check`
  reports `Please disable Hyper-V`; software TCG crashes at
  `setDisplayActiveConfig`). Used the attached physical Samsung SM-F415F
  (`RZ8R40Z9VML`, Android 12 / SDK 31, 1080×2340 @420) instead. Dev client
  `com.mskool.app` against Metro :8081 and the API on :4000 over USB tethering.
- **Login path.** The existing dev bundle still inlined the stale
  `EXPO_PUBLIC_API_URL=http://192.168.0.101:4000`, which the phone could not route.
  Updated the ignored `apps/mobile/.env.local` to the host's USB-tether address
  (`10.217.72.174:4000`), restarted Metro with a cleared cache, and reloaded the dev
  client. `teacher@demo-trust.test` signed in successfully.
- **Mark, blank, and save.** At normal scale, selected Fri 6 Mar 2026 from the
  session-bounded day picker (phone date left at 23 Oct 2026; no clock change). The
  saved day showed the completion card and a single full-height `P` tile. Thu 5 Mar
  rendered blank with a `–` tile, Save disabled, and no visible `N of M marked`;
  tapping the row produced a full accent CTA whose accessibility label read
  `Save attendance. 1 of 1 marked`. The unsaved 5 Mar draft was discarded by moving
  to 13 Mar; no write was submitted.
- **Day sheet.** March 2026 showed green marked dots, red dotted borders on past
  unmarked session days, muted `OFF` Sundays and `½` Saturdays, and the
  `Marked` / `Past, not marked` legend. The footer resolved the selected day
  correctly.
- **Summary and detail map.** Summary showed `6 of 311 working days marked`,
  `1.9%`, official `0.6%`, present share `33.3%`, five light tinted status cards,
  and the compact `2P 1A 1L 1H 1OL` row meta. The student sheet mapped March 2026
  (`P/A/L/½/OL`) and labelled the breakdown `STATUS MIX`; values were 2 present,
  1 absent, 1 late, 1 half day, 1 on leave.
- **Recent history.** Fri 13 Mar (`OL`) showed the `Last 5 marked days` strip
  `P A P L ½` from the bounded `attendance.statusHistory` read.
- **Compact / large-text walk.** Temporarily set the phone to 360×640 @160 and
  `font_scale 1.3`, walked the same screens, then restored 1080×2340 @420 and
  `font_scale 0.8`. Found and fixed three small-screen issues: the home class-card
  status line clipped at one line (now wraps to two); day-sheet cells computed to
  43 dp and the last legend row was unreachable (now a compact 4 dp gutter, 2 dp
  gaps, 48 dp square cells and a bounded 92%-height scroll view, so the full
  `Marked` / `Past, not marked` legend scrolls into view); and the sheet is now a
  single scrollable surface. Summary cards, sort chips, student row meta, the
  detail map, `Status mix`, and its explanatory note all wrap and scroll without
  clipping.
- **Dark-mode sheet finding, fixed.** The phone's system theme is dark, and the
  community bottom sheet defaulted to a dark surface while the app's light-only
  content kept dark ink. All seven attendance sheets now pass
  `backgroundStyle: colors.surface` and a `grabber` handle colour; the day picker
  and student detail were rechecked white and readable.
- **Gates.** Root `check-types`, `test` (mobile 15 suites / 141 tests), `lint`, and
  the earlier `db:verify` all pass. The API/Postgres read check still matches the UI:
  March `statusHistory` returned six rows across all five statuses, and
  `attendance.summary` returned `daysHalfDay: 1` with the official rate at 0.64%.
- **E2E green.** The host SDK emulator (`emulator-5554`, API 34, WHPX) booted with
  `-accel auto`; the PATH `tools\emulator.exe` was bypassed because it falsely reports
  Hyper-V as blocking. With the ignored `apps/mobile/.env.local` API URL set to
  `http://10.0.2.2:4000`, `pnpm e2e:android` passed 3/3 flows in 5m 13s and all four
  Postgres checks (Aditi absent on Fri 6 Mar; 7 Mar holiday; policy daily/20-minute late
  window; `Period 1`). Artifact:
  `apps/mobile/.expo/e2e/2026-10-23T06-58-23-828Z`. Flow 01 now asserts the full
  accessibility labels (`Save attendance. 0 of 1 marked` and `1 of 1 marked`). Flow 03
  exposed a real success-state race: the post-save invalidation remounted the
  `updatedAt`-keyed policy body and dropped `policy-saved`; success state now lives in
  `ManagePolicy` and survives the refetch. The runner also gives the late Expo
  dev-client onboarding 15 seconds to appear and be dismissed before Maestro starts.
- **Captures.** `apps/mobile/.expo/walk/rev2-phone-*.png` (gitignored): marked-day,
  blank-day, complete/save, day-sheet, summary, student-map, recent-history, and
  the 360×640 / 1.3× home, day-sheet, summary, and student-map frames.
