# Mobile plan

One Expo binary, the whole admin surface first, the family surface after.
Steps are **build order, not scope cuts** — every step accumulates toward full
coverage and nothing in a backend namespace is left behind. Architecture:
ADR-043. Conventions: `docs/CONVENTIONS.md` → "Mobile client conventions".
Slice plans: `.kilo/plans/<ts>-mobile-<step>.md`, written just before each
step. Status mirror: `docs/TASKS.md` resume-here (one line per domain).

The API inventory below is verified against `packages/trpc/src/routers/*`
(~233 tRPC procedures total — procedures, not REST endpoints; tRPC-over-HTTP
is the only transport). Each domain table classifies its rows: a journey
screen consumes it, an in-flow action/panel uses it, or it is deliberately
deferred to a named later step. Unticked, unclassified rows are the resume
point — coverage means every user requirement and its necessary API behavior
is accounted for, not one screen per procedure.

## 0. Plan validation and completion rules (2026-10-13)

This plan is the build order for the product's mobile surfaces, not a promise
that every feature already has an API. Staff workflows ship first; family
workflows ship only after staff parity is closed. Before calling the app
feature-complete, reconcile this inventory against both the product scope in
`docs/PRD.md` and every staff route in `apps/web/src/app/(dashboard)`. Record each
workflow as mobile complete, explicitly deferred with an owner decision, or
blocked on backend work. **Owner-approved scope deferral (2026-10-13): do not
build the public-site editor or its admin preview in the mobile app now.** The
`publicSite` procedures and web routes remain available on web; they are not
part of current mobile parity and must not block the family phase. Public
visitor websites also remain web surfaces.

The counts in the phase table are planning estimates, not a coverage proof.
The canonical inventory is the exported tRPC router tree under
`packages/trpc/src/routers/`; `check:openapi` checks the REST projection and
metadata, but cannot prove that every tRPC procedure or user workflow has a
mobile surface. Before each phase, reconcile its procedure list against the
router and update the table if the API changed.

**Client-safe runtime boundary (step 0 blocker).** `@repo/contracts` currently
exports Drizzle-derived schemas and depends on `@repo/db` and `drizzle-zod`.
The mobile plan proposes using those schemas at runtime in RHF, which risks
pulling database/Drizzle modules into Metro's native bundle. Before runtime
imports from contracts, inspect the actual import graph and prove an Expo
export contains no server/database modules. If it does, extract only the
client-safe Zod input schemas into a dedicated client-safe entry/package (no
`@repo/db`, Drizzle, Node APIs, or server env); keep router output types
type-only from `@repo/trpc`. Do not import `@repo/trpc` at runtime. This
preserves the type chain without shipping server code to phones.

**Version pin and navigation decision (step 0).** Pick and lock the Expo SDK
using the official SDK compatibility table when scaffolding; install Expo
native packages with `expo install` and commit the lockfile. The native-tabs
import is version-specific: Expo documents
`expo-router/unstable-native-tabs` for SDK 54–57 and
`expo-router/native-tabs` from SDK 58. Keep native tabs as a spike decision,
with Expo Router's supported JS tabs as the fallback if the native API is
still unstable or misses required accessibility/navigation behavior. Never
ship an unstable import merely because it appears in an older plan.

**Production readiness is a release gate, not a feature phase.** Before a
pilot/store build, define dev/preview/production API origins, app identifiers,
signing and EAS build profiles, runtime-version/update-channel policy,
crash/error reporting, privacy disclosures, and a rollback path. Native
dependency changes require compatible new binaries; OTA updates must follow
the chosen runtime-version policy. Keep these out of the initial auth spike,
but do not defer them past the first external pilot.

**Verification scope.** This plan specifies the proposed QA bar for
implementation; each implementation task still follows its requested scope
and repository gates. This planning review did not add or run tests. Verify
interactive behavior on both platforms; Android is the first real-device gate,
and iOS device/simulator verification is required before release. Use a
development build for project QA; Expo Go is only for quick exploration and
must not be treated as release or native-runtime verification.

**Required slice-plan template (no code before this is filled).** Each
`.kilo/plans/<date>-mobile-<slice>.md` must contain, in order: (1) persona,
role/permission and context; (2) one measurable task outcome; (3) entry-to-done
journey and wireflow; (4) screen list with hierarchy and realistic sample
content; (5) state/recovery table (loading, empty, error, offline, denied,
submitting, success, interruption/resume); (6) procedure-to-screen mapping;
(7) keyboard, back/dismiss, safe-area, accessibility and platform differences;
(8) layout widths/device targets; (9) manual/device verification steps;
(10) affected route-ledger rows and definition of complete; (11) an
implementation reference register with pinned Expo SDK/RN/package versions,
applicable skill names, version-matched official Expo/RN/platform docs, and
maintainer docs for third-party libraries; and (12) a proof plan for
uncertain native behavior. If any item is unknown, mark it as an open
question before implementation. A list of API calls or web screenshots does
not satisfy this gate.

**Evidence-first implementation rule.** At coding time, verify each API,
navigation pattern, native capability, and package setup against the docs for
the pinned SDK—not an unversioned snippet, agent memory, or old tutorial.
Prefer official Expo/React Native/platform documentation, then the
maintainer's documentation for the exact library version. Skills are
required when relevant and guide workflow/design/performance; they do not
override current platform docs. Record a doc link and version in the slice
reference register. If documentation disagrees or leaves a production-critical
behavior unclear, mark it open and build a minimal spike or test before using
the pattern in a feature. Use Expo's compatibility-aware install command via
the repo's package manager (`pnpm exec expo install` from `apps/mobile`) and
verify the resolved dependency set against the pinned SDK.

**Definition of a complete mobile workflow.** It has a native interaction
design, real API data, all relevant states and recovery, permission enforcement
on the server, no lost or duplicated writes, accessible controls, and a
reviewed device walk. Update the route parity ledger only after those checks;
do not mark complete because a route renders, a mock works, or a query returns
data. For money, identity, publishing and result-release flows, walkthroughs
must include a refusal/failure path as well as the happy path.

**Official references checked for this review:** [Expo monorepos](https://docs.expo.dev/guides/monorepos/),
[Expo Router native tabs](https://docs.expo.dev/router/advanced/native-tabs/),
[Expo Router authentication](https://docs.expo.dev/router/advanced/authentication/),
[Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/),
[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/),
[EAS runtime versions](https://docs.expo.dev/eas-update/runtime-versions/),
[Expo Doctor](https://docs.expo.dev/develop/tools/),
and [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo).
The implementation reference set also includes [Expo unit testing](https://docs.expo.dev/develop/unit-testing/),
[Expo Router testing](https://docs.expo.dev/router/reference/testing/),
[React Native list performance](https://reactnative.dev/docs/optimizing-flatlist-configuration),
and [FlashList v2](https://shopify.github.io/flash-list/docs/),
[TanStack Query React Native](https://tanstack.com/query/latest/docs/framework/react/react-native),
and [EAS with monorepos](https://docs.expo.dev/build-reference/build-with-monorepos/). Expo's
[development-build guidance](https://docs.expo.dev/develop/development-builds/)
is the project baseline; Expo Go is only for quick exploration.
Recheck versioned docs at implementation time because SDK and plugin APIs change.

---

## 1. App architecture

**Shape** (`apps/mobile`, Expo SDK selected and pinned at step 0):

```
apps/mobile/
  app.json / package.json (+ eas.json before the first external pilot)
  assets/  scripts/
  src/
    app/                       # routes ONLY — every file is a route
      _layout.tsx              # provider tree + hydration gate
      (auth)/
        login.tsx              # route-level: redirects when session valid + flag clear
        change-password.tsx    # route-level: requires session (mirrors web)
      (staff)/
        _layout.tsx            # staff-kind + flag-clear guard
        (tabs)/
          _layout.tsx          # SDK-verified tabs, permission-aware destinations
          home/_layout.tsx + index.tsx            # setup state / summary + profile
          homework/_layout.tsx + index.tsx + [id].tsx
          attendance/_layout.tsx + index.tsx
          fees/_layout.tsx + index.tsx + payments/[id].tsx
          more/_layout.tsx + index.tsx + admin hub:
            students/... + setup/... + staff/... (steps 2, 6 — pushed on More's Stack)
      (family)/                # step 9: _layout + tabs + child switcher
    screens/                   # bodies routes render; route files stay thin
      staff-home/  student-register/  homework-list/  homework-detail/
      homework-grade/  attendance-mark/  fee-counter/ ...
        # each: index.tsx + colocated private parts + tests for pure logic
        # e.g. screens/homework-list/index.tsx, screens/homework-list/card.tsx,
        #      screens/homework-list/helpers.test.ts
    components/                # shared primitives ONLY (second use earns entry)
      button.tsx  field.tsx  empty-state.tsx  themed-text.tsx
      permission-gate.tsx  sheet.tsx  badge.tsx ...
    theme/
      tokens.ts                # spacing/type/radius/shadows/motion (one scale)
      brand-admin.ts           # restrained staff palette
      brand-family.ts          # step 9: family palette roles, same system
    hooks/
      use-me.ts  use-active-context.ts  use-session-boundary.ts
    lib/
      trpc.tsx                 # createTRPCReact<AppRouter> + httpBatchLink factory
      auth.ts                  # login/loginByPhone/changePassword/logout shapes
      errors.ts                # toFriendlyError port (copy passed in)
      i18n.ts                  # react-i18next init, namespaces, en resources
      query.ts                 # QueryClient defaults (the query policy below)
    constants.ts
```

Growth pattern: a screen's second needed part colocates in its folder; a
third screen needing the same part promotes it to `components/`. Tests sit
next to the file they cover, never in a separate `__tests__/` tree. Styles
live at the bottom of the component file (`StyleSheet.create`), never in
`.styles` files.

**Routing.** Expo Router groups as shells. Post-login `me.get` routes
staff-kind → `(staff)`, student-kind → `(family)`. Prefer `NativeTabs` only
when the pinned SDK exposes a release-ready API and the step-0 spike verifies
required behavior; otherwise use Expo Router's supported JS tabs. Use one
`Stack` per tab, `formSheet`/native modal for sheets and confirms — never
a centered web dialog (Android sheets host no native headers, so sheet
titles/actions render in content; detents ≤3 on Android). No `src/server`, no `app/api`: `apps/api` stays the
only server.

**Provider tree** (root `_layout.tsx`, outside-in): theme provider →
`QueryClientProvider` → session/auth provider with the hydration gate
(splash until session + `me.get` resolve — no route decision on unhydrated
state, which is what flashes the wrong shell on cold start) →
active-context provider → route guards → shell layouts. Use Expo Router's
protected-route mechanism when supported by the pinned SDK to guard the staff
and family route groups after hydration. Keep login and authenticated
change-password outside those groups so a forced password update does not
dead-end. Session expiry and wrong-kind deep links return to the correct
entry/shell while preserving the intended destination where safe. The API
continues to authorize every request; route guards are navigation behavior,
not a security boundary. Guard matrix:

| Route | Rule |
|---|---|
| `(auth)/login` | redirects away when session valid AND flag clear |
| `(auth)/change-password` | requires session (either kind; harmless if flag already clear — the change verifies the current password) |
| `(staff)` shell | staff-kind AND flag clear; wrong-kind session routes to its own shell, never a dead end |
| `(family)` shell (step 9) | student-kind; wrong-kind routes home |

**Navigation map (staff shell, provisional until task mapping).** The current
candidate is Home, Homework, Attendance, Fees, More. It is not approved as a
universal tab set: the PRD's high-frequency jobs differ by teacher, accountant,
principal, and front-office staff, while custom RBAC grants can combine those
jobs in ways that do not match role names. Step 0 must map each persona's top
tasks, frequency, urgency, and permission bundles, then validate the primary
destinations with users on a phone. Keep 3–5 peer destinations in bottom
navigation; put lower-frequency setup and reference tasks behind a clearly
labeled More destination. Every important task must be reachable in at most
two deliberate navigation steps, and permission filtering must never make a
destination unreachable. Each tab owns a Stack and preserves its own scroll
and task state. Deep routes live inside their owning tab, never at shell root.
Use sheets for short contextual actions; use full-screen routes for focused
work such as registration, grading, and collection. Preserve platform back,
dismiss, and unsaved-draft behavior.

If native tabs are chosen, resolve visibility once from hydrated `me.get`
permissions at shell creation; never use `hidden` to toggle grants live, and
never treat `disabled` as access control. A permission change while the app is
open must refresh `me` and remove access from client navigation promptly; the
server remains authoritative. Tabs should load expensive queries on focus,
not all at mount. Native-tab implementation details remain SDK-pinned as in
the step-0 decision above.

**State.** Server state = TanStack Query only (4 states per screen:
loading/error/empty/content; `isLoading` for first fetch; stale + inline
retry on refetch failure; broad invalidation after money writes). Client
state = React context for active-context (org/branch/session) + child
switcher, `useState` for simple local state. Do not add a global state library
without a demonstrated cross-screen use case and a short decision note.
Persisted: AsyncStorage
for school choice + active-context (convenience, revalidated against `me`
on load); SecureStore for session only. **Proposed online-first behavior:**
no background offline write queue; retain in-memory drafts through transient
failure and allow an explicit retry. This is not offline support. Step 0 must
validate this against attendance and photo-capture conditions with the owner;
if staff must begin work without connectivity, design local persistence,
conflict handling, privacy, and duplicate prevention before those slices.

**Query policy.** `me.get`: `staleTime` 60s + explicit refetch/invalidation
on foreground (so role/permission changes surface without waiting for the
query to become stale) + invalidation after any assignment mutation.
`staleTime` bounds freshness, it is NOT polling: no interval refetch anywhere
(deliberate — foreground return + mutation invalidation is the freshness
policy; true push later). Wiring,
verbatim per TanStack docs: `AppState` changes → `focusManager`, and
`expo-network` state → `onlineManager` (already a dependency via
better-auth — no new package). Reference lists (sessions, classes,
subjects): 5 min. Retry once, never on 403/404/409. Money mutations
invalidate dues + payments + ledger + matrix together. Active-context
resolves defaults (first org → first granted branch → current session),
drops persisted ids absent from `me` (a revoked grant must not poison
addressing), and both sign-in and sign-out clear query cache + persisted
context AND cancel outstanding user-scoped requests — late responses must
never leak the previous user's data into the new session (the web's
session-boundary bug, ported here as a rule).

**Data.** `@trpc/react-query` + `httpBatchLink` to
`${EXPO_PUBLIC_API_URL}/trpc`, `import type { AppRouter }` only. Auth rides
a `Cookie` header, NOT `credentials: "include"` (per better-auth's Expo
integration: the link's `async headers()` injects `await
authClient.getCookie()`, with `credentials: "omit"` — `include` interferes
with the manually-set cookies on native). Validation schemas from the
client-safe contract entry described above, row shapes from
`inferRouterOutputs` (wire has no
superjson: timestamps as strings, money as decimal strings — identical to
web). Error mapping ported from web `lib/errors.ts` (codes → human,
technical-string guard). Money paths: no optimistic updates. One idempotency
key per LOGICAL money operation: generated once when the operation begins,
reused across HTTP retries and retries after ambiguous timeouts (success on
server, timeout on phone), regenerated only for a genuinely new operation.
The backend answers a repeated key with the original receipt (payload-matched)
or a refusal (payload mismatch) — enforced by the `(schoolId,
clientReference)` unique backstop, never a second row. Staff calls carry
`organizationId`; portal calls carry none.

**Form discipline.** RHF + zodResolver on the exact contract schemas (the
wire regex enforces itself client-side). Dates travel ISO `YYYY-MM-DD` and
display `DD/MM/YYYY` without ever becoming a `Date` (the web's timezone bug,
ported here as a rule). Amounts stay decimal strings into the `money.ts`
helpers only — never `Number()`.

**Auth flows.** Staff now: email + password → `me.get` → staff shell;
`must_change_password` forces the change screen first. No self-signup
(ADR-021). Do NOT reuse the web-configured client instance — create a
mobile-configured one (`better-auth/react` + `expoClient()` + SecureStore;
`better-auth/react` itself is the same package on both, the configuration
is what differs).
Two-sided setup, both additive, both in step 0: server gains the `expo()`
plugin (`@better-auth/expo` — absent from the lockfile today; the server
instance carries only `username()`) plus the app scheme in `trustedOrigins`
(`mskool://`, with dev-only `exp://` wildcards); the app creates its client
with `expoClient({ scheme, storagePrefix, storage: SecureStore })` alongside
the existing `usernameClient()` (family phone login rides the same
`signIn.username()` path). Session + cookies persist in SecureStore; after a
password change, refetch session + `me.get` before routing — never trust a
local "changed" flag. The spike must prove the session survives an app
restart AND reaches a tRPC procedure through the Cookie header — not just a
login call. Family at step 9: ADR-037 phone-only claim — digits → account-status → password or
first-claim trio → forced-change gate. The old `{org_slug}-{phone}` +
school-picker shape is dead since the ADR-037 cutover and must not be
copied.

**Env.** `EXPO_PUBLIC_*` validated with literals (mirrors the web's
`NEXT_PUBLIC_*` rule); never secrets in the bundle. A missing URL fails
loudly at boot, never as requests to nowhere.

**Step 0 — foundation code (exact scope).** This is a small native-app
foundation and authentication proof, not the first domain feature. Write:

1. Expo workspace/configuration: `apps/mobile/package.json`, app config and
   scheme, pinned SDK/dependencies, TypeScript and lint setup, development
   build profile, and only necessary monorepo scripts/configuration.
2. Native route/auth shell: `src/app/_layout.tsx`, login and forced-password
   change routes, a guarded staff route group, hydration/loading/error states,
   and a temporary post-login screen. Do not lock the final tabs or build the
   polished production shell before reviewing the prototypes below.
3. Client/API/auth plumbing: `lib/auth.ts`, `lib/trpc.tsx`, `lib/query.ts`,
   `lib/errors.ts`, session and `me.get` hooks, active-context/session-boundary
   handling, and the server-side Better Auth Expo plugin/trusted-origin
   configuration documented for the pinned Better Auth version.
4. A minimal `me.get` screen that proves staff identity, permissions, forced
   password change, session persistence across restart, authenticated tRPC
   access, and sign-out/session-boundary cleanup. Do not add school setup,
   roster, attendance, or other domain workflows in Step 0; those start in
   Steps 1–3.

Step-0 design outputs are separate from production UI code: persona/task and
permission matrix; three representative wireflows; rendered phone-sized
prototypes for owner review under `docs/design/mobile/`; and the navigation
decision informed by that review. Only after review, add the first approved
shared primitives and lock the production shell. This makes the Step-0 code
list finite and prevents an unreviewed tab shell from becoming the template.

**Step-0 code modules after prototype approval:** `screens/staff-home`, shared
`Button`, `Field`, `EmptyState`, `ThemedText`, `PermissionGate`, `AppIcon`,
`theme/tokens.ts`, `brand-admin.ts`, `hooks/use-me`, `hooks/use-active-context`,
`hooks/use-session-boundary`, `lib/i18n.ts`, and the approved route/tab shell.
Step-0 dependencies: `expo-dev-client`, `expo-secure-store`, `@better-auth/expo`
(app) + server-side `expo()` plugin (api), `expo-network`; `mskool://` scheme
in `app.json`. Establish a development build early so device review uses the
app's actual native dependency set.

**Permission-gated rendering.** Nav items and screens render from the
`me.get` permission union (`PermissionGate` wrapper). Grant/revoke
invalidates the target's server auth cache immediately; the client refetches
`me` on foreground + after assignment mutations (60s `staleTime` bounds the
lag). Hiding is UX — enforcement is always `can()` server-side, and
SENSITIVE writes bypass the server cache entirely.

---

## 2. Design system

### Mobile UX workflow (required before feature UI)

Mobile quality is a product behavior requirement, not a visual skin over the
web console. Expo/React Native supplies native app capabilities; the workflow
and screen hierarchy must still be designed for a small, personal,
interruptible, thumb-driven device with variable connectivity. A screen that
is merely a desktop table or dialog stacked vertically does not pass.

Before implementation of each feature slice, write a one-page journey brief
with: the real actor and permission context; where/when they use it; the one
job they need to finish; entry point and completion; decisions and error
recovery; data/network assumptions; privacy and accessibility needs; and the
backend procedures used. Map the full journey as a wireflow, including
loading, empty, permission-denied, offline, validation, retry, success, and
interruption/app-resume states. Group fields by the user's mental model, not
the database schema. Preserve drafts across validation errors, retries, and
temporary navigation; do not show success before server confirmation.

For the initial shell, design and review at least three representative
journeys before committing to navigation and shared UI: a teacher marking a
section's attendance between periods; an accountant finding a student's dues,
collecting money, and recovering from an ambiguous timeout; and front-office
staff admitting a student and assigning a section. Include a principal's
cross-branch context switch in the navigation review. This exposes whether
the information architecture supports actual jobs instead of mirroring the
web sidebar. Capture the agreed wireflows and screenshots under
`docs/design/mobile/`; do not present desktop screenshots as mobile specs.
Show the owner rendered prototypes of these journeys before implementing the
full shell, then use feedback to lock navigation and the first shared
controls. Do not let an unreviewed dashboard mock become the template for
every domain.

Before implementing a new screen, define its visual hierarchy and a realistic
content example. For the first release, use a consistent, calm school-operations
direction: clear task titles, concise status and amounts, grouped native-feel
lists, one primary action, and restrained feedback. Do not start from generic
dashboard cards, promotional hero banners, or a shrunken web layout. Review a
rendered screen on compact phone width, including a 360dp-class device, before
approving the pattern; then
carry only proven tokens and primitives forward. Share the visual language
between staff and family shells so the one app still feels like one product;
palette emphasis can vary, while semantics, spacing, navigation behavior,
accessibility, and core controls remain coherent.

Every slice plan must include its journey brief, wireflow, screen/state list,
platform-specific behavior, and measurable exit criteria before code. Review
the rendered flow against the brief after implementation. At minimum, the
reviewer must be able to identify within five seconds where they are, what
matters, what they can do next, and whether anything needs attention. If the
screen fails, fix content and grouping before adding decoration. Phone is the
primary layout target; wider windows, rotation, and split-screen must preserve
the task and draft, adding a second pane only when it helps. Do not imply
tablet optimization until those layouts have a separate review.

One token system (`theme/tokens.ts`: spacing 4-pt grid, type, radius,
elevation, motion). Shared semantic roles and component behavior across the
two shells; staff and family may use different palette emphasis through
`brand-admin.ts` and `brand-family.ts`, but not separate visual systems or
unrelated density/layout rules. Screen titles come from stack
headers. Icons: the platform-aware icon package verified for the pinned SDK,
isolated behind `AppIcon`, with per-platform names; one platform never wears
the other's uniform. Hard floors (non-negotiable): touch targets ≥44pt
iOS / ≥48dp Android or equivalent hit area; contrast WCAG AA (4.5:1 body,
3:1 large/UI); Dynamic Type respected (large-text sanity in every QA walk);
every interactive element named for screen readers; motion respects Reduce
Motion; secrets never in AsyncStorage. Images: `expo-image` (disk+memory
cache, BlurHash placeholders, `recyclingKey` on recycled rows). Lists:
`FlashList` v2 for rosters/dues/feeds when profiling or dataset size warrants it — memoized props, valid
`keyExtractor`, `getItemType` for heterogeneous rows, `useRecyclingState`
for item-local state, perf judged in release mode only (dev lies); use
`FlatList` as the built-in virtualized baseline. Expo UI `List` has native
styling, but currently creates React rows eagerly even though its container
is described as virtualized. A 60-row roster spike can assess its mount and
scroll behavior; do not presume it fits large rosters, dues, or feeds. Verify
the guidance for the pinned SDK before choosing a list.

**Component priority:** `@expo/ui` (sheets, pickers, switches, menus —
each evaluated per use against platform consistency, accessibility,
keyboard behavior, and tokens; first choice, not blind choice) →
React Native built-ins (`Pressable`, `FlashList`, `RefreshControl`) → custom
primitives (`Button` with variant/size/loading, `Field`, `EmptyState`,
`ThemedText`, `AppIcon` — an icon wrapper isolating the chosen platform-aware
icon package)
only when 1–2 cannot. Promotion is earned: inline JSX →
screen-colocated → `components/` on second use with a nameable role.

Check the pinned SDK before adopting `@expo/ui`: its universal component
layer requires SDK 56+ in the current Expo guidance. Native controls can
improve platform fit, but mixing them into screens still needs interaction,
keyboard, accessibility, and dark-mode review; do not force the whole screen
into a native host tree.

**Reference policy (web is the API book, not the design book).** Reuse
business rules, endpoint composition, copy vocabulary, money/date discipline,
and permission behavior. Never shrink or directly port desktop layout, IA,
tables, dialogs, density, or component trees. Start from a persona journey,
design the mobile information architecture and interaction model, then map
the result to existing procedures. The app is native in behavior too: safe
areas and system bars, keyboard-aware forms/autofill, platform back/swipe,
native selection controls where appropriate, accessibility announcements,
foreground/background refresh, share/photo/document handoff, and clear
recovery from dropped connectivity. Each is included only where the user
journey needs it and the platform supports it.

---

## 3. Reuse from web (logic moves, widgets don't)

**Reuse logic selectively; never copy blindly.** Candidate pure helpers include
`lib/money.ts`, `lib/format.ts`, `lib/calendar-grid.ts`,
`features/fees/matrix-helpers.ts`, and contract-derived `fee-enums.ts`.
Before reusing one, inspect its tests, dependencies, business assumptions,
locale/time-zone behavior, and React Native/Hermes compatibility. Preserve its
proven behavior with tests; fix or reject it if the web version is wrong or
web-specific. Extract genuinely cross-client pure logic to a client-safe
shared package when it has a second consumer; do not import DOM, Next.js,
Node-only, database, or server code into the mobile bundle. `lib/trpc/types.ts`
is type-only material, not runtime logic.

**Port behavior, redesign the interaction.** Reuse the active-context rules,
authentication/session semantics, money idempotency and error mapping, but
implement them with native storage, lifecycle, navigation, feedback, and
recovery. Reuse the same backend contracts and let the server remain the
business-rule and authorization authority. Client validation is an early UX
check, never a replacement for server validation. Do not port web hooks,
components, state-management glue, or data-fetching behavior without checking
their assumptions against the Expo/RN docs and mobile use case.

**Do not touch:** `components/ui/*`, data-table engine, app-shell,
form-dialog, `use-mobile.ts`, `auth-server.ts`, CSS. Mobile journeys are
respecified per persona (teacher between periods, accountant at counter),
then mapped to existing endpoints — the flow never bends the contract.

**Growth rule** (CONVENTIONS.md): shared package gains a file on second
import, never upfront.

---

## 4. i18n, testing, QA bar

**i18n:** keys from day one (`t("fees.counter.title")`, per-domain
namespaces), `react-i18next` + `i18next` core + `expo-localization` for
device-locale detection, `en` fallback, persisted override. English strings
only — later locales add files, never touch screens. The in-app override
(rather than system per-app language alone) is deliberate: shared family
phones carry one device locale for several readers. Supported locales are
declared via the `expo-localization` config plugin when the second locale
lands. Indic fonts via `expo-font` config plugin when needed.

**Testing:** `check-types` is the hard gate (contract drift breaks both
clients at compile time). Six layers, cheapest first — no blind building:

* **L0 static (every chunk, no device):** TypeScript + lint +
  `pnpm exec expo install --check` + `pnpm dlx expo-doctor` + Expo export from
  the mobile workspace. These catch type/lint, SDK dependency mismatch, common
  configuration, and bundle-resolution failures before device review.
* **L1 unit (Jest + `jest-expo` preset):** Expo's documented default for
  Expo/RN unit tests; install versions compatible with the pinned SDK. Test pure helpers that travel from web
  (`money`, `format`, `calendar-grid`), error mapping, permission-gate
  logic, and i18n key coverage. Mobile uses Jest, not the web's Vitest.
  Use `.test.ts` / `.test.tsx` naming so Jest discovers tests by default.
* **L2 component (`@testing-library/react-native`, v14+):** primitives in
  their contract states (Button default/pressed/disabled/loading), and every
  data screen's four states with mocked queries — loading, error, empty,
  content. Never an empty flash during first load.
* **L3 router integration (`expo-router/testing-library` `renderRouter`):**
  shell guards (signed-out → login, staff-kind → staff shell, forced-change
  gate, wrong-kind reroute), tab stacks, deep links (`homework/[id]`,
  `fees/payments/[id]`). Exit matrix: cold start, login, forced change,
  logout, expired session, wrong-kind shell. Test files live outside `app/`
  (routes-only rule) with inline-mocked filesystems.
* **L4 device walk (per part, mid-range Android; iOS before release):** one success + one
  refusal + one retry against the real API; an offline→online transition
  walk (enter data offline → reconnect → retry succeeds, nothing lost,
  nothing duplicated — drafts stay in memory, no success UI before server
  confirmation); concurrent double-tap + kill-after-submit on money paths;
  screenshot review against task hierarchy, five-second comprehension,
  readable text, touch reach, platform conventions, and visual states. Use
  the app's development build for normal device work and whenever native
  dependencies/configuration are involved; Expo Go is for quick exploration.
* **L5 E2E (Maestro, `apps/mobile/e2e/flows/*.yaml`):** the never-regress journeys —
  login → post → publish, dues → collect → receipt, admit → enroll. The first
  suite is attendance (2026-10-20): `pnpm e2e:android` resets the demo fixture,
  pins the emulator clock, runs the three flows against the real API/Postgres, and
  restores the clock — see `.kilo/plans/2026-10-20-mobile-attendance-e2e.md`.
  Written alongside their slices (attendance's followed the walk) and run locally
  against the emulator during the build; EAS Workflows (`e2e-test` profile: APK /
  simulator `.app`) at store time. Stable `testID`s on automation targets (Maestro
  reads `testID`; content assertions may read visible data text, never the
  screen-reader label — labels stay human); so L5 costs nothing extra when its
  flows are written. Snapshot tests are not UX proof; behavior and device tests
  are required evidence. Add snapshots only as supplemental checks when a slice
  has a clear use for them.

Backend gates (integration, smoke) stay green for both clients; mobile adds
no backend. CI must block merge on L0–L3. Run critical L5 journeys for pull
requests and releases; if the full device matrix is too costly per PR, define
a bounded smoke set and run the full set nightly/release. Build Android and
iOS preview binaries when native dependencies or app configuration change.
A part's rows get ticked only after L0–L4; L5 covers the journeys in the slice
plan's exit list.

Plain-language companion (same layers — read this first, implement above):

| # | Question it answers | Example | When |
|---|---|---|---|
| 0 | Does it even build? | Missing import, type error from a renamed column | Every commit, seconds |
| 1 | Is the logic right? | ₹1,400 + ₹100 totals; date display; error wording | Every commit, seconds |
| 2 | Does the screen behave? | Loading → dues → receipt; retry works; no double-submit | Every commit, seconds |
| 3 | Do guards hold? | Signed-out → login; parent never reaches staff screens | Every commit, seconds |
| 4 | Does it work on a real phone? | Post on 4G; receipt matches ledger; revoked tab hides | Per part, mid-range Android |
| 5 | Do critical journeys survive? | Login → post → publish; dues → collect → receipt | Per step, emulator, local |

**QA bar per step:** walk on a mid-range Android (not the emulator) — one
success + one refusal + one retry per part; screenshot review against
task hierarchy and platform conventions; thumb-reachable primary actions;
keyboard-tracking forms; large-text and screen-reader sanity. Before release,
repeat critical journeys on iOS and check compact/expanded windows. No part closes with unticked
rows except rows explicitly moved to a named later step here.

---

## 5. Deferred (not dropped)

Timetable (no tables exist — PRD refusal stands); push/WhatsApp delivery
(in-app feed rides step 6, delivery its own later phase); gateway payments
(read-only fees first, ADR-009 webhook with live keys later). EAS/store setup
and Sentry are release gates before the first external pilot. Family shell +
family palette = step 9.

---

## 6. Step order and domain tables

Reviewed 2026-10-13 against the actual web route tree: people + structure
first (everything hangs off them), then attendance as the first high-frequency
phone workflow, followed by homework and fees, exams last, and the staff
parity closeout before family. This refines the earlier order by moving
attendance ahead of homework to test the mobile interaction model against a
short, repeated teacher task before the more complex assignment workflow.

| Step | Domain | Backend | Status |
|---|---|---|---|
| 0 | Foundation (native auth/API proof + prototype review) | staff login, `me.get` | in progress (Android build + walk done; findings fixed + re-walked; build durability in-repo — prebuild safe; committed 2026-10-17; **prototype review PASSED 2026-10-18 — shell build next**; iOS walk parked 2026-10-20) |
| 1 | Home + context + profile | `me` 1 · `school` 5 · `academic` years 6 | complete — branch switcher, profile/access, voluntary password, branch management and session management (chunk B) device-walked 2026-10-23 |
| 2 | Students + academic setup (§7) | `student` 7 · `enrollment` 6 · `guardian` 4 · `portalAccess` 4 · `academic` classes 5 + sections 5 · `subject` 5 · `term` 4 · `assignment` 10 | open |
| 3 | Attendance (§8) | `attendance.*` 13 | complete (mark/status walked 2026-10-18; summary + section switcher 2026-10-19; calendar generate/days, policy, periods 2026-10-20; report exports remain open) |
| 4 | Homework manage (§9) | `homework.*` staff 28 | complete — staff slice device-walked 2026-10-25 (`88864ab`, `678c5dd`, `5ed3583`, `6198649`, `4ad81f3`); quiz-attempt grading not walked (no seeded attempts); family door at Step 9 |
| 5 | Fees (§10) | `fees.*` 38 | open |
| 6 | Staff + roles + ID cards + feed (§11) | `staff` 8 · `role` 8 · `idCard` 10 | open |
| 7 | Exams + marks (§12) | `exam.*` staff 46 | **7A built + device-walked 2026-10-26; 7B (verify, reopen, readiness) built + device-walked 2026-10-27** on `feat/mobile-exams-7a` (plan: `.kilo/plans/2026-10-26-mobile-exams.md`); 7C–7F open |
| 8 | Remaining staff parity closeout | Any mobile-scoped staff workflows found by route audit | open |
| 9 | Family shell (§13) | `portalHomework` 12 · portal reads · `portalExam` 2 · full claim auth | open |

`publicSite` editor and admin preview are explicitly deferred from mobile by
the owner. Step 8 closes all other mobile-scoped staff route gaps before family
work begins; the web editor remains the supported way to manage public sites.

### Web route parity ledger (audited 2026-10-13)

This inventory is against the current `apps/web/src/app` route files. Every
mobile-scoped staff workflow below must have a native mobile journey, even if
the interaction differs substantially from its web implementation. Backend
procedure coverage alone does not close a route. Step 8 blocks the family
shell until those workflows are complete or explicitly deferred by the owner.

| Existing web route(s) | Mobile phase | Required mobile experience |
|---|---:|---|
| `(auth)/login`, `(auth)/change-password` | 0 | Native staff sign-in, forced password change, recovery and session expiry |
| `(dashboard)/`, `/profile`, `/branches`, `/sessions` | 1 | Task-led home, organization/branch/session context, profile and account actions. **Complete (device-walked 2026-10-23)**: home, branch switcher, profile/access and voluntary password; native Branches list + add/edit/close (org-admin create/delete, principal edit); native Sessions list + add/edit and make-running behind a confirm (ADR-047), permission-gated and read-only for teacher scopes |
| `/subjects`, `/classes`, `/classes/[classId]` | 2 | Searchable catalog and class detail; setup forms grouped by school workflow. **Classes and subjects are live** as Academic-setup surfaces (list + form + deactivate, walked 2026-10-24) |
| `/students`, `/students/[studentId]` | 2 | Roster search/filter, student detail, admit/edit/enroll, guardian and portal-access flows. **Live (walked 2026-10-24)**: roster + detail + admit/edit/deactivate; enrollment, guardians and portal access hang off the detail |
| `/students/photos` | 2 | Native photo picker, review-before-upload bulk matching, retry-failed-only. **Live (walked 2026-10-24)**: section-order and register matching, clear-to-unmatched strip, sequential uploads with per-student pills and retry-failed-only. Register mode is best-effort on Android (the photo picker anonymizes file names — platform finding) |
| `/attendance/calendar`, `/attendance/policy`, `/attendance/mark`, `/attendance/reports` | 3 | Fast section/day selection, roster marking, correction reason, readable summaries. **`/attendance/mark` is live** as the native marking screen (`(staff)/attendance`, device-walked 2026-10-18; the day-sheet reads `calendar.list`); **yearly summaries and the section switcher are live** as the Mark ⇄ Summary segments with the section sheet (device-walked 2026-10-19); **management surfaces are live** — calendar generate/day overrides, marking policy and periods in `(staff)/attendance/manage` (device-walked 2026-10-20); report exports remain open |
| `(no existing web route; backend exists)` homework staff routes | 4 | Assignment authoring, question management, publish lifecycle, grading and comments. **Complete (device-walked 2026-10-25)**: tab 5 agenda + All list, create/edit, detail with publish/close/cancel, grade grid and student desk, question-set editor, bank, comment threads, settings and rubrics |
| `/fees`, `/fees/setup`, `/fees/setup/[structureId]` | 5 | Fee setup, installments, concessions, subscription and late-fee workflows |
| `/fees/dues`, `/fees/outstanding`, `/fees/matrix` | 5 | Mobile search/list/detail summaries; do not reproduce a wide matrix as a squeezed table |
| `/fees/counter`, `/fees/collect`, `/fees/payments`, `/fees/payments/[paymentId]`, `/fees/ledger` | 5 | Counter collection, allocation review, receipt, reversal/bounce recovery and ledger inspection |
| `/staff`, `/staff/[staffId]`, `/roles`, `/roles/[roleType]` | 6 | Staff record and login lifecycle, role assignment and permission editing with safeguards |
| `/students/id-cards`, `/students/id-cards/[templateId]/design` | 6 | Touch-capable template management/designer plus native PDF/share/print workflow, including duplex alignment guidance |
| `/exams`, `/exams/setup`, `/exams/grades`, `/exams/[examId]` | 7 | Exam lifecycle, grading configuration, schedules and components. **List + hub + stage moves are live (7A, walked 2026-10-26)**; create/edit/blueprint 7D, grading setup 7F |
| `/exams/[examId]/entry`, `/exams/[examId]/results`, `/exams/[examId]/results/print` | 7 | Mobile marks-entry flow, verification/publication, report-card review and PDF/share/print. **Marks entry is live (7A, walked 2026-10-26)** as `/exams/[examId]/paper/[scheduleId]`; **verification is live (7B, walked 2026-10-27)** as Review mode on that same route; results/publish/print 7C |
| `/site`, `(public)/sites/preview` | Deferred by owner (2026-10-13) | Keep site editing and admin preview on web; do not build these mobile routes now |
| `(portal)/portal/fees`, `/portal/attendance`, `/portal/results` | 9 | Adult-first family shell, child switcher and owned-student reads |
| `/sites/[slug]`, public not-found/layout routes | Web public surface | Public school websites remain web-hosted; the app may open their URL externally |

Cross-cutting route behavior—deep links, empty/loading/error states, permission
denial, unsaved drafts, back behavior, and session boundaries—is required for
every applicable row. Native camera/photo selection, system sharing/printing,
and system sharing/printing are mobile-specific interactions: an API row by
itself does not cover them. Public-site editing and admin preview are the
explicit mobile-scope exception recorded above.

## 6.1 Step 1 — Home, context, and profile

Home is a native operational landing screen composed from existing caller,
branch, and academic-year queries; do not invent a dashboard endpoint just to
recreate web cards. Its task shortcuts are permission-filtered for navigation,
while each destination and mutation remains server-authorized. Context is
organization → granted branch → the branch's **current** academic year, with
persisted ids revalidated against `me.get` on every new session.

There is **no global year picker** on mobile (ADR-047): the session is a fact
the More screen displays, not a control, and surfaces that look backwards carry
their own bounded year control. Changing the current session is an
administrative write behind a confirm on that session's edit screen — never a
switcher in the header or More.

The management journeys are native lists and pushed forms under More's Manage
group, gated on `me.get` permission strings rather than role names. Branches
reads the active-only `school.list`; Add appears with `school:create`, editing
with `school:update`, and Close (a one-way deactivation, not a delete) with
`school:delete`. Sessions reads the org-wide `academic.year.list` and filters
to the active branch; Add needs `academic_year:create`, editing
`academic_year:update`, and Make running calls `academic.year.setCurrent` behind
a confirm. A principal therefore edits her branch and manages sessions but
cannot add or close a branch; a teacher sees both lists read-only, `/sessions`
shows the running session plus a "history hidden" notice, and direct form deep
links render the permission-denial screen. Both forms keep the active branch
name in the header, handle loading/empty/error/retry, preserve input through a
failed save, and guard unsaved changes on back.

| Procedure | Screen/use | Done |
|---|---|---|
| `me.get` | Session hydration, role/permission map, staff/family dispatch, owned-student detection, branch rows and profile | ☑ walked 2026-10-23 (branch row, profile, permission groups) |
| `school.list` / `school.byId` | The shell's branch picker still reads `me.get`'s `memberships[].schools[]` (ADR-044); management reads `school.list` (active-only) and `school.byId` for the edit form | ☑ walked 2026-10-23 (list, add, edit, close) |
| `academic.year.list` / `.current` / `.byId` | `list` supplies the branch's current session (filtered by `schoolId` client-side, one org-wide read) and the management list. `.current` is deliberately unused: it is a strict `staffProcedure` and 403s for section-scoped teachers. `.byId` feeds the edit form | ☑ `list` walked 2026-10-23 (session row follows the branch; Running/Other groups); ☑ `byId` walked with create/edit |
| `school.create` / `.update` / `.deactivate` | Branch management: create with name/legal name/code/board and optional contact/address, edit the same fields, close with a consequence confirm | ☑ walked 2026-10-23 (admin create/edit/close; principal edit-only; teacher denied) |
| `academic.year.create` / `.update` / `.setCurrent` | Session management: create from a free start-year preset (name and 1 Apr–31 Mar filled, dates editable), edit name/dates, make running with a confirm | ☑ walked 2026-10-23 (create 2026-27, edit end date, promote and restore 2025-26; principal add/edit; teacher denied) |

Profile reads the `me.get` identity. Password changes and logout use
better-auth, not a profile mutation. If the web staff routes expose additional
profile or organization-settings workflows, list them in the parity closeout
instead of assuming they are part of this profile screen.

---

## 7. Step 2 — Students + academic setup (50)

People and structure first: rosters anchor every later domain, and setup
writes make mobile self-sufficient for new schools (no web needed).

| Group | Paths | Screen | Done |
|---|---|---|---|
| `student` list / by-admissions / byId / create / update / deactivate / photo (7) | `/students…` | `/students` roster, `/students/[studentId]` detail, `/student-form`, `/students/photos` | ☑ list/byId/create/update/deactivate walked 2026-10-24 (roster search, admit with validation refusal, edit round-trip, deactivate → roster; row + status verified in Postgres). ☑ **photo workbench walked 2026-10-24**: section-mode pick→match→upload (Ana Das's row landed in `student_photos`/`storage_objects` at 9.9 KB under the ceiling); register mode honestly holds Android-photo-picker-anonymized names unmatched — original names don't survive that picker (platform finding; register matching is best-effort by what the picker preserves) |
| `enrollment` list / byId / create / update / assign-section / transition (6) | `/enrollments…` | detail enrollment section + `/enrollment-form` | ☑ walked 2026-10-24: create (status derives `section_assigned`), transition `section_assigned→active` via the legal-map sheet, roll-number label edit — all verified in Postgres. `assignSection` is built (same form, assign mode for admitted rows) but its dedicated device exercise is the step's one pending walk item |
| `guardian` list / add / update / detach (4) | `/students/{id}/guardians…` | detail guardians + `/guardian-form` | ☑ add walked 2026-10-24 (mother, primary, portal flag; Postgres verified); edit/detach share the form and server ops — update exercised by the re-render, detach not fired on the demo fixture |
| `portalAccess` ensure-link / status / revoke-link (4) | `/portal-access/…` | `/portal-access` | ☑ walked 2026-10-24: status (empty → link opened → `Pending — not claimed yet · No password yet`); ensureLink verified. revokeLink built behind its confirm, not fired on the demo fixture. `verifyLink` is the parent's own claim step — no staff UI |
| classes list/byId/create/update/deactivate (5) | `/classes…` | `/classes` + `/class-form` | ☑ walked 2026-10-24 (create "Class 9"; row + `scope_nodes` verified in Postgres — hard rule 12) |
| sections list/byId/create/update/deactivate (5) | `/sections…` | `/sections` + `/section-form` | ☑ walked 2026-10-24 (create "B" of Class 9 for the running session; `scope_nodes` verified) |
| subjects list/byId/create/update/deactivate (5) | `/subjects…` | `/subjects` + `/subject-form` | ☑ walked 2026-10-24 (create "Art") |
| terms list/byId/create/update (4) | `/terms…` | `/terms` + `/term-form` | ☑ walked 2026-10-24: form + date pickers + validation proven; the demo session's terms cover it, so the create surfaced the server's real no-overlap refusal (correct behaviour). Update rides the same form |
| subject-mappings list/byId/create/update/end (5) | `/subject-mappings…` | `/subject-mappings` + `/subject-mapping-form` | ☑ walked 2026-10-24 (map Art to Class 9; class picker rides the route). End built behind its confirm, not fired |
| teacher-assignments list/byId/create/end + directory (5) | `/teacher-assignments…`, `/teacher-directory` | `/teacher-assignments` + `/teacher-assignment-form` | ☑ walked 2026-10-24 (directory picker, role/subject CHECK mirrored live, Priya Chatterjee assigned as subject teacher of 9-B). End built behind its confirm, not fired |

Every endpoint group of Step 2 is built, walked and gate-green. Residual
device exercises (each operation built and gate-green, its server semantics
covered by the integration suites; the emulator host's hypervisor wedged
post-crash on 2026-10-24): firing the end/detach/revoke confirms once each
and a dedicated `enrollment.assignSection` walk.

Acceptance: admit → enroll → assign section → guardian recorded → link
status visible; trust onboards a branch (session → classes → sections →
subjects → mappings → staffing) with `scope_nodes` written in-transaction
(hard rule 12). Staff credential acts limited to legacy rows per ADR-037.

---

## 8. Step 3 — Attendance (13)

Source: `attendance.router.ts`. Calendar is the marking gate; reports read
`daily_attendance_status` only (hard rule 5); past-date edits carry the
ADR-030 reason.

| Group | Paths | Screen | Done |
|---|---|---|---|
| calendar list / generate / days (3) | `/attendance/calendar`, `/generate`, `/days` | `(staff)/attendance/manage/calendar` (month list, generate sheet, day sheet) | ☑ list (walked 2026-10-18); ☑ generate/days (walked 2026-10-20) |
| policy get / upsert (2) | `GET|PUT /attendance/policy` | `(staff)/attendance/manage/policy` | ☑ (walked 2026-10-20). Class teacher sees the gear (has `attendance:update`) but the server refuses school-scoped saves (“You don't have permission…”); copy recorded |
| periods list / byId / create / update (4) | `/attendance/periods`, `/{id}` | `(staff)/attendance/manage/periods` + `period-edit` | ☑ (walked 2026-10-20); section-scoped writes work for the class teacher (6-A); no delete endpoint in v1 |
| mark (1) | `POST /attendance/mark` | `(staff)/attendance` marking screen | ☑ (device-walked 2026-10-18) |
| status (1) | `GET /attendance/status` | `(staff)/attendance` marking screen | ☑ (device-walked 2026-10-18) |
| statusHistory (1) | `GET /attendance/status-history` | `(staff)/attendance` recent strip, day-sheet marked dots, Summary student month map | ☑ read 2026-10-23; phone-walked and E2E-green |
| summary (1) | `GET /attendance/summary` | `(staff)/attendance` Summary segment (yearly, per section; section switcher on the shared title row) | ☑ (device-walked 2026-10-19) |

Acceptance: a teacher marks a section's day in under a minute on 4G;
read-only for callers without `attendance:create`. Walked 2026-10-18
(emulator-5554): the marking journey ran end-to-end on device, and read-only
is proven twice — the UI notice plus a 403 on a crafted call
(`Missing permission: attendance:create`). Record:
`.kilo/plans/2026-10-18-mobile-shell-attendance.md` §9 + walk record.

Chunk 2 walked 2026-10-19 (same emulator, principal persona): switcher with
two sections, section switch with Summary open, empty vs populated section,
error → Retry → recovery, home per-section cards, card-param entry,
cold-start default. Record + findings (walk-test corrections, open
questions): `.kilo/plans/2026-10-18-mobile-attendance-summary.md`.

---

## 9. Step 4 — Homework (28 staff + 12 portal)

Source: `packages/trpc/src/routers/homework.router.ts`. Subject-gated
writes (`create/update/publish/cancel/close/evaluate/extend/excuse`,
`bank.create`, `questions.set`, `gradeAnswer`); conversation (`comments`)
ungated; settings/rubrics ride `school_settings`.

**HW-A config:** `settings.get/upsert`, `rubrics.list/create/byId/setActive`
(6). **HW-B authoring:** `list/byId/create/update/publish/cancel/close`
(7). **HW-C questions:** `bank.list/create/byId/setActive`,
`questions.set/get` (6). **HW-D grading:** `students.list/get`,
`evaluate/extend/excuse`, `attempts.list/gradeAnswer` (7). **HW-E Q&A:**
`comments.list/post` (2).

| Procedure | Screen | Done |
|---|---|---|
| `homework.settings.get` / `.upsert` | `/homework/settings` | ☑ |
| `homework.rubrics.list` / `.create` / `.byId` / `.setActive` | `/homework/rubrics`, `/new`, `/[rubricId]` | ☑ |
| `homework.list` / `.byId` | `/homework`, `/homework/[id]` | ☑ |
| `homework.create` / `.update` | `/homework/new`, `/homework/[id]/edit` | ☑ |
| `homework.publish` / `.cancel` / `.close` | `/homework/[id]` | ☑ |
| `homework.bank.list` / `.create` / `.byId` / `.setActive` | `/homework/bank`, `/new`, `/[itemId]` | ☑ |
| `homework.questions.set` / `.get` | `/homework/[id]/questions` | ☑ |
| `homework.students.list` / `.get` | `/homework/[id]/grade`, `/homework/grade/[saId]` | ☑ |
| `homework.students.evaluate` / `.extend` / `.excuse` | `/homework/grade/[saId]` | ☑ |
| `homework.students.attempts.list` / `.gradeAnswer` | `/homework/grade/[saId]` | ☑ (list read; `gradeAnswer` not walked — no seeded attempts) |
| `homework.comments.list` / `.post` | `/homework/[id]/comments` | ☑ |

Family door at step 9: `portalHomework.list/get/markViewed/submit/
acknowledge`, `attempts.start/get/saveAnswer/submit/result` (5),
`comments.list/post` (2).

Acceptance: a subject teacher posts a section-targeted draft with questions
between periods, publishes, and grades one student's submission on a
mid-range Android — refused honestly outside her assignment facts.

**Built and walked 2026-10-25** on `feat/mobile-homework-slice` (5 commits,
not pushed). Plan, journeys, screen states and the gap list live in
`.kilo/plans/2026-10-25-mobile-homework.md`; that file is the source of truth
for this step, including the 19 backend gaps found while building it. Two
paths are deliberately not walked: quiz `attempts.gradeAnswer` (no seeded
attempts or `student_portal_access` rows in the demo DB) and the
`created=1` rubric saved notice.

---

## 10. Step 5 — Fees (38)

Append-only ledger (hard rule 3); money as decimal strings, no optimistic
writes; state machine encoded in UI (illegal transitions don't render).

| Group | Count | Screen | Done |
|---|---|---|---|
| heads list/byId/create/update/deactivate | 5 | — | ☐ |
| structures list/byId/create/update/deactivate + lines list/create/update | 8 | — | ☐ |
| late-fee rules list/create | 2 | — | ☐ |
| subscriptions list/create/cancel | 3 | — | ☐ |
| assignments list/create/generate/recompute/concessions | 5 | — | ☐ |
| matrix list/cell | 2 | — | ☐ |
| dues list + installment waive | 2 | — | ☐ |
| payments list/detail/record/clear/bounce/reverse/cancel | 7 | — | ☐ |
| refunds create | 1 | — | ☐ |
| ledger list + opening balances list/create | 3 | — | ☐ |

Acceptance: accountant finds dues → collects with clamped allocation →
receipt with server number → bounce re-opens dues; ledger In/Out/Net
reconciles.

---

## 11. Step 6 — Staff, roles, ID cards, feed (26 + feed)

| Group | Count | Screen | Done |
|---|---|---|---|
| `staff` list/byId/create/update/deactivate/reactivate/login/login-reset (8) | — | ☐ |
| `role` assignments/assign/revoke/permissions/holders/defaults/update/reset (8) | — | ☐ |
| `idCard` templates list/get/create/update/close/adopt/default/asset + gallery/clone (10) | — | ☐ |
| In-app feed (new: event table written in-transaction with publish/dues events, bell + unread) | — | ☐ |

Role editing keeps the ADR-036 locks (never `org_admin`, never a held
role). Push delivery is a later phase, not this step.

---

## 12. Step 7 — Exams + marks (46 staff + 2 portal)

Source: `exam.router.ts`. Unpublished marks never reach family screens
(hard rule 8); post-publish edits flow through revision windows (hard
rule 7).

Slice plan (actors, journeys, wireflow, states, chunk order, owner decisions):
`.kilo/plans/2026-10-26-mobile-exams.md`. Built in chunks 7A–7F; the Screen column
names the chunk that closes each row. 7A (find the paper, enter marks), 7B (verify,
reopen, readiness) and 7C (results, publish, correct) are built, device-walked
(7C's core arc) and COMMITTED on `feat/mobile-exams-7a` (unpushed). 7D (exam
lifecycle + blueprint) is designed (addendum; the owner waived pre-review) and
BUILT the same day — committed, not yet device-walked. 7E/7F still get a design
addendum before their UI starts.

| Group | Count | Screen | Done |
|---|---|---|---|
| subject-types list/byId/create/update/deactivate/apply-preset | 6 | 7F | ☐ |
| grading-scales list/create/update/bands/make-default | 5 | 7F | ☐ |
| pass-criteria get/create/update | 3 | 7F | ☐ |
| exam list/byId/create/update/transition | 5 | list/byId/transition 7A · create/update 7D built 2026-10-27 (walk pending) | ◐ 5 of 5 |
| schedules list/save + components list/save | 4 | schedules/components save built 7D 2026-10-27 (walk pending) | ◐ 4 of 4 |
| eligibility list/recompute/override + readiness | 4 | list 7A · readiness 7B (moved from 7C, D9) · recompute/override 7D built 2026-10-27 (walk pending) | ◐ 4 of 4 |
| marks entry grid / student entries / autosave / verify / unverify | 5 | entry + autosave 7A · verify/unverify 7B · student entries 7C (walk pending) | ◐ 5 of 5 (7A–7C) |
| results table / compute / term ranks / final results | 4 | 7C built 2026-10-27 (walk pending) | ◐ 4 of 4 |
| publication list / publish-class / publish / revision open+close / apply revision | 6 | 7C built 2026-10-27 (walk pending) | ◐ 6 of 6 |
| cards versions / class set + term-grades list / save | 4 | cards built 7C 2026-10-27 (walk pending; print/share deferred, D15) · term-grades 7E | ◐ 2 of 4 |
| portal results list / card (step 9) | 2 | — (Step 9) | ☐ |

Acceptance: principal creates exam → papers inline → teacher enters marks
with `canEnter` reasons → verify → publish → family sees the frozen card.

---

## 13. Step 9 — Family shell

Second shell, shared design system with family palette (`brand-family.ts`):
full claim auth (phone →
status → password/first-claim trio → forced-change gate), child switcher,
`portalHomework` 12 (view/submit/acknowledge/attempts/comments), portal
attendance + fees reads, `portalExam` results 2, feed. Web `(portal)` dies
when this shell covers it (ADR-034).

---

## Gates (every step)

`pnpm check-types` green; unit tests travel with moved helpers; device walk
per part (success + refusal + retry); slice plan closes only with all rows
ticked-or-classified, or explicitly moved to a named later step here.

**Spike exit (step 0):** on Android and iOS development builds, staff login →
session survives app restart → `me.get` through the Cookie-header link →
forced `change-password` flow → logout → verify user-scoped cache and persisted
context are cleared. This is the only Step-0 product flow; do not add a domain
list or money operation. Prove payment idempotency and reversal later inside
the Fees slice against its real workflow.
