# Mobile attendance chunk 2 — yearly summaries + section switcher

Follow-on slice to `.kilo/plans/2026-10-18-mobile-shell-attendance.md` (Part B —
attendance slice; its §9 walk and findings are the baseline). Same domain, new
surface: the `attendance.summary` read ("readable summaries" in the
`/attendance/reports` ledger row) and fast section selection for the marking
screen. Management surfaces — calendar generate/days, policy upsert, periods —
stay open (owner deferral, 2026-10-18).

Owner go: "do it the chunk 2" — 2026-10-18, after the post-walk hardening chunk
was committed (`4c76521`, `1346efc`, `e44e5d5`, `212f5a7`).

## 1. Persona, role/permission, context

- **Class teacher** (`teacher@demo-trust.test`; `class_teacher` of Class 6-A,
  holds `attendance:create` + `attendance:read`; scope = her class/section):
  marks a day, then reads how the section is doing; switches sections when she
  has more than one visible section.
- **Read-only staff** (principal/VP; `attendance:read`, no `attendance:create`):
  gets the same summary and the same switcher; the marking panel stays the
  already-walked read-only variant.
- Context unchanged: active branch + current academic year
  (`useActiveContext`), sections from scope-clipped `academic.section.list`.
- Moment of use: corridor/office, one hand — "who is short this year?" is a
  glance, "switch to the other section" is two taps.

## 2. Measurable outcome

1. Opening a marked section's **Summary** shows the server's
   `attendance.summary` rows verbatim: per-student `daysPresent/workingDays` and
   `attendancePercentage` equal the API's output (no client-side recompute),
   and the panel's average = Σpresent ÷ Σworking over students with rows.
2. After a mark is saved on the marking panel, switching to Summary reflects
   the new day **without an app restart** (query invalidation on
   `attendance.mark` success).
3. Section switch (any panel) is: title tap → sheet → option tap — the three
   taps switch the whole screen; marking draft is preserved when toggling
   Mark ⇄ Summary.
4. Read-only persona sees the identical summary and switcher.

## 3. Entry-to-done journey and wireflow

```
Attendance tab (Mark)                  Section sheet              Summary
┌──────────────────────────────┐  tap  ┌──────────────────┐  pick  ┌──────────────────────────────┐
│ Class 6 · A            ⌄  [i]│──────▶│ Pick a section   │───────▶│ Class 6 · A                  │
│ [ Mark | Summary ]           │       │ Class 6 · A  ✓   │        │ [ Mark | Summary ]           │
│ Wed 6 Mar · 38 students      │       │ Class 6 · B      │        │ 2025-26 · 38 students        │
│ [tiles][bulk][roster]        │       └──────────────────┘        │ [6 Days marked][311 Working] │
│ [Save attendance]            │        tap "Summary" ────────────▶│ [1.2% Average]               │
│                              │                                   │ rows: name · 3 present · 2%  │
└──────────────────────────────┘                                   │ footnote                     │
      Save ──▶ invalidate summary ──▶ Summary already fresh ───────▶└──────────────────────────────┘
```

`[i]` = the existing tab; the title row is the switcher entry on both panels.
Switching writes `sectionId` to the route params (`router.setParams`) so the
home card's deep entry and the in-screen switch share one source of truth.

## 4. Screen list with hierarchy and realistic sample content

1. **Attendance — Mark** (existing, walked): unchanged body; the title row
   gains the section chevron (switcher) and the view toggle sits under it.
2. **Section sheet** (new; day-sheet pattern): bottom sheet, `Pick a section`;
   one row per visible active section, `Class 6 · A` labels, checkmark on the
   current one, instant apply + dismiss. Long lists scroll (principal sees the
   school).
3. **Attendance — Summary** (new):
   - Header: same title + toggle; sub-line `2025-26 · 38 students`.
   - Tiles, in reading order: **Days marked** (the fullest student's marked
     days — the section's coverage against the plan; `0` when none),
     **Working days** (calendar truth; `—` when none), **Average**
     (Σpresent/Σworking across students with rows; `—` when none). The
     original "Not marked" tile (roster students without rows) read as days
     and was replaced after the owner's first review — see "Post-review fix".
   - Students with no rows at all get a caution line under the tiles
     (`1 student has no attendance yet`), rendered only when there are any.
   - Rows in roll order (same order as marking): initials avatar, name,
     `3 present · 2 absent · 1 late` (parts only when non-zero), right
     percent capsule `2%`; a student with no rows reads `No attendance yet`
     with no capsule. Not pressable — nothing looks tappable that is not.
   - Footnote: the average counts present days against the session's full
     calendar and rises as days get marked — the same figure exam eligibility
     reads.
4. **States** (both panels): loading skeletons, fetch error + retry (ErrorCard,
   shared retry across calendar/status/enrollments/summary), empty roster,
   no-year, no-access — unchanged where they exist.

## 5. State / recovery table

| State | Behavior |
|---|---|
| Loading summary | Tiles + 4 skeleton rows; never a spinner over the marking panel |
| Summary fetch error | ErrorCard + Retry refetches summary + enrollments; marking panel unaffected |
| No rows yet | Rows render `No attendance yet`; tiles `0` / `—` / `—`; the caution line counts them |
| After a save | `attendance.summary` invalidated on mark success; switching to Summary (or refocus) refetches |
| Section switch mid-draft | Marking panel stays mounted while Summary is shown (`display: none` + a11y hidden); draft/reason/editedRef survive the toggle; `key={section.id}` still remounts on a section change (same rule as chunk 1: a section change is a fresh sheet) |
| Stale section param | Param that names no visible section falls back to the first visible section (chunk-1 rule, kept) |
| Offline | Existing error surfaces; no queueing (ADR-043) |
| Denied | No `attendance:read` → tab hidden + in-screen guard (unchanged) |

## 6. Procedure-to-screen mapping

| Procedure | Used by |
|---|---|
| `attendance.summary` **(new consumer)** | Summary panel rows + tiles (`academicYearId` + `sectionId`) |
| `attendance.mark` | Marking submit; on success also invalidates `attendance.summary` |
| `academic.section.list` | Switcher options (scope-clipped, active only) — existing query |
| `academic.class.list` | Switcher labels (`Class 6 · A`) — existing query |
| `enrollment.list` | Summary rows' names + roll order (shared roster helper with marking) |
| `attendance.status` / `calendar.list` / `period.list` / `policy.get` | Marking panel only (unchanged) |

No new endpoints. No runtime `@repo/contracts` import; the summary row type is
inferred from the tRPC client output.

## 7. Keyboard, back/dismiss, safe-area, accessibility, platforms

- **Toggle**: two segments, `accessibilityRole="tab"` + `accessibilityState
  { selected }`; labels "Mark attendance" / "Attendance summary"; ≥44 pt tall.
- **Switcher**: title row is a button (`Choose a section` hint); sheet rows
  announce `Class 6 · A, selected`; swipe-down/backdrop/hardware-back dismiss;
  selection applies immediately.
- **Summary rows**: plain accessible views; label
  `Name, present 5 of 245 days, 2 percent` / `Name, no attendance marked yet`;
  the avatar is hidden; the percent capsule is visual only.
- **Hidden panel** (draft preservation): wrapper gets `display: none`,
  `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`,
  and `pointerEvents="none"` so TalkBack never lands in the hidden panel.
- Safe area/tab bar/CTA spacing unchanged; self-review at large font scale
  (titles `numberOfLines={1}`; tiles wrap labels, walk finding #2 rule).

## 8. Layout widths / device targets

Phone only, 360–430 dp; emulator-5554 (1080×2400 @ 420 dpi) is the reference.
Summary list is a `FlatList` (roster ≤ ~60; same baseline as marking).

## 9. Manual / device verification steps (Android emulator, dev build)

Preconditions: API :4000 + Metro :8081 up; teacher signed in. Demo data is AY
2025-26, so pin the emulator clock inside the seeded calendar (2026-03-06
class), then restore `auto_time` afterward.

1. Attendance tab → title chevron → sheet lists the teacher's sections →
   pick one → screen (marking + summary) follows; API log shows
   `section.list` cached, `summary` fetched for the new id.
2. Mark a fresh day (or edit one) → Save → switch to Summary → the new day is
   counted (invalidate works); no app restart.
3. Summary numbers cross-checked against a raw `attendance.summary` call
   (percentages identical; no client recompute).
4. Unmarked section (e.g. another class) → rows read `No attendance yet`,
   tiles `0 / — / —`, caution line = roster size.
5. Read-only persona (principal): summary renders; switcher lists the school's
   sections; marking panel still read-only.
6. Toggle Mark ⇄ Summary mid-draft (taps made, not saved) → draft survives.
7. Offline (iptables DROP) → Summary error + Retry; restore → Retry loads.
8. Home card tap → marking focus for that section (param entry unchanged).
9. TalkBack pass: toggle, switcher, one summary row, hidden-panel isolation.
10. Kill + reopen → last state resolves honestly (no stale section).
11. Screenshots `w140+` into `apps/mobile/.expo/walk/` (gitignored); walk record
    into this plan + `docs/TASKS.md`; ledger + `docs/MOBILE_PLAN.md` §8 updated
    after the walk.

## 10. Affected route-ledger rows and definition of complete

- `/attendance/reports` (phase 3): closes with this walk — native summary
  surface with fast section selection (index: "Fast section/day selection,
  roster marking, correction reason, readable summaries").
- `/attendance/mark`: stays closed (chunk 1) + switcher added.
- `/attendance/calendar`, `/attendance/policy`: remain open (owner deferral);
  `/attendance/reports` monthly/term drill-down not built — annual rows only,
  matching the web report's own rule (monthly is "the register's job").
- Definition of complete: `MOBILE_PLAN.md` definition — native interaction,
  real API data, states + recovery, server enforcement, accessible controls,
  reviewed device walk. Ledger touched only after the walk.

## 11. Implementation reference register

Versions unchanged from Part B §11 (Expo SDK ~57.0.28 · RN 0.86.3 · React
19.2.3 · expo-router ~57.0.26 · @expo/ui ~57.0.23 · TanStack Query 5.101.2 ·
tRPC 11.18.0 · zod ^4.4.3 · TypeScript ~6.0.3).

Skills read for this chunk: `expo-router` (nav/params), `expo-data-fetching`
(query states, invalidation — "saves preserve work", "refetches keep stale
content"). Docs verified against the pinned SDK: Expo Router v57
`ImperativeRouter.setParams` — "Updates the current route's query params"
<https://docs.expo.dev/versions/v57.0.0/sdk/router/> (also present in the
installed types, `expo-router/build/global-state/router.d.ts`).

Files:
- `apps/mobile/src/screens/staff-attendance/index.tsx` (shell: header, toggle,
  switcher wiring, hidden-panel mounting)
- `apps/mobile/src/screens/staff-attendance/marking-panel.tsx` (moved body of
  today's `MarkingPanel`; roster build moved to the shared helper)
- `apps/mobile/src/screens/staff-attendance/summary-panel.tsx` (new)
- `apps/mobile/src/screens/staff-attendance/summary.ts` (+ test) — row pick,
  aggregate, percent formatting (pure)
- `apps/mobile/src/screens/staff-attendance/roster.ts` (+ test) — shared
  roster build/sort out of the marking panel
- `apps/mobile/src/screens/staff-attendance/use-section-roster.ts` — shared
  enrollments query + roster memo
- `apps/mobile/src/screens/staff-attendance/section-sheet.tsx` (new)
- `apps/mobile/src/screens/staff-attendance/view-toggle.tsx` (new)
- `apps/mobile/src/lib/copy.ts` — new strings (summary, switcher, toggle)

Web semantics reference (behavior parity, not UI):
`apps/web/src/app/(dashboard)/attendance/reports/page.tsx` (annual-row
preference, term fallback, the "monthly is the register's job" rule).

## 12. Proof plan for uncertain native behavior

1. **`router.setParams` on a tab route** — API confirmed in SDK 57 docs/types;
   device-verify the param survives tab switches and re-renders the screen
   (walk step 1), and that home-card entry still overrides it.
2. **Draft preservation across panels** — `display: none` wrapper; device-verify
   taps in Mark → toggle → back (walk step 6) + TalkBack isolation (step 9).
3. **Summary freshness after a save** — `utils.attendance.summary.invalidate()`
   in `mark`'s `onSuccess`; device-verify (walk step 2); unit tests cover the
   pure row logic (annual preference, term fallback dedupe, zero-row students,
   percent formatting `"72.73"→"72.7%"`, `"75.00"→"75%"`, `"0.00"→"0%"`).
4. **Percent is a server string** — `numeric` arrives as `"72.73"`; format
   helper parses + rounds once; no arithmetic on floats beyond the display
   aggregate (Σ counts are integers).
5. **Long section lists** — sheet scrolls; no search this chunk (recorded open
   question).

## Open questions (decide at walk review, recorded — not silent)

1. **Segment vs route**: Summary as a segment of the Attendance tab (chosen —
   one section context, one tap away, no new stack). Confirm the owner is happy
   without a dedicated route/entry from Home.
2. **No threshold colours**: the summary shows raw percentages (no red below
   75) — the system's 75% bar is per-exam config (`exam_eligibility`
   `minAttendancePct` default), not a school-wide rule this screen may assert.
   Confirm the owner agrees; a "short of the default bar" aid can be a later
   chunk with an explicit rule source.
3. **"Class average" rounding** — one decimal, trailing `.0` dropped (matches
   the web's raw percentage column otherwise).
4. **Term rows fallback** — unreachable in practice (annual is recomputed
   beside every term row); the helper dedupes to the term row with the most
   working days and the footnote stays silent about terms. Note for review.

## Walk record (2026-10-19, Android emulator, principal persona)

Environment: `mskool-dev` AVD (1080x2400), Metro :8081 via `adb reverse`,
API :4000 on the LAN address; device clock pinned to Fri 2026-03-06 (inside
the seeded AY 2025-26 calendar) for the walk, restored to `auto_time` after.
Persona: principal (read-only, `attendance:read`, no `attendance:create`).
Evidence: `w171-w186` in `apps/mobile/.expo/walk/` (gitignored).

Steps, as run (each step = dump-checked screen; number = screenshot):

1. Attendance tab → the shared title row shows the section chevron; the
   sheet lists both visible sections, current one marked selected
   (w171-w173). Selecting one re-titles the screen and both panels follow
   (w174).
2. Unmarked section (6-B): Mark panel shows its 1-student roster; Summary
   shows `—` tiles, `1 Not marked` (tile later replaced — see "Post-review
   fix" below), "Rohan Verma — No attendance yet" (w174/w175).
3. Switch back with Summary open → 6-A summary rows + chips, segment
   survives the switch (w176).
4. Failure path: API stopped → error card "Couldn't reach the server.
   Check your connection and try again." + Retry (w178/w179); API
   restarted → Retry → fresh data, no app restart (w180/w181).
5. Home shows per-section cards with marked / not-marked state (w182);
   card tap opens attendance on that section, proven for both sections
   (w183/w184).
6. Cold start (force-stop + relaunch) → first section, Mark segment,
   fresh day fetch (w185).
7. Accessibility/dump checks: toggle selected states present; hidden panel
   absent from the a11y tree in both directions; switcher rows carry
   selection state.

Findings:

- **Walk-test invalidation — `ip link set eth0 down` is NOT an offline cut
  on this AVD.** The emulator keeps a default network through cellular;
  requests still succeeded and nothing paused. A true offline test needs
  wifi + data + eth0 cut together. The full-cut run was started but landed
  in the clock artifact below before the paused-fetch path could be
  observed. Connection-failure copy + Retry is proven via API stop instead;
  the paused-offline path remains unverified on this AVD (carry to the next
  walk).
- **Clock artifact, not a product bug:** restoring `auto_time` after a
  pinned-date walk jumps the device clock past the persisted cookie's
  expiry (the plugin computes expiry against the device clock), so the
  next read drops the cookie and the app honestly shows sign-in (w186).
  Fresh sign-in re-verified healthy. Next agent: sign in again after
  restoring the clock, or keep it pinned for the whole walk.
- **QuickBoot state (earlier session, reseeded):** one launch restored
  pre-seed JS state (sections n=1); a forced refetch resolved it and the
  API answered consistently (n=2). Environment artifact — force a refetch
  before debugging a single stale list.
- Chunk-1 semantics on an unmarked day (default-Present draft) still hold;
  read-only callers get the draft view without the save affordance.
- Demo data seeded to prove the switcher with two sections: section 6-B
  `d27df551-6136-4dd1-a2e1-169a761067d9` + student Rohan Verma
  (enrollment `d9d3f7f7-6e90-46dc-a300-318358129cc7`, roll 1). Report to
  the owner; cleanup optional.

## Post-review fix (owner, 2026-10-19)

Owner review of the walked panel: "the summary says 0 Not marked in 2025-26
but I think there are many not marked days" — both observations correct and
useful. Root cause: the third tile counted roster students with NO summary
row (data hygiene), while its label read as unmarked days; on a lightly
marked year it said `0` while 305 of 311 planned days had no attendance at
all (6 distinct marked dates in the demo year, DB-verified). The rows'
`3/311 days` numerator read the same way — true against the year plan, easy
to misread as a broken attendance rate.

Rework (same panel, same data, no API change):

- Tiles now read the year's story in order: **Days marked 6** · **Working
  days 311** · **Average 1.2%** — the average finally sits next to the
  context it is measured against. `Days marked` = the fullest student's
  bucket + leave count (marking writes a status per student per marked day,
  so the fullest student is the section's coverage; one edge — a day every
  student was `half_day` fills no bucket — documented in `summary.ts`).
- Row meta drops the plan denominator: `3 present · 2 absent · 1 late`; the
  capsule keeps the server's exam-eligibility percentage.
- The student-data signal survives as a caution line under the tiles,
  rendered only when someone has no rows: `1 student has no attendance yet`
  (6-B case, w189).
- Footnote now names the mechanism: "The average counts present days
  against the session's full working calendar, so it rises as days get
  marked — the same figure exam eligibility reads."

Walk after the fix (w188 6-A / w189 6-B): tiles `6` / `311` / `1.2%`, rows
`3 present · 2 absent`, 6-B shows `0 / — / —` + the caution line. Gates:
check-types clean, lint clean, 78 tests / 8 suites (sectionTotals suite
extended: fullest-student rule, bucket-empty rows, no-data split).

Recorded, not silent: `Days marked` is a glance derivation, not an audited
column — if the owner wants audit-grade coverage, the follow-up is a server
`days_marked` column on `attendance_summary` (the recompute already has the
rows; it just does not persist the count). Not built now: no schema or
contract churn inside a review pass.

Open visual follow-ups if the owner still wants more (unbuilt, unapproved):
a coverage progress bar under the tiles; term/month segmented view; the
per-student capsule showing the marked-day rate alongside the year rate.

## Visual upgrade (owner review #2, 2026-10-19)

Owner: "the UI is not up to the mark. it is very basic and dull now." Read
on review: the panel was the only screen in the app using none of the
approved probe's information colour or card anatomy — three flat neutral
tiles, plain rows, a loose footnote. Not semantics this time; hierarchy and
material.

Design read: a school-admin attendance summary for teachers and principals
in a native staff app, restrained status-coloured system (approved probe
language), iOS + Android. Dials: variance 5 (one distinctive detail — the
year card), motion 2 (instant; no decorative motion), density 5.

Decisions, all inside the existing token/component system:

- **Year card** (`Card`, the probe's white 16-radius surface) replaces the
  tile strip: uppercase "YEAR SO FAR", the average as the one hero number
  (new `hero` text variant — the type scale already reserved `fontSize.hero`
  for exactly this), then the **coverage bar**: accent fill on a field
  track, width = marked/working days (4% floor so a started year reads as a
  dash, not a dot; clamped at 100), caption "6 of 311 days marked". The bar
  is the visual answer to review #1 — how much of the year is actually
  marked — and the caption carries the screen-reader story (the bar is
  decorative).
- **Coloured bucket fragments** in every row: `3 present · 2 absent · 1
  late · 1 on leave`, each fragment tinted by the existing `statusTone` map
  (the same information colour the marking screen uses; never thresholds).
  Meta wraps to two lines instead of truncating; the percent pill stays
  neutral.
- **"STUDENTS" section label** (probe group anatomy, `SectionLabel`) splits
  the year story from the list; the no-data caution line sits between card
  and label; the footnote moves inside the card — it explains the average,
  and as a list footer it landed under the floating tab bar at rest.
- States: skeleton mirrors the card; empty/error unchanged; 6-B reads `—`
  hero, empty bar, "No days marked yet".

Recorded unchanged: no threshold colours; no per-row composition bars and
no month view (offered, unapproved). The earlier "open visual follow-ups"
list is superseded by this section for the bar only.

Walk after the upgrade (w190 6-A / w191 6-B): year card with hero + bar
(`6 of 311 days marked`), tinted bucket fragments in the rows, STUDENTS
label; 6-B reads `—` / empty bar / `No days marked yet` + caution line.
Scroll check: with exactly six students the list scrolls ~58 px and the
last row clears the floating tab bar at full scroll; at rest only the
group's bottom edge sits under the bar — no content covered. The footnote
settled at `meta` (regular muted): as `caption` (12 semibold) a 3-line
paragraph read as a label, not an explanation. Gates: check-types clean
(root + mobile), lint clean, 83 tests / 8 suites (`coveragePercent` cases
added; the `hero` variant is additive).

Capture note for the next walk: `adb shell screencap -p /sdcard/...` then
pull produced stale-tile ghost frames this session (looked like a zoomed
screen; the layout tree was correct the whole time — magnification was
off). `adb exec-out screencap -p > file` captures clean — use that path.

## Commit plan (owner commits; agent never commits or pushes)

Two commits, in this order. Owner's files currently modified in the tree
are NOT part of either: `apps/api/src/env.ts`,
`apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/trpc/client.ts`,
`rough.md`, `skills-lock.json`, `.zcodeignore`, `packages/db/query-tmp.mjs`.

**Post-chunk-3 reality (2026-10-20).** `index.tsx` now also carries the chunk-3
manage gear and `copy.ts` its manage strings; `index.tsx` imports the
chunk-3 extraction `use-attendance-section.ts`. Staging chunk 2 A whole therefore
also needs `apps/mobile/src/screens/staff-attendance/use-attendance-section.ts`
and `apps/mobile/src/components/app-icon.tsx` (the settings glyph), or use
`git add -p` on `index.tsx` / `copy.ts` to keep chunk 2 gear-free. The docs files
(`docs/MOBILE_PLAN.md`, `docs/TASKS.md`) are shared with chunks 3/E2E; stage them
once in chunk 3 E, not here. The E2E harness is a separate later commit.

**A — feature: yearly summaries + section switcher**

Files:
- `apps/mobile/src/lib/copy.ts` (M)
- `apps/mobile/src/components/themed-text.tsx` (M — new `hero` variant)
- `apps/mobile/src/screens/staff-attendance/index.tsx` (M)
- `apps/mobile/src/screens/staff-attendance/marking-panel.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/summary-panel.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/section-sheet.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/view-toggle.tsx` (A)
- `apps/mobile/src/screens/staff-attendance/roster.ts` + `roster.test.ts` (A)
- `apps/mobile/src/screens/staff-attendance/summary.ts` + `summary.test.ts` (A)
- `apps/mobile/src/screens/staff-attendance/use-section-roster.ts` (A)
- `.kilo/plans/2026-10-18-mobile-attendance-summary.md` (A)
- `docs/MOBILE_PLAN.md` (M — §6 ledger + §8 rows)
- `docs/TASKS.md` (M — resume here)

Message:

```
feat(mobile): attendance yearly summaries + section switcher (chunk 2)

Mark/Summary segments on (staff)/attendance with the section switcher on
the shared title row. Summary reads attendance.summary (yearly,
per-section): a year card (hero average, coverage bar of marked vs working
days, mid-year footnote), per-student rows with day buckets tinted by
status, em dash where nothing is marked, caution line when someone has no
data. Panels stay mounted (display:none + a11y hiding) and remount per
section (key={section.id}); the open segment survives a section switch.
Read-only callers get the same reads without editing affordances.

Device walk 2026-10-19 (Android emulator, w171-w185): two-section switcher,
switch with Summary open, empty vs populated section, error -> Retry ->
recovery, home per-section cards, card-param entry, cold-start default.
Owner-review reworks re-walked (w188/w189 tile counts days, not students;
w190/w191 year card + coverage bar). Gates: root + mobile check-types
clean, lint clean, 83 tests / 8 suites.
```

**B — fix: purge cached session data on successful sign-in**

Files: `apps/mobile/src/lib/auth.ts` (M)

Message:

```
fix(mobile): purge cached session data after a successful sign-in

Account-switch walk finding: a get-session response raced across sign-out
could rewrite the plugin's _session_data cache, and the old user's blob
then rehydrated the session atom while the cookie already belonged to the
new user. Sweep the plugin's _session_data keys (chunk suffixes included)
after login()/loginByPhone() succeed - best-effort; the session refetch
that follows writes the new user's copy. logout() reuses the same key
helper.
```

**C — fix: restore root check-types (pre-existing, web — optional for the
owner, not part of the mobile slice)**

Files: `apps/web/src/components/ui/textarea.tsx` (M — one import line)

Found while running the root gate for this handoff: the file imported
`cn` from `"cn"` (no such module), committed in `aa6bc31` (site editor),
so root `pnpm check-types` has been red since. All sibling ui components
import `@/lib/utils`; aligned. Fix prepared — the owner may take it as a
separate commit or drop it.

Message:

```
fix(web): import cn from @/lib/utils in textarea

Pre-existing typo from aa6bc31 (site editor): import { cn } from "cn"
resolves nowhere, so root check-types stayed red. Sibling ui components
all import @/lib/utils.
```
