# Mobile shell + teacher attendance — first build slice after the design gate

**Status:** Ready to build. Design gate passed 2026-10-18: the owner approved
the v3 direction on the rendered probe and re-cut the attendance interaction
(tap-to-change, long-press sheet, bulk pills) — record in
`docs/design/mobile/prototype/DIRECTION.md`. Approved probe:
`docs/design/mobile/prototype/shots/native/` (06 frames, scan clean).

**Scope:** Part A — the production shell the review locked (tokens, primitives,
role-aware tabs, staff home, "More"). Part B — the teacher attendance slice
(`docs/MOBILE_PLAN.md` §8), the first real domain workflow. Explicitly NOT in
this slice: students CRUD, fees, admission, homework, exams, attendance
reports/config surfaces.

**Product context:** One Expo iOS/Android app for the multi-tenant mskool SaaS
(organization = tenant, school = branch). Staff ship before family. Android is
the first-device gate; iOS at the Mac/EAS gateway.

---

## Part A — production shell (Step-0 exit work)

Fixed module list per `docs/MOBILE_PLAN.md` ("Step-0 code modules after
prototype approval", ~line 351): `screens/staff-home`, shared `Button`,
`Field`, `EmptyState`, `ThemedText`, `PermissionGate`, `AppIcon`,
`theme/tokens.ts`, `brand-admin.ts`, `hooks/use-me`,
`hooks/use-active-context`, `hooks/use-session-boundary`, `lib/i18n.ts`, and
the approved route/tab shell.

**Tokens (from the approved probe, `native.html`):** canvas `#F2F3F7`; ink
`#101828`; muted `#5D6674`; emerald accent `#0F7A44` (`#0B6B3A` on tints,
`#E8F5EE` tint); status red `#B42318`/`#FEF3F2`, amber `#B54708`/`#FFFAEB`,
slate `#475467`/`#F2F4F7`; field `#ECEEF3`; avatar chip `#E9EDF3`; hairline
`rgba(16,24,40,.08)`. Radius: 16 cards, 14 tiles/fields, 999 capsules. Spacing
on a 4-pt grid. Type scale (9 steps app-wide): `{11,12,13,14,15,16,20,30,34}`,
platform system stack. Elevation: two soft shadows (cards-floating / tab bar).
Motion: pressed states via Reanimated scale/haptic, reduce-motion respected.

**Primitives:** `Card`, `SectionLabel`, `PersonRow` (initials avatar — names
only, never student photos), `StatusPill`, `StatTile`, `CapsuleButton`
(primary/secondary/destructive), `BulkPill`, `AppSheet` (bottom sheet),
`TabBar` (floating, glass on iOS via `expo-glass-effect`, solid fallback),
`EmptyState`, `ErrorCard` (retry), `PermissionGate`, `AppIcon` (iOS SF symbol
via `expo-symbols` / Android Material via `@expo/vector-icons`, isolated).

**Navigation decision (recorded here as the plan requires): Expo Router's
JS tabs (`expo-router` `Tabs`, custom `tabBar`), not native tabs.** SDK 57's
native-tabs import is explicitly unstable (`expo-router/unstable-native-tabs`);
the approved design is a custom floating bar anyway (glass + capsule active
pill), identical on both platforms; JS tabs keep full accessibility control.
Revisit native tabs only if a later review wants platform-native chrome.

**Role-aware tabs from the `me.get` permission union:** teacher profile →
Home / Attendance / More; accountant (when fees ships) → Home / Fees / More;
domains without a built screen never render a tab. `Students` lives under
More. Context chip = active branch name (`school.list`), text chip per probe.

**Exit criteria:** shell walk on emulator shows login → Home (Today + Your
classes card with live attendance state) → tabs; `pnpm check-types` green;
lint 0 errors; the probe anatomy is recognizably the built screen.

---

## Part B — attendance slice (the 12-item template)

### 1. Persona, role/permission, context

**Class teacher** (`teacher@demo-trust.test` in seed: class teacher of Class
6-A, holds `attendance:create` + `attendance:read`; scope = her section).
Subject teachers also hold `attendance:create`. Principals/VPs hold read
(`attendance:read` only) and get the same screen read-only. Context: active
branch (school), current academic year (`academic.year.current`), her
section(s) from scope-clipped `academic.section.list`. Entry: Home class card,
or the Attendance tab. Real setting: between periods, corridor, one hand,
bright light — under a minute.

### 2. Measurable outcome

A teacher marks today's attendance for her section **in ≤60 s on device,
from screen open to saved confirmation**, including at least one exception
marked via the long-press sheet, with the saved state appearing only after
the server confirms.

### 3. Entry-to-done journey and wireflow

```
Home (Today)                 Attendance (marking)                    Saved
┌──────────────┐   tap      ┌─────────────────────────────┐  Save   ┌──────────────┐
│ Class 6-A    │───────────▶│ Class 6-A · Wed 15 Oct      │────────▶│ Attendance   │
│ not marked ● │            │ [35][1][1][1] stat tiles    │ server  │ saved [Edit] │
└──────────────┘            │ All present / All absent    │  ok     └──────────────┘
      ▲                     │ roster: tap = present⇄absent │              │ Edit
      │                     │ hold = 5-status sheet       │◀─────────────┘ (flips
      │  back               │ [Save attendance]           │   back to Save CTA)
      └─────────────────────┴─────────────────────────────┘
```

Derived "done" rule (from the web's proven semantics): the day is clean when
the authoritative layer holds marks AND nothing on screen differs from them —
the saved bar shows exactly then; any edit (tap / long-press / bulk) flips
back to the editing state with the Save CTA. Corrections: prefill from
`attendance.status`; on a PAST date with changed entries a reason field
appears (ADR-030); reason rides only on the changed entries and is never
required by the server.

### 4. Screen list with hierarchy and realistic sample content

1. **Home — Today** (shell; probe 01): context chip "Main Campus"; `Today`;
   `Wednesday, 15 Oct`; label "Your classes"; card `Class 6-A` /
   `Class teacher · Attendance not marked` (amber words) or
   `Marked · 35 present` (green words); tap → marking screen.
2. **Attendance — marking** (probe 02/04): h1 `Class 6-A`; sub
   `Wed 15 Oct · 38 students` (date opens the day picker); four stat tiles
   (probe: `35 Present · 1 Absent · 1 Late · 1 On leave`); bulk pills
   `All present` / `All absent`; hint line `Tap: present / absent · Hold:
   late, leave, half day`; roster rows (initials avatar, name, `Roll n`,
   status pill) in roll order, un-numbered rolls last; CTA `Save attendance`
   → saved bar `Attendance saved` + `Edit`. Read-only variant (no
   `attendance:create`): no bulk pills, no CTA, pills visible.
3. **Status sheet** (probe 03; long-press): avatar + name + roll; five options
   Present / Late / Absent / On leave / Half day with the current one
   ticked.
4. **Day picker sheet** (not probed; sheet pattern): the month's days from
   `attendance.calendar.list` with day type (working / half day / holiday /
   weekend) and today marked; non-markable days explain the refusal
   (holiday / weekend / no calendar row) and cannot be selected-for-marking.
5. **Correction reason field** (past dates only): appears above the CTA when
   ≥1 status changed; names how many entries change.
6. **Period picker** (only when the school policy is `period_wise`): period
   list from `attendance.period.list`; daily schools never see it.
7. **Detail states**: loading (skeleton rows), empty roster (`No students
   enrolled yet`), error (`ErrorCard` + Retry), offline copy, saved bar,
   refusal day, read-only.

### 5. State / recovery table

| State | Screen behavior |
|---|---|
| Loading | Skeleton roster (4 muted rows) + tiles at 0; never a spinner over stale draft |
| Empty | Roster empty → EmptyState, Save disabled; sections without enrollments are honest |
| Error (fetch) | Inline `ErrorCard` with server wording (mapped by `lib/errors`) + Retry; retry refetches status + calendar |
| Offline | Same error surface with connection copy (`expo-network` signal); online-only per ADR-043, no queue, no theatre |
| Denied (no `attendance:create`) | Read-only: controls absent; server still enforces |
| Denied (no `attendance:read`) | Section invisible (scope-clipped list); Attendance tab hidden if no attendance grants |
| Submitting | CTA shows progress, double-tap blocked; drafts never cleared until server confirms |
| Success | Saved bar replaces CTA; only after `attendance.mark` resolves |
| Interruption / resume | Draft survives navigation + refetch (port the web's `editedRef` rule: prefill may fill an untouched draft, never overwrite edited taps); on focus/refetch after submit, prefill from stored marks |
| Past-date edit | Reason field appears only when past + day marked + ≥1 change; reason attached to changed entries only |
| Kill after submit | On reopen, `attendance.status` is the truth; a re-mark resubmits the same payload idempotently |

### 6. Procedure-to-screen mapping

| Procedure | Used by |
|---|---|
| `me.get` | Tabs, identity, `PermissionGate`, role label |
| `school.list` | Context chip (branch name) |
| `academic.year.current` | Current academic year id for every list below |
| `academic.section.list` | Home cards, default section resolution |
| `academic.class.list` | Class-name labels (`Class 6-A`) |
| `enrollment.list` | Roster (student + enrollment pairs), roll order, nulls last |
| `attendance.policy.get` | `markingMode` daily vs period_wise |
| `attendance.calendar.list` (month) | Day picker + marking gate (dayType refusals) |
| `attendance.period.list` | Period picker (period-wise only) |
| `attendance.status` | Prefill, Home marked/not-marked, derived done |
| `attendance.mark` | Submit (all roster entries, reason only on changed past entries) |

All reads are called through the existing typed tRPC client (type-only
`AppRouter` import, Cookie header, native credentials omitted). No runtime
`@repo/contracts` imports — the Metro bundle stays free of Drizzle/DB code
(Step-0 gate); inputs are plain TS objects.

### 7. Keyboard, back/dismiss, safe-area, accessibility, platforms

- Keyboard: only the reason field (past dates) — keyboard-avoiding sheet
  behavior; CTA stays reachable while typing.
- Back/dismiss: tab screens keep tab bar; sheets dismiss via swipe-down +
  backdrop + hardware back (Android); day/status sheet selection applies
  immediately; Edit re-opens the CTA in place.
- Safe area: floating tab bar + floating CTA offset above `insets.bottom`;
  list content inset so the last row clears both.
- Touch: rows ≥56 pt hit height (full-row); pills inside rows are visual (the
  row is the target); bulk pills ≥38 pt tall with padding to ≥44 pt hit area.
- Screen readers: every row has a label "Name, Roll n, status Present,
  activate to change, activate and hold for more"; long-press replaced by an
  accessibility action ("Change status") so the sheet is reachable without
  gesture; stat tiles read as text; saved bar announced politely.
- Platforms: Android hardware back returns from sheets first; iOS sees the
  glass tab bar (Android gets the solid fallback); no platform-specific
  layout forks beyond material.
- Motion: tap feedback scale ≤0.98 + light haptic (`expo-haptics`), reduce
  motion respected; no animation that delays the tap target's state change.

### 8. Layout widths / device targets

Primary target: phone. Design widths 360–430 dp; the probe is 402 pt. No
tablet layout in this slice; rotation/split-screen must preserve the draft
and the task (list scrolls, CTA stays pinned). 360 dp-class emulator is the
reference device (`emulator-5554`).

### 9. Manual / device verification steps (Android emulator, dev build)

1. `pnpm dev` API up; login `teacher@demo-trust.test` → Home shows the class
   card with today's state.
2. Open marking: roster in roll order, all-present draft on an unmarked day;
   tiles count live.
3. Tap toggles present⇄absent; tap count ≤ taps needed; verify state changes
   in one tap and the pill + tile update together.
4. Long-press opens the five-status sheet; pick Late → pill + tile update.
5. `All absent` / `All present` bulk pills; undo by tapping.
6. Save → saved bar only after the API responds; verify in the API log; Edit
   flips back to the CTA.
7. Kill the app right after Save → reopen: stored marks are the truth, no
   double write.
8. Past date: reason field appears with changes; mark saves; reason rides in
   the request payload (server log).
9. Holiday/weekend/no-calendar day → refusal explanation, no marking.
10. `principal@` → read-only (no bulk, no sheet, no CTA); server refuses a
    crafted mark call anyway.
11. Airplane mode → error + retry copy; reconnect → retry succeeds.
12. TalkBack pass over roster (labels + accessibility action).
13. Screenshots to `apps/mobile/.expo/walk/` (gitignored); evidence summary
    into this plan + `docs/TASKS.md`.

### 10. Affected route-ledger rows and definition of complete

- `/attendance/mark` (phase 3): closes with this slice — native journey,
  real data, all states, server enforcement, reviewed device walk.
- `/attendance/calendar`, `/attendance/policy`, `/attendance/reports` (phase
  3): stay open; config/report screens are a later attendance chunk (no
  "web-only" designation implied).
- `(dashboard)/` home (phase 1): partially served by the staff-home card;
  the row stays open until context/profile work completes.
- Definition of complete: the definition from `MOBILE_PLAN.md` — native
  interaction design, real API data, states + recovery, server-side
  enforcement, no lost/duplicated writes, accessible controls, device walk.
  Ledger updated only after the walk.

### 11. Implementation reference register

Pinned versions (from `apps/mobile/package.json`, commit `6e1984b`):
Expo SDK `~57.0.28` · React Native `0.86.3` · React `19.2.3` ·
expo-router `~57.0.26` · `@expo/ui` `~57.0.23` · `expo-glass-effect`
`~57.0.4` · `expo-symbols` `~57.0.3` · `expo-image` `~57.0.5` ·
expo-network `~57.0.2` · reanimated `4.5.1` · gesture-handler `~2.32.0` ·
`@tanstack/react-query` `5.101.2` · tRPC `11.18.0` · zod `^4.4.3` ·
TypeScript `~6.0.3`. New deps expected: `@expo/vector-icons` (Android icon
fallback) and `expo-haptics` — install with `pnpm exec expo install` from
`apps/mobile` against SDK 57.

Applicable skills (read before their chunk): `expo-router`,
`expo-data-fetching`, `expo-design-system`, `expo-native-ui`, `expo-ui`
(BottomSheet), `mobile-design`, `vercel-react-native-skills`,
`expo-animation` (press/long-press feedback).

Docs to re-verify at build time (pinned to SDK 57 pages): Expo Router tabs
<https://docs.expo.dev/router/advanced/tabs/>; authentication/protected
routes <https://docs.expo.dev/router/advanced/authentication/>; `@expo/ui`
<https://docs.expo.dev/versions/latest/sdk/ui/>; glass effect
<https://docs.expo.dev/versions/latest/sdk/glass-effect/>; network
<https://docs.expo.dev/versions/latest/sdk/network/>; TanStack Query RN focus
handling <https://tanstack.com/query/latest/docs/framework/react/react-native>;
RN accessibility <https://reactnative.dev/docs/accessibility>; Reanimated
press/long-press `https://docs.swmansion.com/react-native-reanimated/`;
gesture handler <https://docs.swmansion.com/react-native-gesture-handler/>.
Web semantics reference (behavior parity, not UI): `apps/web/src/app/
(dashboard)/attendance/mark/page.tsx` (prefill, `editedRef`, changing-set,
reason scope, derived done).

### 12. Proof plan for uncertain native behavior

1. **Floating glass tab bar on Android** — `expo-glass-effect` is
   iOS-first; Android gets a solid `#FFFFFF` bar with the same geometry +
   hairline. Verify on emulator; check the SDK 57 glass-effect page before
   choosing the fallback path.
2. **Bottom sheet** — prefer `@expo/ui` `BottomSheet` (SDK 57, already a
   dependency); if it misses accessibility, swipe or Android behavior,
   fall back to `@gorhom/bottom-sheet` and record why. Milestone: one sheet
   renders + dismisses on both platforms.
3. **Long-press a11y** — TalkBack/VoiceOver cannot long-press reliably; the
   row exposes an accessibility action that opens the sheet. Verified in the
   TalkBack pass (step 12.5 of §9).
4. **Draft vs refetch race** — port the web's rule (prefill may touch an
   untouched draft only) and unit-test the pure draft reducer
   (toggle / bulk / changed-set / reason scope / derived done). Jest stack
   exists (jest-expo).
5. **List rendering** — 38-row roster: `FlatList` baseline with
   `keyExtractor` + memoized rows; FlashList v2 only if profiling in release
   mode warrants it.
6. **Date semantics** — `todayIso()` from device-local time (same as web);
   verify around a device-clock change; on-focus refetch re-evaluates.
7. **Period-wise coverage** — seed is daily; create a local period row for
   the walk OR record "period picker verified by unit/integration only" in
   evidence — never claim a device pass that did not happen.

## Open questions (decide before or during build, recorded — not silent)

1. **Half-day tile:** probe shows four tiles; a half-day mark has no tile.
   Recommendation: a fifth `Half day` tile appears when its count > 0 (keeps
   4-tile look for the common day, never lies). Confirm at walk review.
2. **Day-picker pattern** is not in the approved probe (sheet list of the
   month + day types). Review the built screen in the walk.
3. **Subject-teacher home:** the card subtitle says "Class teacher" only when
   a live `class_teacher` assignment matches the caller; otherwise the card
   shows the section without a role word. Confirm copy at walk review.
4. **Read-only affordance:** principal sees the same screen with controls
   absent; is a quiet "View only" hint wanted, or absence is enough?
5. **Period-wise device coverage** (proof item 7) — create a period in the
   demo data or accept the recorded gap.

---

## Walk record — 2026-10-18 (Android emulator, Expo dev client)

Setup: emulator-5554 (1080×2400 @ 420 dpi), `com.mskool.app` dev client on
Metro :8081, API :4000. Demo data is AY 2025-26 while the host clock is
2026-10-18 (outside the seeded calendar) — the device clock was pinned to
`Fri 2026-03-06 10:15 IST` (`auto_time` off) for the walk and restored to
automatic afterwards. Screenshots `w26–w107` in `apps/mobile/.expo/walk/`
(gitignored). Two local-only, disclosed aids: 5 students added to Main Campus
Class 6-A (rolls 2, 10, 11, null, null) to verify numeric-roll sort with nulls
last + name tiebreak, and a temporary query script (deleted after use). No
repo code or seed data was changed for the walk.

### §9 step results

1–9 **PASS** (w26–w63). Home card with today's live state (w35); marking screen
in roll order with all-present draft and live tiles (w36); one-tap toggle
(w37); long-press five-status sheet → Late (w38/w39); bulk All absent / All
present (w40/w41); mixed statuses incl. on_leave and half_day, all five
statuses exercised (w42/w43); Save spinner → saved bar only after the server
confirmed (w44/w45; DB: six 2026-03-06 rows, `period_id` null, `marked_by`
set); kill/reopen re-reads the marked day (w46). Past day Thu 5 Mar: first save
Isha absent, reasons null (w57/w58); Edit → change Kabir → reason block "1
student changing — say why" (w59), "Walk correction" typed (w60), save (w61);
DB confirms the reason rides only the changed entry (Kabir `correction_reason`
set, Isha stays null) per ADR-030. Weekend refusal: Sun 8 Mar → "This day
cannot be marked — Sun 8 Mar is a weekend" (w62/w63).
10. **PASS** — principal read-only + crafted-call refusal. Home: branch chip
"Demo Public School — Main Campus", card without role word (w83); attendance
screen shows the five live tiles (3/1/0/1/1), full roster with status chips,
and the read-only notice "...but not mark it — marking needs the
attendance:create permission"; no bulk pills, no save CTA (w84); a roster tap
changes nothing (w85). Server: script sign-in as `principal@` → `me.get` 200
(Demo Principal), `attendance.status` 200 (6 rows), `attendance.mark` → **403
FORBIDDEN "Missing permission: attendance:create"**.
11. **PASS with finding #4** — airplane mode → Save: blackholed network leaves
the CTA spinning indefinitely (5+ min, no error, no cancel; w95/w96; draft
kept). Controlled fast failure (REJECT rule) → immediate friendly alert
"Couldn't reach the server. Check your connection and try again." with the
draft preserved (w99); after restoring connectivity the same Save retried
cleanly → saved bar (w100; DB write at 12:28:11Z), then a restore-save put the
day back to 3 present / 1 absent / 0 late / 1 on leave / 1 half day (w101; DB
12:29:46Z).
12. **PASS with notes** — TalkBack is not installed on this emulator, so the
pass used the accessibility tree + scaled text instead. uiautomator: every
interactive control has a content description, roster rows read as one
sentence ("Isha Patel, Roll 2, status Present"), the untruncated tile labels
appear in the tree, and no unlabeled clickables exist. `font_scale 1.3`: layout
holds on home and attendance (w102/w103); the tile strip previously truncated
even harder there — fixed and re-walked (see finding #2). Scale restored.
13. Evidence: `apps/mobile/.expo/walk/` w26–w107; this record + `TASKS.md`.

### Findings and dispositions

1. **Branch chip absent for `class_teacher`** — the teacher lacks `school:read`,
   so `schoolId` resolves null: no branch chip, branch label "Not set" in
   More, and the policy-backed marking-mode query stays disabled. The
   principal (with `school:read`) shows the chip. Needs an owner decision:
   client-side org fallback, granting teachers a narrow school read, or
   extending `memberships` in `me.get`.
2. **Five-tile truncation ("On lea…", "Half d…")** — FIXED in
   `components/stat-tile.tsx` (padding `md`→`sm`, labels wrap to two lines
   instead of truncating) and re-walked: full labels at 1.0 (w105) and clean
   word-wrap at 1.3 (w106; single-word "Present" breaks mid-word only at 1.3 —
   accepted, all letters readable). Gates re-run green (tsc, lint, 59 tests).
3. **Stale identity after an account switch (client-state bug)** — after
   signing out of the teacher and signing in as the principal in the same app
   process, the app kept rendering the previous identity (More: "Demo Class
   Teacher"; home card with the class-teacher word; no branch chip) even across
   app restarts, while the server was provably correct (`me.get` as principal
   returns Demo Principal; the DB held only the principal's session). `pm
   clear` (wipe app data) + fresh login rendered the correct principal UI.
   Repro: sign out → sign in as another role → open More / home. Hypothesis:
   persistent client auth/query state is not cleared on sign-out (or the expo
   plugin cookie replacement leaves the old material readable). Hardening
   candidates: clear the query cache and secure-store auth keys on sign-out;
   make `handleSignOut` treat better-auth's resolved `{error}` values as
   failures (today only thrown errors are caught). The single earlier
   "zombie" sign-out (More → Home, context blank, no alert) fits this class
   and is not separately reproducible.
4. **Offline save hangs without a client timeout** — on a blackholed network
   (no route, no RST — the common dead-zone case) the Save stays pending
   indefinitely; the friendly error copy exists but only surfaces on a fast
   failure, and connectivity returning does not rescue the in-flight request
   (w95/w96 vs w99/w100). Recommendation: a bounded fetch timeout (talking to
   the deferred tRPC link-timeout question), keeping the draft + retry.
5. **Auth stack header still shows the raw route title "login"** — cosmetic;
   set a polished header title or hide the header in the auth group.
6. **Environment (not app bugs)** — Gboard/autofill overlay layers on this
   emulator periodically draw ghost text and can steal taps (dismiss with
   BACK; force-stop the IME; prefer uiautomator bounds for scripted taps);
   the seeded AY does not cover the real clock (clock pinned for the walk);
   the dev-server group crashed mid-walk and was restarted (API/Web back up,
   Metro untouched).

### Walk resolutions for open questions

1. Half-day tile: shipped as a **fifth tile shown always** (0 valued when
   absent) next to Late — the probe's 4-tile look is superseded; half-day
   currently shares Late's amber tone. Owner review at walk sign-off.
2. Day-picker: sheet reviewed (month grid + day-type tags + Today chip, w55).
3. Subject-teacher home: not device-covered (no subject-teacher seed login);
   card copy stays as built (role word only when truthfully derivable).
4. Read-only affordance: the explicit permission-named notice is shipped (w84).
5. Period-wise coverage: remains a recorded gap (seed is daily).

### Commit plan (prepared for owner — commit, do not push)

Four commits, one concern each, staged from the current tree:

1. `feat(mobile): shell primitives - tokens, components, format helpers`
   `apps/mobile/src/theme/` · `apps/mobile/src/components/` ·
   `apps/mobile/src/hooks/use-permissions.ts` · `apps/mobile/src/lib/copy.ts` ·
   `apps/mobile/src/lib/format.ts` · `apps/mobile/src/lib/format.test.ts` ·
   `apps/mobile/package.json` · `pnpm-lock.yaml`
2. `feat(mobile): staff shell - role-aware tabs, staff home, profile tab`
   `apps/mobile/src/app/_layout.tsx` · `apps/mobile/src/app/index.tsx` ·
   `apps/mobile/src/app/(staff)/_layout.tsx` ·
   `apps/mobile/src/app/(staff)/index.tsx` (deleted) ·
   `apps/mobile/src/app/(staff)/(tabs)/_layout.tsx` ·
   `apps/mobile/src/app/(staff)/(tabs)/home.tsx` ·
   `apps/mobile/src/app/(staff)/(tabs)/more.tsx` ·
   `apps/mobile/src/screens/staff-home/` · `apps/mobile/src/screens/more/` ·
   `apps/mobile/src/hooks/use-active-context.tsx`
3. `feat(mobile): teacher attendance slice - marking, sheets, saved state`
   `apps/mobile/src/app/(staff)/(tabs)/attendance.tsx` ·
   `apps/mobile/src/screens/staff-attendance/`
4. `docs(mobile): walk record - shell + attendance findings and ledger updates`
   `.kilo/plans/2026-10-18-mobile-shell-attendance.md` · `docs/TASKS.md` ·
   `docs/MOBILE_PLAN.md`

Chunk 2 carries the attendance tab config and the class card's typed
`router.push("/attendance")` (typed routes are on, `app.json`); the route file
follows in chunk 3. Typecheck stays green in practice (the generated route
types come from the dev-run tree), but if the owner wants a strictly
self-contained green at every commit, merge chunks 2+3. Suggested commit
message bodies: short bullet summaries (what shipped, which states, what the
walk proved); keep each body to a few lines — the walk record in this file is
the long form.
