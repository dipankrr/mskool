# Mobile attendance chunk 3 — management surfaces (calendar, policy, periods)

Follow-on to `.kilo/plans/2026-10-18-mobile-attendance-summary.md` (chunk 2, walked
2026-10-19). Same domain, the remaining `attendance.*` configuration endpoints from
`docs/MOBILE_PLAN.md` §8: calendar generate / single-day overrides, marking-policy
upsert, periods list/create/update.

Owner go: chunk 3 picked 2026-10-19. Entry point confirmed by the owner 2026-10-20:
**gear on the Attendance header** (not the More tab).

## 1. Persona, role/permission, context

- **Principal / vice-principal** (`attendance:read` + `attendance:update`, school
  scope): the configuring personas. Calendar generation, holidays/exam days, the
  marking policy, and (period-wise schools) periods.
- **Class teacher** (holds `attendance:update` in the default matrix): sees the
  entries (the hint set is flat — `me.get` carries no scope depth). Her scope
  reaches her section's periods but **not the school node**, so calendar/policy
  writes are refused server-side; the refusal is shown honestly. Walk check, not
  hardcoded around (owner rule: role permissions are dynamic).
- **Subject teacher** (no `attendance:update`): no gear; nothing changes.
- Context: active branch + current session year (`useActiveContext`), current
  section carried from the attendance screen, `schoolId` from active context.
- Moment of use: office/quiet moment — "the year's calendar needs generating",
  "Diwali must be a holiday", "my late window is wrong", "we're switching to
  period-wise".

## 2. Measurable outcome

1. **Generate is idempotent and honest**: re-running on a complete year reports
   "every day already had a row"; on a year with a missing date it fills exactly
   that date (server count = UI copy) and the month list shows it.
2. **Day override end-to-end**: set a date to Holiday with a reason → the calendar
   row re-renders; the marking screen's day gate reflects it without an app
   restart; setting it back restores the gate.
3. **Policy persists**: change a field → save → reopen shows the saved values; a
   mode switch moves the marking panel's hint (queried data, no restart); clearing
   the threshold under the homeroom rule persists `null`.
4. **Periods round-trip**: create for the current section → list ordered by
   sequence; edit name/time/homeroom → reflected; a duplicate sequence shows the
   translated server message inline.
5. **Every screen states**: loading / empty / error + retry / submitting / success /
   offline / denial. Success is shown only after the server confirms.
6. **Hint renders, server decides**: rendering gated by `attendance:update`; scope
   refusals surface the server's translated message (nothing silent).

## 3. Entry-to-done journeys and wireflows

```
Attendance (existing)               Manage attendance (new hub)          Calendar (new)
┌───────────────────────────┐  tap  ┌───────────────────────────┐  tap  ┌───────────────────────────┐
│ Class 6 · A       ⌄   ⚙ │──────▶│ Manage attendance         │──────▶│ Calendar           2025-26│
│ [ Mark | Summary ]        │       │ 2025-26 · Greenfield …    │       │ ‹ March 2026 › [Generate] │
│ …                         │       │ Calendar  Generate days…  │       │ Mon 2 Mar       Working   │
└───────────────────────────┘       │ Policy    Daily marking…  │       │ Sat 7 Mar       Half day  │
  ⚙ only with attendance:update     │ Periods   No periods yet… │       │ Sun 8 Mar       Weekend   │
                                    └───────────────────────────┘       └───────────────────────────┘
                                                                          tap a day → Day editor sheet
                                                                          [Generate] → weekday sheet
```

```
Policy (new)                              Periods (new)                    Period editor (new)
Daily | Period-wise  (segments)           Class 6 · A · 2025-26            Name / Sequence /
  └ Period-wise → Homeroom | Threshold      #1 Period 1  08:00–08:45        Start / End (time fields) /
      └ Threshold → XX %                    #2 Period 2  09:00–09:45        Homeroom switch
Late arrival window: 15 min               [+ Add period] → editor          [Save period]
[Save policy] → saved state
caution: period-wise without periods → Add periods ──▶ Periods
```

## 4. Screen list with hierarchy and realistic sample content

1. **Attendance (existing)** — the title row gains a right-aligned gear button
   when `has("attendance:update")` (`testID="attendance-manage-entry"`, a11y label
   "Manage attendance"). Nothing else changes.
2. **Manage attendance (hub, new)** — pushed on the attendance tab's own Stack.
   Back row + title; context line `2025-26 · <branch>`. Rows:
   - **Calendar** — `Generate the year, set holidays and exam days`.
   - **Marking policy** — live subtitle: `Daily marking` /
     `Period-wise · Homeroom decides` / `Period-wise · threshold 80%` /
     `Not set — defaults apply`.
   - **Periods** — live subtitle from `attendance.period.list`:
     `6 periods · Class 6 · A` / `No periods yet · Class 6 · A`.
   Subtitle query errors degrade to static copy (never block the rows).
3. **Calendar (new)** — month stepper `‹ March 2026 ›`, clamped to the session
   year's months; day rows (the day-sheet row anatomy, reused): weekday + date,
   type tag in the existing `statusTone` map (`Working`, `Half day`, `Exam day`,
   `Holiday`, `Weekend`, `Not set`), reason on a second line when present.
   `[Generate calendar]` primary action. A month with no rows shows the inline
   line `No days set for this month — generate the calendar.`
4. **Day editor (sheet)** — date title; five type options in order Working /
   Holiday / Half day / Exam day / Weekend, each with a one-line meaning; the
   current type checked. Reason field **prefilled** from the row, placeholder
   `Optional — "Diwali", "Sports day"…`, help `Shown wherever this day is read.
   Clear it to remove the note.` Save → `attendance.calendar.upsert`.
   **Divergence from web, recorded:** web leaves blank = keep-existing; mobile
   prefills and treats empty as **clear** (sends `reason: null`). Rationale:
   WYSIWYG, and the walk needs a restore path.
5. **Generate calendar (sheet)** — year title; help `Pick the days a week school
   is in session. Days already set are left untouched — this only fills gaps.`
   Seven rows Mon–Sun with a 3-state cycle chip **Working → Half day → Off**;
   defaults Mon–Fri Working (web parity); `halfDayWeekdays` derived as the subset
   automatically (schema refine); submit disabled with 0 working days + inline
   `At least one working day a week.` Result state with the server count:
   `12 days filled in` / `Every day already had a row — nothing to add.`
6. **Marking policy (new)** — when no row: status card `Not set yet — the server
   defaults apply (daily · homeroom decides · 15 min)`. **Marking mode** segment
   `Daily` | `Period-wise`; when Period-wise → **Daily status rule** segment
   `Homeroom decides` | `Threshold`; when Threshold → **Threshold %** numeric
   (1–100). **Late arrival window** numeric minutes (0–120, default 15) + help
   from the schema comment ("a mark after this many minutes past the period start
   reads as late; the marker sees the window"). Caution card when Period-wise is
   selected and the current section has no periods, with `Add periods` → Periods.
   Save → `attendance.policy.upsert`.
7. **Periods (new)** — sub-line `Class 6 · A · 2025-26`. When the policy is
   daily: explainer `This school marks daily — periods matter when it switches to
   period-wise marking.` Rows: `#1 Period 1 · 08:00–08:45 · Homeroom` (Homeroom
   as a tag; times omitted → `No times set`). Empty state `No periods yet` with
   `Add period`. `[Add period]` button.
8. **Period editor (new, pushed screen)** — create (defaults: name `Period N`,
   next sequence) or edit by id (row data; `byId` only if the row is missing).
   Fields: Name (1–50), Sequence (1–30), Start / End time (native time field —
   `@expo/ui` DateTimePicker; clearable), Homeroom switch. Save →
   `attendance.period.create` / `.update`. Subject/teacher are **not** editable
   yet (no mobile pickers — deferred, recorded).
9. **States** — shared handling per §5; every data screen gets skeletons →
   content, ErrorCard + Retry, server-confirmed success.

## 5. State / recovery table

| State | Behavior |
|---|---|
| Loading (hub / calendar / policy / periods) | Skeletons; hub rows visible with static subtitles |
| Fetch error | ErrorCard + Retry per screen; hub rows fall back to static subtitles but stay open |
| Month with no rows | Inline prompt line; empty list (not an error) |
| Generate running | Sheet stays open; submit disabled + spinner |
| Generate idempotent | `Every day already had a row — nothing to add.` (a result, not an error) |
| Day save pending / failed | Save disabled while pending; failure keeps the sheet + inline error (draft kept) |
| Day save success | Sheet dismisses; `attendance.calendar.list` invalidated (marking panel shares the key prefix) |
| Policy not set | `Not set yet — defaults apply` card; Save creates the row |
| Policy validation | Inline field errors (threshold required for Threshold; bounds mirrored client-side, re-checked server-side) |
| Threshold under homeroom rule | Sent as `thresholdPercentage: null` (persists null) |
| Period sequence collision | Server's translated message inline; draft kept |
| Period time invalid | Client blocks (`HH:MM`, end > start); server re-checks |
| Offline | Mutations fail with the standard error copy; Retry only; no queueing (ADR-043) |
| Denied (no `attendance:update`) | Gear hidden; direct navigation shows an honest no-access empty state |
| Refusal (hint held, scope short) | Server message surfaced (ErrorCard / inline); walk-verified with the class-teacher persona |
| Stale `sectionId` param | Chunk-2 rule: falls back to the first visible section |

## 6. Procedure-to-screen mapping

| Procedure | Used by |
|---|---|
| `attendance.calendar.generate` | Generate sheet submit |
| `attendance.calendar.upsert` | Day editor save |
| `attendance.calendar.list` | Calendar month list (existing key; invalidated after both writes) |
| `attendance.policy.get` | Policy screen load; hub subtitle |
| `attendance.policy.upsert` | Policy save |
| `attendance.period.list` | Periods list; hub subtitle; policy caution |
| `attendance.period.create` / `.update` | Period editor save |
| `attendance.period.byId` | Period editor fallback when the list row is absent (decide at implementation) |
| `academic.section.list` | Section label + the section's `academicYearId` for create |

No new endpoints. No runtime `@repo/contracts` import; row types inferred from the
tRPC client.

## 7. Keyboard, back/dismiss, safe-area, accessibility, platforms

- Gear: `accessibilityRole="button"`, label `Manage attendance`, ≥44 pt.
- The attendance tab gains its own Stack (`_layout.tsx`, `headerShown: false`);
  pushed screens draw their own back row; hardware back pops; the floating tab bar
  stays — screens pad with `useTabBarSpace()`.
- Sheets: backdrop / swipe / hardware-back dismiss (existing
  `@expo/ui/community/bottom-sheet` pattern); inputs keyboard-safe.
- Day options and generate rows announce state (`Working, selected` /
  `Monday, Working. Double tap to change.`); option rows ≥44 pt.
- Numeric fields: `keyboardType="number-pad"`; error text inline and tied to the
  field.
- Time fields: label + value announced (`Starts, 08:00` / `Starts, not set`).
- Long values: titles `numberOfLines={1}`; reasoning lines `numberOfLines={2}`.
- Android walk now; iOS (DateTimePicker inline presentation, form sheets) at the
  Mac gate — see §12.

## 8. Layout widths / device targets

Phone only, 360–430 dp; emulator-5554 (1080×2400 @ 420 dpi) is the reference.
Calendar list is a `FlatList` (≤31 rows/month). The periods list is small (plain
map acceptable). Management screens are `ScrollView`s with bottom padding =
tab bar + safe area.

## 9. Manual / device verification steps (Android emulator, dev build)

Preconditions: API :4000 + Metro :8081 up; device clock pinned inside AY 2025-26
(e.g. 2026-03-06, `auto_time` restored after); principal persona signed in.

**Walk-prep SQL (gap-fill proof):** delete one unmarked calendar row —
`2025-06-15` (type `weekend`) — so generate has something real to fill; the
restore is re-running generate (the row returns as `weekend`).

1. Attendance tab → gear visible (principal). Tap → Manage hub; rows + live
   subtitles (policy `Daily marking`; periods `No periods yet · Class 6 · A`).
2. Hub → Calendar; month = the clock month; rows match the DB day types (Mon–Sat
   working, Saturday half day; holidays absent in March); the stepper clamps to
   session months; day-row a11y labels.
3. Day override: tap an unmarked working day → Holiday + reason `Walk holiday` →
   the row updates in place; the marking screen's day sheet shows Holiday and the
   gate refuses marking; restore to Working with the reason cleared (sends null).
4. Generate: re-run on the complete year → `Every day already had a row —
   nothing to add.` (idempotent proof). Gap-fill proof: the deleted `2025-06-15`
   → run generate → `1 day filled in`; June list shows it back as Weekend; DB row
   verified.
5. Policy: values match the seed (Daily · homeroom · 15); change late window to
   20 → save → reopen shows 20 (then restore 15); switch to Period-wise +
   Threshold 80 → the caution shows (6-A has no periods); the marking screen
   reflects period-wise (chips absent — restored in step 7).
6. Periods: create `Period 1` (08:00–08:45, homeroom on) + `Period 2`
   (09:00–09:45); list order + tags; edit Period 2's name/time; a second Period 1
   attempt shows the translated collision message; the policy caution clears.
7. Restore demo state: policy back to Daily · homeroom · 15; SQL-delete the two
   walk-created periods (verified by id/name — walk rows only); the marking
   screen is back to daily (no chips); the edited calendar day restored.
8. Denial / refusal: a persona without `attendance:update` → gear absent. Class
   teacher → gear visible; day override + policy save show the server's refusal
   copy (record exact words); her own section's periods behave per her real scope
   (record reality).
9. Offline: stop the API → save attempts show error + Retry, no success shown;
   restart the API → Retry succeeds.
10. TalkBack pass: gear, hub rows, day options, generate cycle rows, policy
    segments/fields, period rows + editor.
11. Kill + reopen → states resolve honestly (no stale section; policy/periods
    refetch).
12. Screenshots `w200+` into `apps/mobile/.expo/walk/` (gitignored); walk record
    into this plan + `docs/TASKS.md`; `docs/MOBILE_PLAN.md` §8 rows and the §6
    table updated after the walk.

## 10. Affected route-ledger rows and definition of complete

- §8 `calendar list / generate / days (3)` — list walked 2026-10-18; generate/days
  close with this walk.
- §8 `policy get / upsert (2)` — upsert closes; re-check the ledger's
  "disabled for class_teacher" note against reality during the walk.
- §8 `period list / byId / create / update (4)` — all open → close (byId only if
  the editor consumes it).
- §6 table row (`/attendance/calendar`, `/attendance/policy`): update to
  "management surfaces live (walked 2026-10-2x)".
- Definition of complete: the MOBILE_PLAN definition — native interaction, real
  API data, states + recovery, server enforcement, accessible controls, reviewed
  device walk. Ledger rows touched only after the walk.

## 11. Implementation reference register

Versions unchanged from Part B §11 / chunk 2 (Expo SDK ~57.0.28 · RN 0.86.3 ·
React 19.2.3 · expo-router ~57.0.26 · @expo/ui ~57.0.23 · TanStack Query 5.101.2 ·
tRPC 11.18.0 · zod ^4.4.3 · TypeScript ~6.0.3).

Skills read for this chunk: `expo-router` (folder route + Stack per tab, push
navigation, thin route files) and `expo-data-fetching` (four-state screens;
mutations disable repeat submit, keep drafts on error, invalidate on success).
`expo-ui` to be read at the time-field step if `@expo/ui` components beyond the
installed DateTimePicker get used.

Docs verified against the pinned packages: `@expo/ui` community `DateTimePicker`
(`mode: 'time'`, Android `presentation: 'dialog'` default, `is24Hour`; iOS inline)
— read from the installed types
(`apps/mobile/node_modules/@expo/ui/build/community/datetime-picker/types.d.ts`).
Expo Router Stack-inside-tab wiring re-verified against the installed version
before wiring (proof plan §12.1).

Web semantics reference (behavior parity, not UI):
`apps/web/src/app/(dashboard)/attendance/calendar/page.tsx` (+ colocated dialogs:
weekday template 3-state cycle, Mon–Fri defaults, toast counts, blank-keeps
reason) and `.../attendance/policy/page.tsx` (four fields, defaults notice).

API/semantics reference: `packages/trpc/src/routers/attendance.router.ts` (gate
choices: `attendance:update` gates all configuration; B5/B6 shapes),
`packages/contracts/src/contracts/attendance.contract.ts` (schemas),
`packages/db/src/schema/attendance.ts` (columns, defaults, unique indexes),
`apps/api/scripts/seed.ts` (demo policy/calendar facts: daily · homeroom · 15;
Mon–Sat with Saturday half day; holidays 2025-08-15, 2025-10-02; no periods).

Files (planned):
- routes: `app/(staff)/(tabs)/attendance/{_layout.tsx,index.tsx}` and
  `.../attendance/manage/{index,calendar,policy,periods,period-edit}.tsx`
  (the current `attendance.tsx` moves to the folder and is deleted)
- screens: `screens/staff-attendance/index.tsx` (gear),
  `screens/staff-attendance/manage/` — `hub.tsx`, `calendar-panel.tsx`,
  `day-editor-sheet.tsx`, `generate-sheet.tsx`, `template.ts` (+ test),
  `policy-panel.tsx`, `policy-form.ts` (+ test), `periods-panel.tsx`,
  `period-edit-panel.tsx`, `period-form.ts` (+ test), `time-field.tsx`
- `components/app-icon.tsx` (settings icon), `lib/copy.ts` (manage strings)
- shared month helper: reuse the day-sheet's; extract only if the shapes do not
  converge.

## 12. Proof plan for uncertain native behavior

1. **Stack inside the tab with the custom floating TabBar** — verify pushed
   screens keep the bar, pad correctly, hardware back pops, and no route warnings
   appear after the folder restructure (walk step 1). Fallback: push over the
   tabs (sibling routes) if the interaction misbehaves.
2. **`@expo/ui` DateTimePicker time mode on Android** — dialog presents on mount,
   `onValueChange` / `onDismiss` fire, `is24Hour` renders 24-hour (walk step 6).
   Fallback: an in-sheet `HH:MM` pair of numeric inputs.
3. **Sheet → screen navigation** — the day editor and generate sheets never
   navigate; the policy caution's `Add periods` pushes after dismissing (walk
   step 5).
4. **Invalidation reach** — `attendance.calendar.list` invalidation refreshes both
   the manage month and the marking panel's month (same key prefix) (walk step 3).
5. **Live subtitles freshness** — hub reads policy + periods; a save elsewhere
   must not leave a stale subtitle on refocus (walk steps 5→1).
6. **Numeric keyboards** — `number-pad` input cannot produce decimals/negatives;
   validation errors read cleanly (walk steps 5/6).

## Open questions (recorded, not silent)

1. **Subject/teacher pickers on periods** are deferred — the API supports both,
   but no mobile data wiring exists yet; revisit with the directory slices.
2. **Reason semantics divergence** — mobile prefills and clears on empty vs the
   web's blank-keeps; confirm at review.
3. **Generate defaults** are fixed Mon–Fri (web parity), not derived from the
   existing calendar; deriving needs a year-wide fetch — confirm.
4. **"Generate calendar" single label** (web swaps to "Fill missing days" when the
   year has rows); a cheap gap count needs a year-wide fetch — revisit if wanted.
5. **Class-teacher refusal UX** — walked: the gear is visible and the server
   refuses school-level day/policy writes with “You don't have permission to do
   this. Ask your administrator.” (w288/w291); section-scoped period create
   succeeds. Confirm the refusal reads acceptably, or hide school-level rows
   (needs a scope signal `me.get` does not carry today).
6. **Period editor as a pushed screen** vs sheet — pushed chosen for keyboard
   safety; confirmed on device (keyboard dismissal reflows the Save button, so the
   walk taps it after dumping bounds).
7. **Daily-mode residue** — a Daily save does not null a previously set
   `daily_status_rule`/`threshold_percentage`. Semantically inert; decide whether
   the form should clear them.
8. **Periods have no delete** — `period.list/byId/create/update` only; v1 has no
   delete affordance and walk rows were removed by SQL. Revisit with the timetable
   slice.

## Commit plan (owner commits; agent never commits or pushes)

**Chunk 2 is still uncommitted.** Its plan
(`2026-10-18-mobile-attendance-summary.md`) lists A summaries+switcher,
B session purge, C optional web textarea. Three files below also carry chunk-2
edits (`screens/staff-attendance/index.tsx`, `lib/copy.ts`, plus
`docs/MOBILE_PLAN.md` / `docs/TASKS.md`); committing chunk 2 whole first folds
those chunk-3 hunks into it. Either accept that, or stage the shared files with
`git add -p` (the gear in `index.tsx`, the `manage` strings in `copy.ts`, the
§6/§8 rows below).

**Also shared:** `apps/mobile/src/screens/staff-attendance/use-attendance-section.ts`
(chunk-3 extraction, imported by the chunk-2 shell). If chunk 2 A stages
`index.tsx` whole, stage the hook and `apps/mobile/src/components/app-icon.tsx`
(the settings glyph) with it; otherwise both belong to 3 A.

Owner files not part of any commit: `apps/api/src/env.ts`,
`apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/trpc/client.ts`,
`rough.md`, `skills-lock.json`, `.zcodeignore`, `packages/db/query-tmp.mjs`.

**A — feat(mobile): attendance management hub, calendar, generate + day
overrides**

Files:
- `apps/mobile/src/app/(staff)/(tabs)/attendance.tsx` (D)
- `apps/mobile/src/app/(staff)/(tabs)/attendance/_layout.tsx` (A)
- `apps/mobile/src/app/(staff)/(tabs)/attendance/index.tsx` (A)
- `apps/mobile/src/app/(staff)/(tabs)/attendance/manage/index.tsx` (A)
- `apps/mobile/src/app/(staff)/(tabs)/attendance/manage/calendar.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/index.tsx` (M — gear; shared)
- `apps/mobile/src/screens/staff-attendance/use-attendance-section.ts` (A — chunk-3 extraction; stage here unless already in 2 A)
- `apps/mobile/src/screens/staff-attendance/manage/frame.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/hub.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/calendar-panel.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/day-editor-sheet.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/generate-sheet.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/template.ts` + `.test.ts` (A)
- `apps/mobile/src/screens/staff-attendance/manage/field.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/time-field.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/calendar-month.ts` + `.test.ts` (A)
- `apps/mobile/src/screens/staff-attendance/day-sheet.tsx` (M — shared helper)
- `apps/mobile/src/screens/staff-attendance/status-meta.ts` (M — day-type labels)
- `apps/mobile/src/components/app-icon.tsx` (M — settings icon)
- `apps/mobile/src/lib/copy.ts` (M — manage strings; shared)

Message:

```
feat(mobile): attendance management hub, calendar, generate + day overrides

Gear on the Attendance header (gated on attendance:update) opens a Manage hub:
Calendar, Marking policy, Periods, each with a live subtitle. The attendance
tab moves into its own Stack so pushed management screens keep the floating
bar and hardware back pops them.

Calendar lists the session month (stepper clamped to the academic year) with
day rows and a11y labels; the day sheet edits type + reason (empty reason
sends null); Generate fills only missing days from the Mon-Fri template,
cycling Working -> Half day -> Off, and reports the server's `generated` count.

Walk 2026-10-19/20 (Android): month rows match the DB, day override updates in
place, holiday gate refuses marking, generate reports "1 day filled in" then
"Every day already had a row", stepper clamps at Apr 2025 / Mar 2026.
```

**B — feat(mobile): attendance marking policy**

Files:
- `apps/mobile/src/app/(staff)/(tabs)/attendance/manage/policy.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/policy-panel.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/policy-form.ts` + `.test.ts` (A)

Message:

```
feat(mobile): attendance marking policy screen

Mode segments (Daily / Period-wise), conditional day rule + threshold, late
window. Daily hides the rule; choosing Homeroom clears the threshold. A
period-wise section with no periods warns and pushes Add periods; the hub
subtitle reflects the saved mode/rule live.
```

**C — feat(mobile): attendance periods list + editor**

Files:
- `apps/mobile/src/app/(staff)/(tabs)/attendance/manage/periods.tsx` (A)
- `apps/mobile/src/app/(staff)/(tabs)/attendance/manage/period-edit.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/periods-panel.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/period-edit-panel.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/manage/period-form.ts` + `.test.ts` (A)

Message:

```
feat(mobile): attendance periods list + editor

Section periods in sequence order with time range and Homeroom tag; create and
edit run through the pushed period screen (name, sequence 1-30, start/end via
native time pickers, homeroom switch). Sequence collisions surface the generic
CONFLICT copy; nothing is written on failure.
```

**D — fix(mobile): honest server-state transport (no cached GETs, no paused
offline)**

Files:
- `apps/api/src/server.ts` (M — `/trpc` `Cache-Control: no-store`)
- `apps/mobile/src/lib/trpc.tsx` (M — no-store request header)
- `apps/mobile/src/lib/query.ts` (M — `networkMode: "always"`)
- `apps/mobile/src/app/index.tsx` (M — `me.get` error gate)
- `docs/DECISIONS.md` (M — ADR-045)

Message:

```
fix(mobile): honest server-state transport (no cached GETs, no paused offline)

The native HTTP cache replayed tRPC GETs, so a mutation's invalidation refetched
the old body without reaching the API. /trpc responses now send
Cache-Control: no-store (API) and the mobile link sends cache-control: no-store.

Offline queries/mutations no longer pause: networkMode "always" fails them into
the screens' connection copy + Retry, and writes change nothing. A failed
me.get now shows an error + Retry instead of misclassifying staff as a family
login. ADR-045.
```

**E — docs: mobile attendance management walk record + ledger**

Files:
- `docs/MOBILE_PLAN.md` (M — §6 + §8 rows; shared)
- `docs/TASKS.md` (M — resume-here; shared)
- `.kilo/plans/2026-10-20-mobile-attendance-management.md` (A)

Note: `docs/MOBILE_PLAN.md` and `docs/TASKS.md` also contain the E2E paragraph
added 2026-10-20. Commit them once here, whole; the E2E commit does not touch
docs. (Splitting the E2E paragraph out needs `git add -p`.)

Message:

```
docs: mobile attendance management walk record + ledger

§6/§8 rows for calendar/policy/periods closed with the 2026-10-19/20 device
walk; TASKS resume-here points at the next slice.
```

## Walk record

**Device / persona.** Android AVD `mskool-dev` (1080×2400), Expo dev client,
Metro :8081, API :4000. Main pass was signed in as **Demo Org Admin**
(`admin@demo-trust.test`, org-scoped) — the tree already had admin signed in, not
the principal this section names; no functional difference for these screens
(admin is a superset), recorded for honesty. Step-8 personas:
`teacher@demo-trust.test` (class_teacher, Class 6) and
`subject-teacher@demo-trust.test` (subject_teacher, 6-A). Clock pinned to
Fri 6 Mar 2026 for the pass; `auto_time` / `auto_time_zone` restored afterwards
(Tue 20 Oct 2026 05:01 IST). Captures `w200`–`w349` in
`apps/mobile/.expo/walk/` (gitignored).

**Steps.**

1. Gear → hub (w204/w285): rows + live subtitles (`Daily marking`,
   `No periods yet · Class 6 · A`; `2 periods · …` after creates). The tab-level
   Stack keeps the floating bar; hardware back pops each screen.
2. Calendar (w205/w213/w214): March 2026 rows match the DB (Mon–Sat working,
   Saturday half day); Next clamps at March 2026 (AY end) and Previous clamps at
   April 2025 (AY start) — w320/w321.
3. Day override (w206/w230/w234): sheet prefilled from the row; Holiday + reason
   saved and the row updated **in place**; the marking screen refused the holiday
   with “This day cannot be marked — Fri 6 Mar is a holiday — attendance cannot
   be marked on a holiday.” (w229); restored to Working with the reason cleared
   (sends null) — DB `updated_at` 22:49:23.
4. Generate (w235/w236/w239/w240/w241): gap-fill `1 day filled in.` for the
   deleted `2025-06-15`; the June 2025 list shows `Sun 15 Jun, Weekend`; a second
   run returns `Every day already had a row — nothing to add.`
5. Policy (w245–w252/w278/w279/w298–w301): seed values read Daily · homeroom ·
   15; late window 20 saved and persisted across a reopen; Period-wise + Threshold
   80 shows the caution “Period-wise marking needs Class 6 · A's periods — add
   them before the first marking.”; the marking screen dropped the chips; the
   caution cleared once periods existed.
6. Periods (w254–w277): empty state; create 08:00–08:45 (homeroom) and
   09:00–09:45; order + Homeroom tag; edit to `Period 2 edited` 09:00–10:00; a
   duplicate sequence surfaces the generic CONFLICT copy “That conflicts with
   something already saved. Check the details and try again.”; nothing is written
   on failure.
7. Restore: policy back to daily / homeroom_authoritative / threshold NULL / 15
   (DB verified); the three walk periods deleted by id (all walk-named rows);
   marking back to daily with no chips (w303); 6 Mar working with reason null;
   15 Jun weekend.
8. Denial (w284/w285/w288/w291/w294/w296): subject teacher — **no gear** (w296).
   Class teacher — gear visible; calendar day save and policy save both refused
   with “You don't have permission to do this. Ask your administrator.”
   (w288/w291); **period create for her own section succeeded** (Period 3
   “Scope check”, w294) — school-scoped config is refused, section-scoped period
   management is authorized. The ledger's old “disabled for class_teacher” note
   refers to the server refusal, not a hidden UI.
9. Offline (w304–w314): airplane mode. A fresh month first showed the paused
   skeleton with no copy (finding 2); after the fix the calendar shows
   “Couldn't reach the server. Check your connection and try again.” + Retry
   (w311), Retry loads after reconnect (w312); an offline day save shows the same
   copy and writes nothing (w314; DB still at the pre-walk timestamp).
10. Accessibility (uiautomator tree): gear is a labelled button; hub rows carry
    label + subtitle; day options are radios with explanatory labels; generate
    rows are labelled buttons; policy segments are `tablist`/`tab` with selected
    state; period rows and the time picker expose labels (`Select hour`,
    `8 hours`, `45 minutes`). TalkBack's spoken pass was **not** run (no audio
    capture on the AVD); the accessibility tree was inspected instead.
11. Kill + reopen (w315–w319): cold start returns to Home, then the hub reads
    `Daily marking` / `No periods yet` (fresh, not the stale `3 periods` left by
    the SQL cleanup); policy reads Daily · 15; calendar 6 Mar Working.
12. Extra interaction checks (2026-10-20, clock re-pinned): the policy caution's
    **Add periods** pushes to the empty Periods screen (w343); the period
    editor's Start field opens the native picker (default 08:00), OK sets it and
    **Clear** returns the field to `Not set` (w345–w347). Neither flow saved:
    DB still daily / homeroom / NULL / 15 with 0 periods.

**Walk-environment note.** After the long session the AVD's display showed
doubled/ghosted UI in every screenshot (not an app bug); a guest reboot did not
clear it. Cold-booting the AVD with `-gpu swiftshader_indirect` produced clean
captures. The dev-client's floating Tools FAB can sit over the header gear (a tap
opens the dev menu instead); it is draggable — move it to a corner before
walking.

**Findings.**

1. **Stale tRPC GETs — fixed (blocker).** Expo’s native HTTP disk cache
   (`cache/http-cache`) replayed `attendance.calendar.list` after invalidation: the
   save wrote the DB, the refetch never reached the API, and the row stayed old.
   Fix: `/trpc` responses carry `Cache-Control: no-store` (API) and the mobile
   link sends a per-request `cache-control: no-store` header. Verified save →
   refetch hits the API → row updates in place (w230/w234).
2. **Offline queries paused — fixed (chunk-2 carry-over).** `expo-network` drives
   `onlineManager`, so offline queries paused and a screen with no cache showed a
   skeleton forever (February 2026; w306/w307). Fix: `networkMode: "always"` for
   queries **and** mutations in `lib/query.ts` — reads fail into the existing
   connection card + Retry (w311), writes fail with the copy and change nothing
   (w314).
3. **Failed `me.get` misread as a family session — fixed.** An offline boot /
   failed hydration rendered “Signed in as a family login” for a staff session
   (w308/w309). The index gate now shows the mapped error + Retry instead
   (`app/index.tsx`). Post-fix the reconnect refetch resolved straight to Home,
   so the error branch itself was not re-captured; the branch is covered by the
   gate's type check and lint.
4. **Policy residue in Daily mode — open.** Switching period-wise + threshold to
   Daily keeps `daily_status_rule=threshold_percentage` / `threshold=80` in the
   row (harmless: daily ignores both). Restored to homeroom/NULL via the rule
   toggle. Decide whether the form should null them on a Daily save.
5. **No period delete in v1.** The API exposes list/byId/create/update only, so
   the editor has no delete affordance; walk rows were removed by SQL.
6. **Clock-restore artifact (known).** Restoring `auto_time` jumps the device past
   the persisted session cookie; the next read can drop it and show sign-in. The
   app was left signed in on the Calendar, but a fresh sign-in may be needed.

**Gates.** Mobile: `check-types` clean, jest 12 suites / 112 tests, `expo lint`
clean. Root: `check-types` 9/9, lint 0 errors (pre-existing web/api warnings
only).
