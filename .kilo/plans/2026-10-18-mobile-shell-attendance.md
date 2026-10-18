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
