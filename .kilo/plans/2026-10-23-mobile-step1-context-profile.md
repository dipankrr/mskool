# Mobile Step 1 - context switchers, profile and account (chunks A + B)

Date: 2026-10-23. Status: planned, awaiting owner go before UI.
Implements `docs/MOBILE_PLAN.md` §6.1. Attendance (Step 3) is already complete,
so this is the resume point in the plan's own order (Step 1 -> Step 2).

Two chunks, separate commits:

- **A (this slice):** branch switcher + profile/access + voluntary password change.
  Reads only, no new permission, visible to every staff role.
- **B (next):** branch and session management (the write procedures in §6.1),
  gated by the permissions the backend already checks.

**Decision 2026-10-23 (owner direction: "app is app"): there is no global
session switcher on mobile.** The web's active-session toggle is a desktop
sidebar pattern; on a phone it turns every tab into a mode and invites marking
the wrong year. Mobile instead:

- always **works** in the branch's current session (context is ambient);
- exposes **history where it is read** - a year chip inside Summary/report
  surfaces, shown only when the caller holds `academic_year:read_history` and
  the server returns more than one session;
- treats **changing** the session as an administrative act (Sessions
  management, chunk B) with a consequence confirm - never a viewing mode.

This supersedes MOBILE_PLAN §6.1's "year picker and current-year context" row;
the row becomes "current-year context + per-surface history selector". Record
as an ADR when the slice closes.

---

## 1. Persona, role/permission and context

Primary persona: a **principal** (or any staff member) whose grants cover more
than one branch, checking or changing which branch the app is acting on.

Secondary persona: a **class teacher** with one branch and the current session.
She must see no affordance that implies a choice she does not have.

Permission model (ADR-011 / ADR-036 / ADR-044 - roles are org-customizable, so
no screen may key off a role name):

| Need | Source | Permission | Notes |
|---|---|---|---|
| Branch list | `me.get` -> `memberships[].schools[]` | none (bootstrap) | already the source of `useActiveBranchName` |
| Year list | `academic.year.list` | `academic_year:read` | past years filtered server-side by `academic_year:read_history` (ADR-024); the client never decides |
| Profile | `me.get` | none | identity, `roleTypes`, `scopeTypes`, `permissions` |
| Change password | better-auth | none (own account) | ADR-007 rider |
| Branch/session writes (B) | `school.create/update/deactivate`, `academic.year.create/update/setCurrent` | see defaults | only org_admin holds create/delete; orgs may grant any of them to any role |

Context chain: organization -> granted branch -> the branch's current year.
`ActiveContextProvider` already resolves and persists org + branch and
validates persisted ids against `me` on every new session; this slice adds no
new context state.

Gating rule for UI: `usePermissions().has/hasAny` on the permission string the
router checks. Never `roleTypes.includes(...)` except for human-readable labels
(the existing `role-word.ts` precedent). Every destination keeps its own
permission-denied state; a hidden entry is not enforcement.

## 2. Measurable task outcome

A principal whose trust runs two branches switches from Main Campus to North
Campus and back, and can see exactly which roles, scopes and permissions her
account holds, in under 30 seconds, without signing out and without a stale
screen.

A single-branch teacher sees no switcher chevron and no dead sheet target.

## 3. Entry-to-done journey and wireflow

```
Tab bar [Home] [Attendance] [More]
  More
    identity card  (avatar · name · email)
    Context card
      Branch    Main Campus  MAIN        chevron   -> BranchSheet (only if >1)
      Session   2025-26                             (static in A; managed in B)
    Profile and access                      chevron   -> /profile (push)
    Sign out

  BranchSheet (native bottom sheet, @expo/ui)
      Choose branch
      [check] Main Campus    MAIN · Mumbai
              North Campus   NORTH · Pune
      Cancel

  /profile (pushed over the tab bar)
    Account      name · email · organization
    Your access  role badges · scope badges · "N permissions"
                 View permissions ->
                    grouped list, read-only (attendance:create, fee.list, ...)
    Change password  -> /change-password?returnTo=/profile -> back to /profile
```

Branch switch applies immediately on selection: sheet dismisses, the context
card updates, and every screen re-resolves because its query inputs carry
`schoolId` / `academicYearId`. Attendance's `sectionId` route param is already
validated against the new branch's section list and falls back to the first
section (`use-attendance-section.ts`), so no stale section survives a switch.

## 4. Screen list, hierarchy and realistic sample content

| # | Screen | Route | Content |
|---|---|---|---|
| 1 | More (restructured) | `(staff)/(tabs)/more` | Demo: Demo Trust / Main Campus (MAIN) / 2025-26 / "Priya Nair · principal@demo-trust.test" |
| 2 | Branch sheet | overlay component | "Main Campus · MAIN" selected, "North Campus · NORTH" |
| 3 | Profile | `(staff)/profile` (push) | "Priya Nair", org "Demo Trust", roles "Principal", scopes "org, school", "38 permissions" |
| 4 | Permission list | inside Profile (expandable) | grouped `attendance` (read, create, update), `fee` (...), sorted |
| 5 | Change password (existing) | `(auth)/change-password` | voluntary mode from Profile; forced flow unchanged |

Component moves (growth rule, ADR-043 §5): `FactRow` currently lives inside
`more/index.tsx`; Profile is its second consumer, so it is promoted to
`components/fact-row.tsx` with a tappable variant. The sheet is a new
`components/choice-sheet.tsx` (built as `ChoiceSheet`), generic so chunk B's
session picker reuses it — `section-sheet.tsx` is now a thin wrapper over it.
`LinkRow` and `ScreenFrame` are the other two promotions (Profile's rows, and
the manage frame's anatomy shared by Profile).

## 5. State and recovery table

| State | More / context | Profile |
|---|---|---|
| Loading | `me` is settled before tabs render (staff guard), so identity is real; session line shows `Loading…` while `yearPending` | `me` settled; no spinner needed |
| Empty | <2 branches: row is plain text, no chevron, not pressable. No current year: `Not set` (existing copy) | `roleTypes: []` -> "No roles assigned"; `permissions: []` -> "No permissions granted"; both are honest, not errors |
| Error | year query failed -> `Couldn't load session` + Retry (refetch `academic.year.list`) | — |
| Offline | same as error using `copy.errors.network`; branch list still works from cached `me` | renders from cached `me`; change-password submit fails with the network copy |
| Denied | not applicable (reads are bootstrap / `academic_year:read`); a caller without `read_history` simply receives fewer years | permission list is her own; no denial path |
| Submitting | branch select is local (state + AsyncStorage), no server write; no spinner | password form: button loading, inputs locked (existing) |
| Success | sheet dismisses, card updates immediately, no toast (the change is visible) | password change confirms server-side, refetches session + `me`, returns to Profile |
| Interruption / resume | selection persisted; on next launch it is revalidated against `me` and falls back to the first granted branch | form state is local; leaving discards (existing) |
| Sign-out | `clear()` wipes persisted context (existing) | no separate account state |

## 6. Procedure-to-screen mapping

| Procedure | Screen | Change |
|---|---|---|
| `me.get` | More, Profile | reuse; no new call |
| `academic.year.list` | More (session line) | reuse; expose `yearError` + `refetch` from the provider |
| `school.list` / `school.byId` | — | **not used in A**: `me.memberships[].schools[]` already carries the full school row. Revisit in B only if the management list needs fresher rows than `me`. |
| `academic.year.current` / `byId` | — | **not used**: the year list rows are full rows and `isCurrent` names the session; `current` additionally demands a covered school node and would 403 a section teacher. |
| `school.create/update/deactivate` | B | Branch management, permission-gated |
| `academic.year.create/update/setCurrent` | B | Session management, permission-gated |
| better-auth `changePassword` | Profile -> Change password | add optional `returnTo` (allowlist `/profile`), forced flow unchanged |

## 7. Keyboard, back/dismiss, safe-area, accessibility, platforms

- Sheet: `@expo/ui` `BottomSheetModal` (same component as `section-sheet.tsx`);
  hardware back dismisses the sheet before any navigation; bottom safe-area inset.
- Context rows: `Pressable` with `accessibilityRole="button"`,
  `accessibilityLabel="Branch, Main Campus"`, `accessibilityHint="Opens the branch picker"`;
  non-pressable when there is no choice (no role, no hint, no ripple).
- Sheet options: 48 dp rows, `accessibilityState={{ selected }}`, two-line name
  + secondary code/city line (long trust branch names must not ellipsize to
  ambiguity).
- Profile: permission groups use `accessibilityRole="header"`; the expandable
  control announces expanded/collapsed state.
- Password form: keyboard-safe as built (forced flow); verify with the keyboard
  open at 360x640 before calling it done.
- Android only this slice (iOS parked by owner decision 2026-10-20).

## 8. Layout widths and device targets

- 360x640 at 1.0x and 1.3x text scaling (the attendance standard) - long branch
  names wrap to two lines, the sheet scrolls rather than clipping.
- 390x844 emulator.
- Physical Samsung SM-F415F (Android 12 / SDK 31) for the final walk, same as
  the attendance premium pass.

## 9. Manual / device verification steps

1. Emulator, `teacher@demo-trust.test` (single section): More has no chevron on
   Branch; Profile shows "Class teacher" + "section" + a real permission count.
2. Emulator, `admin@demo-trust.test` (org admin, two branches): switch
   MAIN -> NORTH -> MAIN; after each switch, Home's branch chip, class cards and
   the Attendance tab reflect the new branch; the sheet's checkmark follows.
3. Kill and relaunch the app: the last branch is restored and still valid.
4. Revoke that branch grant server-side, relaunch: context falls back to a
   granted branch (no error screen).
5. Profile -> Change password with a wrong current password: server refusal copy,
   still on the form. With the correct one: returns to Profile, and the forced
   flow (`mustChangePassword`) still routes to `/change-password` first.
6. API stopped: session line shows the retry copy; Retry recovers.
7. TalkBack pass: context rows announce label + hint; sheet options announce
   selected state; password fields keep labels.
8. 360x640 @1.3x: no clipped labels, no unreachable buttons.

## 10. Affected route-parity ledger rows and definition of complete

Ledger row `(dashboard)/`, `/profile`, `/branches`, `/sessions` ->
"Task-led home, organization/branch/year context, profile and account actions".

- Chunk A completes: task-led home (already live), **branch context**, **profile
  and account actions**. `/branches` and `/sessions` **management** remain open
  and move to chunk B, explicitly, not silently.
- The row is only marked complete after chunk B ships and both chunks are
  device-walked.

`docs/MOBILE_PLAN.md` §6.1 procedure table is ticked as each row lands:
`me.get` (already used), `school.list`/`byId` (classified not-needed in A),
`academic.year.list` (A), `school.create/update/deactivate` (B),
`academic.year.create/update/setCurrent` (B).

## 11. Implementation reference register

Pinned versions (from `apps/mobile/package.json`, current tree): Expo SDK
`~57.0.28` · React Native `0.86.3` · React `19.2.3` · expo-router `~57.0.26` ·
`@expo/ui` `~57.0.23` · AsyncStorage `2.2.0` · `@tanstack/react-query` `5.101.2` ·
tRPC `11.18.0` · zod `^4.4.3` · TypeScript `~6.0.3`. No new dependency expected.

Applicable skills (read before coding): `expo-router` (route + push semantics),
`expo-ui` (BottomSheet), `expo-native-ui` (rows, safe area, a11y),
`expo-data-fetching` (refetch/invalidate on context change),
`expo-design-system` (component promotion), `mobile-design` (review).

Docs to re-verify at build time (SDK 57 pages):
Expo Router tabs <https://docs.expo.dev/router/advanced/tabs/> · authentication /
protected routes <https://docs.expo.dev/router/advanced/authentication/> ·
`@expo/ui` <https://docs.expo.dev/versions/latest/sdk/ui/> · AsyncStorage
<https://react-native-async-storage.github.io/async-storage/docs/api/> · RN
accessibility <https://reactnative.dev/docs/accessibility> · TanStack Query on
React Native <https://tanstack.com/query/latest/docs/framework/react/react-native> ·
better-auth change password
<https://www.better-auth.com/docs/concepts/users-accounts#change-password>.

Web references are behavior parity only, never layout: `apps/web/src/app/
(dashboard)/profile/page.tsx` (roles/scopes/permission count),
`apps/web/src/features/session/active-context.tsx` (context revalidation),
`apps/web/src/features/branches/*` and `features/sessions/*` (chunk B).

## 12. Proof plan for uncertain native behavior

1. **Bottom sheet** - already proven in the attendance slice (section/day
   sheets); reuse the same component and dismiss semantics, no new spike.
2. **Back stack after a voluntary password change** - `router.replace("/profile")`
   from a screen entered as `/change-password?returnTo=/profile`; verify the
   back gesture returns to Profile once, not to a loop.
3. **Context switch invalidation** - TanStack keys already include `schoolId`;
   verify no screen keeps showing the old branch after a switch (Home cards,
   Attendance sections, year line). If one does, its query key is the bug, not
   a manual `invalidate` patch.
4. **AsyncStorage key sweep** - sign-out must clear the branch key (existing);
   confirm the new profile/password paths do not need a key.

---

## Chunk B (next): branch + session management

Entry: More -> "Manage" section, visible only with a management permission
hint. Two pushed screens.

- **Branches** (`(staff)/branches`): list from `school.list` (active only by
  default; "show closed" toggle if the API returns them), create/edit form
  (name, legal name, code, board, city, phone, email; the rest optional),
  deactivate behind a consequence confirm ("Students, payments and results keep
  their records; the branch stops appearing in lists"). Gates: create
  `school:create`, edit `school:update`, deactivate `school:delete`. After any
  write: invalidate `me.get` + `school.list`; if the active branch was closed,
  select another granted branch or clear context.
- **Sessions** (`(staff)/sessions`): list from `academic.year.list`, create
  (name + start/end dates; the web offers a start-year shortcut and
  `sessionFromStartYear`), edit, and "Make current" behind a confirm that says
  what it changes ("every current-only screen starts reading this session").
  Gates: `academic_year:create`, `academic_year:update`. After a write:
  invalidate `academic.year.list` (and `me.get` if `isCurrent` is surfaced
  there).
- Terms stay in Step 2 (`term.*`), not here - the web's sessions page embeds
  them, but the plan assigns them to Step 2.

## Open questions (decided or escalated, never silent)

1. **Session switching - decided 2026-10-23: no global switcher.** The app works
   in the current session; history is a per-surface selector on read screens;
   changing the session is an admin action with a confirm. Why: a global past
   year would make Home's "Today" register meaningless (`todayIso()` is not in
   that session) and would add a mode every future screen must handle. **Written
   up as ADR-047 when the slice closed.**
2. **Permission list on Profile** - full grouped list (recommended, answers
   "why can't I see fees?") vs parity's count-only. **Decided: the full list.**
   Walked with 134 permissions (org admin) and 26 (subject teacher); collapsed
   by default, groups are the scan target.
3. **Org-scope "all branches"** - the context requires a branch (the plan says
   org -> branch -> year), so an org-scoped admin still picks one. **Kept**; no
   mobile screen needs a trust-wide roll-up yet.
4. **Branch rows for org-scoped admins** - **confirmed on device**: both MAIN
   and NORTH appear for `admin@demo-trust.test`, with code + city as the
   secondary line.

## Walk record (2026-10-23, emulator-5554)

Environment: AVD `mskool-dev` (API 34, 1080x2400 @420 -> 411x914 dp), Metro
:8081 started with `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000` (emulator host
alias; the owner's `.env.local` was not edited), API :4000 against the seeded
demo trust. Screenshots and hierarchy dumps in `apps/mobile/.expo/walk/`
(`a*`-`e*`, gitignored).

1. **Admin** (`admin@demo-trust.test`) - More shows identity, Branch
   `Demo Public School - Main Campus`, Session `2025-26` as a label (no
   chevron) and the Profile row. The sheet is `CHOOSE BRANCH` with both
   branches (`MAIN - Kolkata` / `NORTH - Kolkata`, checkmark on the current).
   Selecting North re-resolves the row and the session; Home's branch chip and
   class card change (different section id); Attendance re-resolves its
   section; switching back restores Main.
2. **Persistence** - force-stop + relaunch reopens Home on North Campus: the
   persisted id is revalidated against `me` and kept.
3. **Profile (admin)** - Organization `Demo Trust`, roles pill `Org admin`,
   scopes `Organization`, toggle `134 permissions`; expanding groups
   Academic year -> Student fee assignment; collapsing works.
4. **Voluntary password** - opens from Profile with a back row; mismatch is
   caught locally; a wrong current password says "That current password doesn't
   match. Check it and try again."; a valid change (same password, to keep the
   demo credentials) showed the "Password changed" confirmation and popped back
   to the Profile already in the stack. Forced mode is unchanged (no back
   control, success returns to the shell root).
5. **Teacher** (`subject-teacher@demo-trust.test`) - Branch is a fact (no
   chevron, not tappable), Session `2025-26`, Profile `Subject teacher` /
   `Section` / 26 permissions reading cleanly; the attendance section sheet
   still works through the shared `ChoiceSheet` (one section, checkmarked).
6. **Sizes** - 411x914 default; 360x640 (1080x1920 @480) at 1.0x and 1.3x
   system font: More fits without scrolling, Profile scrolls, no clipped
   controls, tab labels hold their height.

**Findings fixed in this chunk** (all re-walked):

- `ScreenFrame` had no bottom safe-area inset: the last row of a long Profile
  scroll ended under the gesture bar (content reached y=2400 on a 2400 px
  screen). It now pads by `insets.bottom + spacing.xl`; `ManageFrame` keeps its
  tab-bar space.
- Long values and sheet options ellipsized on one line. `FactRow` values and
  `ChoiceSheet` labels now take two lines, so "Demo Public School - North
  Campus" is never abbreviated into ambiguity.
- `FactRow`'s non-pressable variant silently dropped its `testID`; both
  variants carry it now.
- The password screen was bare RN controls on a chart-less frame. It now uses
  `ScreenFrame` + `Card` + `ThemedText` + `CapsuleButton`, and drops the back
  control in the forced flow where there is nowhere legitimate to go.

**Not force-tested on device (recorded, not assumed):** the session-retry row
(needs `me.get` to succeed while `academic.year.list` fails - a narrow window
with the org-wide cached query; copy and `refetch` are wired and type-checked)
and a server-side grant revocation (the provider revalidates on every new
session; the fallback is the same path the relaunch exercised). TalkBack was
verified from the hierarchy labels, not by ear.

## Commit plan (prepared for owner - commit, do not push)

Three commits, each independently type-checking. Owner-local edits
(`apps/api/src/env.ts`, `apps/web/src/lib/*`, `rough.md`, `skills-lock.json`,
`.zcodeignore`, `packages/db/query-tmp.mjs`) are NOT part of any of them.

1. `feat(mobile): branch switcher, profile and access`
   - `apps/mobile/src/hooks/use-active-context.tsx` (branches, year error/retry,
     org-wide year query filtered by branch)
   - `apps/mobile/src/components/choice-sheet.tsx` (new; generic single-select
     sheet)
   - `apps/mobile/src/components/fact-row.tsx` (new; label/value + tappable
     variant)
   - `apps/mobile/src/components/link-row.tsx` (new; destination row)
   - `apps/mobile/src/components/screen-frame.tsx` (new; back row, title, meta,
     body, bottom inset)
   - `apps/mobile/src/screens/staff-attendance/section-sheet.tsx` (thin wrapper
     over `ChoiceSheet`, same `section-option-*` ids)
   - `apps/mobile/src/screens/staff-attendance/manage/frame.tsx` (delegates to
     `ScreenFrame`, keeps `manage-back`)
   - `apps/mobile/src/screens/more/index.tsx`
   - `apps/mobile/src/screens/profile/index.tsx` (new)
   - `apps/mobile/src/screens/profile/permissions.ts` + `.test.ts` (new)
   - `apps/mobile/src/app/(staff)/profile.tsx` (new route)
   - `apps/mobile/src/lib/copy.ts` (all new strings; the password keys land here
     so commit 1 type-checks on its own)

2. `feat(mobile): voluntary password change returns to the profile`
   - `apps/mobile/src/app/(auth)/change-password.tsx` (two entries, back control
     only when voluntary, success confirm, `returnTo` allowlist, wrong-current
     copy, design-system restyle)

3. `docs: mobile step 1 chunk A record - ADR-047/048, ledger ticks, walk`
   - `docs/DECISIONS.md` (ADR-047, ADR-048, ADR-043 §8 amended)
   - `docs/MOBILE_PLAN.md` (step table, §6.1 procedure table, parity row)
   - `docs/TASKS.md` (resume entry)
   - `.kilo/plans/2026-10-23-mobile-step1-context-profile.md` (new)

Gates before each commit: `pnpm check-types`, `pnpm test` (mobile suite),
`pnpm lint`, plus the device walk for the UI commit. Chunk B lands as its own
feature commit(s) with the same gates.
