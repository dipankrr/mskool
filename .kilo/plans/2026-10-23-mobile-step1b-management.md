# Mobile Step 1 chunk B - branch and session management (with design-quality pass)

Date: 2026-10-23. Status: planned before feature UI. Implements the chunk-B
remainder of `docs/MOBILE_PLAN.md` §6.1 and closes the Step 1 parity row.

Owner direction for this chunk: "the UI/UX/design quality has reduced, try to
improve it. use icons where needed." That is part of the slice, not a later
polish pass.

Chunk A (branch switcher, profile/access, voluntary password) is committed
locally (`0801d6e`, `18a1a97`, `26f7df4`) and not pushed. This chunk builds on
it and does not reopen ADR-047 (no global year picker) or ADR-048 (types-only
imports; the server is the only validator).

---

## 1. What quality dropped, and the response

The Step 1 screens are correct but read like a settings dump:

1. **More has no hierarchy.** Identity, two context rows, profile and sign out
   are four equally weighted things in two identical white cards. Nothing says
   what is workspace, what is management, and what is the account.
2. **No scanning anchors.** Only the profile row has an icon. A branch, a
   session, a permission set and a password are all the same grey line.
3. **Profile mixes value, chips and a disclosure in one stack.** Roles, scopes
   and the permission toggle have no common anatomy, so the eye cannot tell
   where one block ends.
4. **There is no list anatomy.** Chunk B needs branch and session lists; a
   plain `FactRow` stack would make two very different entities look alike.
5. **The frame has nowhere for a screen action.** A create action would become
   an orphan button at the bottom of a list, or a floating action that fights
   the probe's "one CTA per screen".
6. **Form controls live inside attendance manage.** `Field`, the native time
   picker and the segmented control were built for one screen. Copying them
   into branch/session forms would fork the same anatomy; importing across
   screen folders would make attendance the owner of a shared control.

The pass fixes these with a small, reusable vocabulary rather than decoration:

- **Grouped sections with uppercase labels** on More: Workspace, Manage,
  Account. Profile gets Account and Your access.
- **Tinted icon tiles** at three sizes (40 card, 32 row, 28 detail header).
  Accent tint = a destination or the live choice; neutral field = information.
  Icons are semantic and decorative; the row's label carries the meaning.
- **`EntityCard`** for branch/session lists: icon tile, strong name, one meta
  line, optional status capsule, optional chevron. Content, not a table row.
- **Header action** in `ScreenFrame`: a compact tinted pill with a plus icon,
  reachable in the top-right of a list. It is 38 pt visual with a 48 pt hit
  floor, matching the app's touch rules.
- **One shared form anatomy**: `FormField`, `SelectField`, `DateField`,
  `ChoicePills`, `Notice`, plus a sticky `ScreenFrame` footer for Save. Field
  errors replace help text; form-level errors live beside the Save button so a
  failure is never off-screen.
- **Native pickers and real dates**: branch board is a bottom-sheet select;
  session dates open the platform date picker; the start-year shortcut fills
  the name and 1 April / 31 March dates, and the fields stay editable.
- **Friendly ranges** (`1 Apr 2026 – 31 Mar 2027`) instead of slash dates on
  entity cards; slash dates remain inside pickers where the locale expects
  them.

The rule stays: no gradient, no second accent, no icon-only control without a
label, no success toast before the server confirms.

---

## 2. Actor, permissions and screen scope

Primary: an **org admin** onboards a branch, edits its contact details, and
closes a wrong one. Secondary: a **principal** adds a session and moves the
running session at year change. A teacher sees no Manage section.

Gates are permission strings from `me.get` only (ADR-044). Role names never
gate; they are labels.

| Need | Permission | Default holder | Notes |
|---|---|---|---|
| Manage section in More | `school:read` + any of `school:create/update/delete`; or `academic_year:read` + any of `academic_year:create/update` | org admin, principal (sessions) | A principal sees Branches because she has `school:update`; she sees no Add/Close |
| Branch list | `school:read` | all staff (ADR-044) | `school.list` is active-only and scope-filtered |
| Branch create | `school:create` | org admin | No principal |
| Branch edit | `school:update` | org admin, principal | Principal can edit her branch |
| Branch close | `school:delete` | org admin | Consequence confirm; never delete |
| Session list | `academic_year:read` | teaching/admin roles | History rows only with `academic_year:read_history` (server) |
| Session create | `academic_year:create` | org admin, principal | Always for the active branch |
| Session edit / make running | `academic_year:update` | org admin, principal | Confirm on the running transition |

Every screen re-checks its own permission if reached by deep link. A hidden
row is navigation behaviour, never enforcement.

No active branch: Branches is org-level and still works. Sessions needs a
branch, so it renders an honest "choose a branch" state instead of firing a
request that cannot succeed.

---

## 3. Journeys and wireflow

```
More (tab)
  identity card        avatar · name · email · role pills
  WORKSPACE
    Branch    Demo Public School - Main Campus   [chevron if >1]
    Session   2025-26                            [retry only on error]
  MANAGE                 (only with a write hint)
    Branches   Schools, codes and contacts          -> /branches
    Sessions   Academic years and the running one   -> /sessions
  ACCOUNT
    Profile and access   Roles, scopes and permissions -> /profile
    Sign out

/branches (pushed above the tabs)
  [back]                                   [+ Add branch]
  Branches
  Demo Trust
    [building] Demo Public School - Main Campus   [Current]
               MAIN · CBSE · Kolkata
    [building] Demo Public School - North Campus
               NORTH · CBSE · Kolkata
  empty: "No branches yet" + Add branch
  read-only: no +, cards not pressable

/branch-form?id=… (pushed)
  [back]
  Edit branch
  The basics   Name · Registered name · Code · Board (sheet)
  Contact      Phone · Email · City · State · Pincode
  Records      UDISE code
  Close this branch  [notice] [Close branch]      (school:delete only)
  ---------------- sticky footer ----------------
  [saved error, if any]  [ Save branch ]

/sessions (pushed)
  [back]                                   [+ Add session]
  Sessions
  Demo Public School - Main Campus
  RUNNING SESSION
    [calendar] 2025-26   [Running]
               1 Apr 2025 – 31 Mar 2026
  PAST SESSIONS · 1
    [calendar] 2024-25
               1 Apr 2024 – 31 Mar 2025
  (notice when the caller cannot read history)
  (caution when no session is running)

/session-form?id=… (new)
  [back]
  Add a session
  START YEAR
    2027-28   2026-27   2025-26 (Already added)
  DATES
  Name · Starts on · Ends on   (native pickers)
  ---------------- sticky footer ----------------
  [saved error, if any]  [ Add session ]

/session-form?id=… (edit)
  Edit session
  Running session block: [Make this the running session] (confirm)
  ---------------- sticky footer ----------------
  [ Save session ]
```

Navigation: list → form via `router.push`; success → `router.back()` when the
list is in the stack, else `router.replace` the list. The form never dismisses
before the server confirms.

---

## 4. Screen content and data

| # | Screen | Route | Query / mutation |
|---|---|---|---|
| 1 | More (restructured) | `(staff)/(tabs)/more` | `me.get`, `academic.year.list` (existing context) |
| 2 | Branches | `(staff)/branches` | `school.list` |
| 3 | Branch form | `(staff)/branch-form?id=` | `school.byId`; `school.create/update/deactivate` |
| 4 | Sessions | `(staff)/sessions` | `academic.year.list` (same key as the context provider) |
| 5 | Session form | `(staff)/session-form?id=` | `academic.year.byId`; `academic.year.create/update/setCurrent` |
| 6 | Profile (restyle) | `(staff)/profile` | `me.get` (existing) |

Real sample content: Demo Trust / Main Campus (MAIN, CBSE, Kolkata) /
North Campus (NORTH, CBSE, Kolkata) / sessions 2025-26 running and 2024-25
past. Session create preselects `2026-27` on 2026-10-23; 2025-26 is marked
"Already added".

`school.list` returns active branches only, so there is no closed-branch
toggle: closing is one-way in this UI and the copy says so. `school.byId` is
the edit form's truth (reload/deep link), not the list cache. Same for
`academic.year.byId`.

Session rows are the org-wide list filtered by the active `schoolId`; the
query key is identical to the provider's so a `setCurrent` invalidates both.
Create sends the active `schoolId` explicitly.

Invalidation:

- branch write -> `school.list` + `me.get`; if the active branch was closed,
  `me.get` revalidation makes `ActiveContextProvider` fall back to a granted
  branch. Await both before navigating so More cannot flash a closed branch.
- session write -> `academic.year.list`; the context's current year follows
  from the same cache entry.

---

## 5. State and recovery matrix

| State | List | Form |
|---|---|---|
| Loading | 3 skeleton cards; title and back are real | Edit: skeleton fields; create: fields immediately |
| Empty | Branches: "No branches yet" + Add. Sessions: "No session yet" + Add | n/a |
| No branch | Branches unaffected; Sessions shows "Choose a branch first" (back to More) | create is unreachable without a branch |
| Error | `ErrorCard` with Retry + pull-to-refresh | Fetch error for edit -> `ErrorCard`; mutation error -> red `Notice` above Save |
| Offline | same as error, network copy; cached rows stay readable | save fails now, never queued; input preserved |
| Denied | no read -> `EmptyState` shield, no query; read-only -> list without add/edit affordances | no update (and no delete for branch) -> denied state, not a dead form |
| Partial permission | branch list with `school:delete` only -> row opens a read-only detail with Close | branch edit without update shows values read-only |
| Submitting | n/a | Save loading + disabled, fields stay visible and editable except during the call; back is guarded |
| Success | row appears/changes/disappears after the awaited invalidation; no toast | server confirms -> return to list; the changed row is the feedback |
| Unsaved work | n/a | `beforeRemove` guard: "Discard changes?" Keep editing / Discard |
| App resume | pull-to-refresh is available; lists refetch on invalidate | form state is local and survives backgrounding |
| Large text | cards wrap to two lines; pills wrap; row grows | labels wrap, footer button grows, pickers native |

No state shows success before the server answers.

---

## 6. Component vocabulary (new or extended)

- `components/app-icon.tsx`: add `branches`, `sessions`, `manage`, `profileCard`,
  `shield`, `key`, `logout`, `add`, `warning`, `stack`, `lock`. All names
  compile-checked against the installed SF Symbols / Material sets.
- `components/screen-frame.tsx`: header action (icon + label + 48 pt target);
  optional `footer` (sticky, safe-area padded) and `onRefresh`/`refreshing`
  for lists. Content bottom padding yields to the footer.
- `components/entity-card.tsx`: surface card with 40 pt tinted tile, two-line
  title, two-line meta, optional `StatusPill`, `emphasis` accent/neutral,
  optional press + chevron.
- `components/fact-row.tsx`: optional leading icon tile (32), unchanged
  label/value/chevron semantics.
- `components/link-row.tsx`: icon tile aligned to the shared 32 pt size.
- `components/capsule-button.tsx`: optional leading icon; loading still shows
  the spinner.
- `components/form-field.tsx`: promoted from attendance manage; adds
  `autoCapitalize`, `autoCorrect`, `keyboardType` variants and `onBlur`; the
  attendance `field.tsx` becomes a re-export, so existing call sites are
  untouched.
- `components/select-field.tsx`: a filled field that opens a `ChoiceSheet`;
  used for board.
- `components/date-field.tsx`: native `@expo/ui` date picker (Android dialog,
  iOS inline + Done), ISO in/out, `minimumDate`/`maximumDate`, help/error.
- `components/choice-pills.tsx`: wrap-friendly single-choice pills with
  optional disabled state and caption.
- `components/notice.tsx`: tinted icon + text notice (neutral/caution/critical),
  announced politely when critical.
- `components/status-pill.tsx`: reused for role/scope chips and "Current" /
  "Running"; no new pill component.
- `lib/labels.ts`: shared `roleLabel`, `scopeLabel`; Profile and More use it.
- `hooks/use-active-context.tsx`: `useActiveOrganizationName`.
- `lib/format.ts`: `formatReadableDate`, `formatReadableDateRange`,
  `isoToLocalDate`, `localDateToIso`; keep the no-UTC-round-trip rule.
- `lib/session-dates.ts`: `sessionFromStartYear`,
  `currentSessionStartYear`, `sessionStartYearOptions` (pure, tested), mirroring
  web's behaviour.
- `hooks/use-unsaved-changes.ts`: a `beforeRemove` guard for the two forms.

Field interaction: label above a filled box; error replaces help; submit marks
all fields; blur marks one. The footer summary uses `copy.errors.invalid` when
local errors remain.

---

## 7. Copy and wording

New mobile copy namespaces (no literals in screens):

- `more.workspace/manage/account`, `more.branches(+Detail/Hint)`,
  `more.sessions(+Detail/Hint)`.
- `branches.*`: title, add/edit, empty, current, open hint, fields + help,
  boards (from web), section labels, close title/body/confirm/hint, errors
  (name, legal name, code, email, phone, pincode, UDISE, duplicate code).
- `sessions.*`: title, add/edit, empty, running/past labels, no-current
  caution, history-hidden notice, fields + help, already-added, save, make
  running + confirm, errors (name, date order, overlap, conflict), open hint.
- `forms.*`: optional, discard title/body, keep editing, discard, back.
- `denied.*`: no-read and no-write states per surface.

Close copy states consequences, not a generic "Are you sure?":
"Staff will no longer work in it and it leaves the branch list. Nothing is
deleted — students, payments and results stay exactly as they are. If it is
the branch you are using, the app switches to another one."

Make-running copy states what changes:
"Every colleague's default view changes to this session. The one running now
becomes a past session. Nothing is deleted, and you can switch back."

---

## 8. Accessibility, sizes and platforms

- Whole cards/rows are the targets (≥56), chevrons are decorative; pills inside
  rows are visual. Pressable content is one announcement: name, meta, status.
- "Current"/"Running" is announced as status, not inferred from colour.
- Header action: 38 pt visual, 48 pt hit floor, label included.
- Pills: `accessibilityRole="radio"` + selected/disabled state; group label.
- Date field announces label + chosen date + "opens the date picker".
- Critical notice uses `accessibilityLiveRegion="polite"`.
- Keyboard: `ScreenFrame` already wraps in `KeyboardAvoidingView`; the sticky
  footer rides above the keyboard. Verify phone/email focus and Save at
  360x640.
- 411x914 emulator, 360x640 at 1.0x and 1.3x; Android first (iOS parked
  2026-10-20). No web layout, no table, no DOM control.

---

## 9. Verification

Unit (Jest):

- `screens/branches/branch-form.test.ts`: defaults, row→form (nulls → empty),
  required fields, code normalisation/format, email/phone/pincode/UDISE,
  payload omits empty optionals and uppercases code.
- `screens/sessions/session-form.test.ts`: start-year boundaries (Jan–Mar),
  preset name/dates, options newest-first + already-added flag, name/date
  validation, inclusive overlap (self excluded), payload.
- `lib/format.test.ts`: readable date/range, ISO↔local round-trip across month
  and year ends.
- Existing suites stay green.

Gates: `pnpm check-types`, `pnpm test`, `pnpm lint`.

Device walk:

1. Admin: More shows Workspace / Manage / Account, identity roles, both manage
   rows; Branches list marks Main current; create "Walk Campus" (code WALK),
   edit its phone, reopen from the list; close it with the consequence confirm
   and confirm it disappears. Do not close a seeded branch.
2. Admin sessions: create 2026-27 for Main (preset fills name/dates), edit the
   end date; make it running, confirm, see Home's session line follow; make
   2025-26 running again. Check the "history" list and running group.
3. Principal: Manage shows Branches and Sessions; Branches has no Add and no
   Close; Sessions has Add and Make running (default `academic_year:create/update`).
4. Teacher: no Manage section; direct/deep route denial is code-verified (the
   screen gate is the same `has` check used by the tab).
5. Failure: stop the API mid-form save -> footer notice with network copy and
   input preserved; list error -> Retry + pull-to-refresh recovers.
6. Unsaved guard: back from a dirty form -> alert; keep editing keeps values;
   discard leaves.
7. Sizes: 411x914 and 360x640 at 1.0x and 1.3x; long branch names wrap; board
   sheet scrolls; footer remains reachable with the keyboard open.
8. TalkBack labels read from the hierarchy dump (images unavailable to the
   agent): card status, header action, pill selection, error live region.

Screenshots + hierarchy dumps go to the ignored `apps/mobile/.expo/walk/`; the
owner reviews the rendered screens.

---

## 10. Docs, ledger and definition of done

- `docs/MOBILE_PLAN.md`: Step 1 status "complete" after the walk; §6.1 ticks
  `school.list/byId`, `academic.year.byId`, `school.create/update/deactivate`,
  `academic.year.create/update/setCurrent`; parity row for
  `(dashboard)/ /profile /branches /sessions` marked complete with the chunk-B
  journey.
- `docs/TASKS.md`: resume entry rewritten for Step 1 complete, next Step 2
  (students + academic setup), with the walk/gates/commit list.
- This plan: walk record + findings fixed.
- No new ADR: ADR-047 already fixes the session-change rule and ADR-044 the
  permission gating. The design vocabulary is recorded here and in the code.

Done means: both screens live natively, permission-gated, all states handled,
forms keyboard-safe, the walk above recorded, three gates green, docs updated.

---

## 11. Commit plan (prepare only; the owner commits)

Four commits, each type-checks standalone. `More`'s redesign (grouped
Workspace/Manage/Account, role pills, both Manage rows) lands with the sessions
commit because its rows push `/branches` and `/sessions`; until then the branch
screens are reachable by deep link only.

1. `feat(mobile): design-system vocabulary for management screens`
   `components/`: app-icon, capsule-button, choice-pills*, date-field*,
   entity-card*, fact-row, form-field*, icon-tile*, link-row, notice*,
   screen-frame, select-field*; `hooks/`: use-active-context,
   use-unsaved-changes*; `lib/`: copy, format (+test), labels*, session-dates*;
   `screens/profile/index.tsx` (identity pills, IconTile blocks);
   `screens/staff-attendance/manage/field.tsx` (promoted onto shared
   FormField). (* = new)
2. `feat(mobile): branch management`
   `package.json` + `pnpm-lock.yaml` (`@repo/contracts` type-only, ADR-048),
   `app/(staff)/branches.tsx` + `branch-form.tsx`, `screens/branches/`
   (index, form, branch-form.ts + test).
3. `feat(mobile): session management and the More manage hub`
   `app/(staff)/sessions.tsx` + `session-form.tsx`, `screens/sessions/`
   (index, form, session-form.ts + test), `screens/more/index.tsx`
   (Workspace/Manage/Account groups, role pills, Manage rows, icons).
4. `docs: mobile step 1 chunk B record - walk, ledger, resume`
   MOBILE_PLAN Step 1 status + parity ledger + §6.1 table, TASKS resume entry,
   this plan (§11/§12).

Owner-local edits (`apps/api/src/env.ts`, `apps/web/src/lib/*`, `rough.md`,
`skills-lock.json`, `.zcodeignore`, `packages/db/query-tmp.mjs`) stay out.

---

## 12. Walk record (2026-10-23, emulator-5554)

Environment: dev client via `mskool://expo-development-client/…`, Metro :8081,
API :4000. Sizes walked: 411×914 (default) and 360×640 (`wm size 1080x1920`,
`wm density 480`) at font scales 1.0 and 1.3. Maestro flows drove the happy
paths (`b1`–`b8`, `c1`), with manual adb taps where a flow failed on emulator
quirks, not app bugs. Captures + hierarchy dumps in the ignored
`apps/mobile/.expo/walk/` (`b01`–`b40`, `c01`–`c17`).

Admin (org admin): More shows identity with role pills and Workspace / Manage /
Account; Branches list marks Main "Current"; created "Walk Campus" (code WALK),
edited its phone, reopened from the list — the phone persisted; closed it via
the consequence confirm and it left the active-only list. Sessions: created
`2026-27` for Main from the 2026 preset (name + 1 Apr–31 Mar filled, dates
editable), edited the end date to 30 Mar 2027 through the native date picker,
"Make this the running session" behind its confirm; More's session row showed
`2026-27` after returning; then restored `2025-26` the same way. Running group
vs "Other sessions" and the Running / Not running / Past pills verified.

Principal: Manage shows Branches and Sessions; Branches has no Add and its edit
form no Close; Sessions has Add and the edit screen has Make running (default
`academic_year:create/update`, no `school:create/delete`).

Teacher (`teacher@demo-trust.test`, read-only): More has no Manage section;
`/branches` and `/sessions` render read-only lists; `/sessions` shows only the
running year plus the "Older sessions are hidden" notice; deep links to
`/branch-form` and `/session-form` render the permission-denial screens.

Failure paths: with `10.0.2.2:4000` blocked via iptables, the Branches list and
the session edit form showed the Retry error card and recovered on Retry; a
branch create submitted offline kept every field and showed the footer save
error, then saved successfully after unblocking. The unsaved-changes guard
fired on back from a dirty session form; "Keep editing" stayed, "Discard"
left. No success toast anywhere; returning to the updated list is the feedback.

Findings fixed during the walk:

1. **Stale form on reopen (real bug, both forms).** Reopening an edited branch
   showed the pre-edit phone; the session form did the same with dates. Cause:
   `byId` was cached across opens, and stale-while-revalidate mounted the form
   body from the cached row before the background refetch landed (the body
   initialises its state once). First tried writing the mutation result into
   the cache (`setData`) — reverted: the invalidation still races the mount.
   Fix: `gcTime: 0` on both forms' `byId` queries so every open is a fresh
   read; a form is a snapshot, not a live view.
2. **Permission string leaked into teacher copy.** The session write-denial
   body said "needs the academic_year:update permission"; now "Adding or
   changing a session needs a session management permission." (Gate stays the
   permission check; only the words changed.)

Observations, no code change: at 360×640 / 1.3× the floating tab bar covers
the last visible More row until the list scrolls, but the bottom padding lets
every row (sign-out included) clear the bar at max scroll — scroll, not bug.
At 1.3× the branch list's long names wrap to two lines beside the status pill,
session date ranges wrap under the pill, and both forms scroll every field
above the sticky save footer. A non-current year containing today reads "Not
running" (2026-27 before promotion) — intended.

Fixture after the walk: Main has `2025-26` running, `2026-27` (1 Apr 2026 –
30 Mar 2027) added but not running; "Walk Campus" and "Offline Campus" are
closed — the fixture now contains inactive school rows. Do not re-close seeded
branches; the close path is one-way in this UI.

Gates after the fixes: `pnpm check-types` 9/9, `pnpm test` (18 suites / 181
tests), `pnpm lint` 0 errors. Display restored (`wm size/density reset`,
`font_scale 1.0`) and the app relaunched healthy.
