# Mobile Step 0 — Expo foundation and native UX proof

**Status:** Ready to start. Prototype review gates the production shell and shared UI, not the initial planning/proof work.
**Scope:** Planning/design outputs plus the bounded Expo foundation and staff-auth proof. No domain CRUD and no student/family screens.
**Product context:** One Expo iOS/Android app for this multi-tenant school SaaS. Organization is the tenant; schools are branches. Staff/admin journeys ship before family journeys. Public-site editor/admin preview is explicitly out of mobile scope by owner decision.

## Goal and completion evidence

Create a real native Expo app foundation that future agents can extend without copying web layouts or inventing APIs. Prove staff login, forced password change, session persistence after process restart, authenticated `me.get` over tRPC using the native Cookie header, and logout/session-boundary cleanup on both iOS and Android development builds. Establish an owner-reviewed mobile navigation and visual direction before turning the temporary authenticated route into the production shell.

Completion requires:

- A version-pinned Expo workspace that installs/builds as a development client on iOS and Android; package versions are compatible with the selected Expo SDK and recorded here.
- A minimal native route/auth shell with safe hydration, loading and recoverable error states; wrong session kind and forced password change cannot strand the user.
- `me.get` is reached through the app's typed tRPC client with `Cookie: await authClient.getCookie()` and native `credentials: "omit"`; no runtime import from `@repo/trpc`, `@repo/db`, or server-only code.
- Session survives a full app restart; logout clears SecureStore session, active-context persistence, user-scoped query state, and cancels outstanding user-scoped requests.
- The three required journeys have owner-reviewed phone-sized prototypes and a recorded navigation decision before production tabs/shared UI are locked.
- Existing repo type/lint gates pass for touched packages. Device walkthrough evidence is recorded for both platforms. Do not claim completion from typecheck or web rendering alone.

## Explicit exclusions

- No student setup, roster, attendance, homework, fees, exams, or other CRUD/domain workflow.
- No family/student route group yet; it ships after staff parity.
- No public-site editor or admin preview in mobile.
- No web DOM, Next.js, shadcn, CSS layout, iframe/WebView, or screenshot-to-RN port.
- Do not decide the final staff tab set from role names or web sidebar. Do not choose native tabs solely because an older plan or example used them.
- Do not add an offline write queue in this foundation. Resolve the online-first proposal with the owner before attendance/photo capture work.

## Required references and skills

Before each implementation chunk, re-check these sources against the selected SDK/library versions; the links below are starting points, not permission to copy an unchecked snippet. Record the selected versions, the exact pages consulted, and any discrepancies in this file.

Official/maintainer documentation:

- Expo SDK compatibility and package install: https://docs.expo.dev/versions/latest/ and https://docs.expo.dev/more/expo-cli/
- Expo Router authentication and protected routes: https://docs.expo.dev/router/advanced/authentication/
- Expo development builds: https://docs.expo.dev/develop/development-builds/introduction/
- Expo monorepos: https://docs.expo.dev/guides/monorepos/
- Better Auth Expo integration (server plugin, client plugin, SecureStore, cookie handling, trusted origins): https://www.better-auth.com/docs/integrations/expo
- Expo Router testing: https://docs.expo.dev/router/reference/testing/
- TanStack Query React Native focus/online handling: https://tanstack.com/query/latest/docs/framework/react/react-native
- React Native accessibility and platform behavior: https://reactnative.dev/docs/accessibility

Applicable skills consulted for this work: `mobile-app-ui-design`, `mobile-design`, `expo-project-structure`, `expo-router`, `expo-data-fetching`, `expo-design-system`, and `expo-dev-client`. Use `expo-native-ui` / `expo-ui` when choosing native controls or sheets, and `vercel-react-native-skills` when implementing non-trivial lists/performance. Skills guide review; pinned-version documentation and maintainer references decide API correctness.

## Work sequence

### A. Product journeys and prototype review — gate before production shell

1. Reconcile the three journeys against `docs/PRD.md`, permissions, actual web workflow behavior, and the tRPC router. Identify actors, jobs, entry/completion, interruptions, permission boundaries, offline assumptions, and recovery.
2. Audit web logic reuse candidates. Reuse only pure, tested domain helpers where they have no browser/server-only dependencies and preserve the same domain invariants. Do not transplant web hooks, forms, navigation, or UI. Record candidates, evidence, and rewrite decisions in the journey brief.
3. Create phone-sized native prototypes/wireflows in `docs/design/mobile/` for:
   - Teacher takes attendance for a section between periods.
   - Accountant finds dues, records a collection, and recovers safely after an ambiguous timeout.
   - Front-office staff admits a student and assigns a section.
4. Include principal cross-branch context switching in the navigation review. Show the owner the rendered prototypes, capture feedback, and record approved information architecture, tab destinations, and platform-specific decisions. Keep the final tab set open until this gate passes.
5. Record relevant empty/loading/error/offline/permission-denied/submitting/success/resume/draft states, keyboard and screen-reader behavior, touch-target decisions, and source references. Do not make a flat set of desktop cards the mobile design.

### B. Foundation and auth proof

1. Inspect workspace package-manager/Turbo conventions and the current Expo SDK compatibility table. Create `apps/mobile` using the agreed Expo Router structure; pin the stable SDK and compatible dependencies using Expo's version-aware installer; commit no generated/native build artifacts unless repo conventions require them. Add the minimum workspace scripts/config only.
2. Establish app identifiers, `mskool://` scheme, environment validation for `EXPO_PUBLIC_API_URL`, and a development-build profile. Never put secrets in public Expo env variables. Confirm real-device API origin configuration works on both platforms.
3. Add the server-side Better Auth Expo plugin and trusted origins additively, following the pinned Better Auth docs. Preserve existing username auth configuration. Configure the mobile client with Expo integration and SecureStore; do not reuse the web-configured client instance.
4. Build typed tRPC/TanStack Query plumbing around `import type { AppRouter }` only. Inject the Better Auth Cookie header asynchronously and set native credentials to omit. Wire app foreground and network connectivity to query focus/online managers per current TanStack guidance.
5. Build the minimal login, forced-password-change, guarded staff route, temporary `me.get` view, and sign-out. Hydration must finish before protected-route redirects. After password change, refetch authenticated session and `me.get`; do not trust a local flag.
6. Bind active context to the authenticated user and validate persisted organization/branch against `me`. On login/logout/user switch, cancel old user-scoped requests and clear both query and persisted user context so late responses cannot cross sessions.
7. Inspect the runtime import graph before using any shared validation schema. `@repo/contracts` currently reaches Drizzle/DB. If the client bundle cannot prove those absent, keep schemas out of mobile runtime or extract a client-safe entry/package with no DB, Drizzle, Node APIs, or server env. Router output types remain type-only.

### C. Verify and hand off

1. Add focused unit/component tests for route guards, auth hydration/forced-change routing, error mapping, and user-session cache isolation using the currently supported Expo Router/Jest setup. Test behavior, not snapshots as a substitute for UX review.
2. Run relevant repo gates, including `pnpm check-types` and lint. Do not run unrelated test suites; run the focused mobile tests and report their exact commands/results.
3. On iOS and Android development builds, walk: login → `me.get` identity/permissions → force password change when applicable → terminate/restart → still authenticated → logout → prior user's data/context absent. Include API/network failure and retry during the walk.
4. Attach concise evidence (device/platform, build/runtime versions, route walked, outcomes, known gaps) to this plan and update the mobile route parity ledger plus `docs/TASKS.md` status. Do not commit or push.

## Open decisions / stop conditions

- Stable Expo SDK and exact package versions are selected during scaffold from the official compatibility table; do not pre-bake a stale SDK number into the plan.
- Final tabs, native-tabs API, and shared visual system require the prototype review gate. Use a stable, documented navigation API for the chosen SDK; record why native tabs or JS tabs fit the approved journeys and accessibility needs.
- Online-first behavior without a background write queue is only a proposal; owner decision is required before attendance/photo slices.
- Stop before changing server auth if the pinned Better Auth docs or actual repo configuration conflict with the additive plugin/trusted-origin plan; document the concrete conflict and a safe alternative.
- Stop before shared runtime schemas if the Metro/bundle graph contains server/database code.
- If a real-device API origin, signing/dev-client setup, or test environment is unavailable, finish independent planning/code work and record the precise blocked proof; do not imply device validation passed.

## Foundation status (2026-10-14, end of build session)

Built (plan §B.1–B.5): workspace + SDK 57 pin, `mskool://` scheme,
`com.mskool.app` identifiers, `src/env.ts` (`EXPO_PUBLIC_API_URL`),
server `expo()` plugin + trusted origins (additive), mobile auth client
(SecureStore), tRPC Cookie-header link, TanStack lifecycle wiring, error
port, `useMe` / active-context / session-boundary hooks, route shell
(`(auth)` login + forced-change, guarded `(staff)` + temp `me.get` view),
`eas.json` development profile, `expo-dev-client`, Jest stack
(`errors.test.ts` 16/16), Atlas + transport proofs above.

Gates: mobile `tsc` green, `@repo/auth` + `@repo/api` `tsc` green, full
`pnpm check-types` 8/9 — the single failure is PRE-EXISTING and unrelated:
`apps/web/.../textarea.tsx` imports `{ cn } from "cn"` (commit `aa6bc31`,
site editor), but web tsconfig maps only `@/*` and no `cn` package exists.
Untouched by this work; left for its own fix, not swept in here.

Fixes recorded along the way:
- `expo doctor` is not a local-CLI command → `pnpm dlx expo-doctor`.
- Typed-routes group redirect is `/(staff)`, not `/(staff)/`.
- `onlineManager.setEventListener` returns void — keep the inner cleanup.
- Foreground `me` refetch uses `useUtils().me.get.invalidate()` (v11 has no
  `getQueryKey` on the proxy).
- tsconfig needs explicit `"types": ["jest", "node"]` for test globals.
- Hooks with JSX must be `.tsx` (`use-active-context.tsx`).
- `@repo/trpc` is a mobile dep for types (as on web); all imports type-only.

Still open (Step 0 exit needs these):
1. Device walk: **Android dev-build walk COMPLETE 2026-10-17** (emulator-5554,
   local `expo run:android` — leg table + evidence in the walk section below).
   The walk's three findings are **fixed and re-walked on device** (w22–w24
   in that section). iOS walk still open: needs a Mac or an EAS gateway build
   — deferred by owner decision; do not imply it passed.
2. Prototype review gate: **PASSED 2026-10-18** — owner approved the rendered
   probe (`docs/design/mobile/prototype/shots/native/`) and the navigation
   decision (JS tabs, Home / Attendance / More); shell + attendance slice
   build per `.kilo/plans/2026-10-18-mobile-shell-attendance.md`.
3. Router-integration tests (`renderRouter` guards) — L1 unit done, L3 open.

## Transport proof (2026-10-14, live dev API + seeded DB)

Proven over HTTP with the exact native transport (manual `Cookie` header,
no cookie jar — curl stands in for the SecureStore-backed link; PowerShell's
`Invoke-RestMethod` cannot set `Cookie` via `-Headers` on .NET, it drops it):

1. `POST /api/auth/sign-in/email` (`admin@demo-trust.test` / `Password123!`)
   → 200 + `better-auth.session_token` cookie. Wrong password → 401 generic
   (uniform refusal, no enumeration). The `expo()` server plugin and the new
   trusted origins break nothing on the existing flow.
2. `GET /trpc/me.get` with `Cookie: better-auth.session_token=…` → 200 with
   full identity: org_admin memberships (demo-trust + owner's second org),
   `mustChangePassword: true` (re-armed via the `@repo/auth/credentials`
   seam), `portal: null`.
3. `POST /api/auth/change-password` (current verified, `Origin:` trusted —
   better-auth rejects origin-less POSTs with `MISSING_OR_NULL_ORIGIN`) →
   200 and the response user already reads `mustChangePassword: false`.
   Follow-up `me.get` confirms the flag cleared server-side.
4. Session rotation observed: with `revokeOtherSessions: true` the old cookie
   401s afterwards and the new token arrives via `Set-Cookie` — the mobile
   change screen's `getSession()` + `me.get` invalidate sequence handles
   exactly this; never trust a local flag.

Seed note: this dev DB had users but the admin password was unknown, so
`pnpm db:seed` was run (idempotent, all-exists) and the admin login re-armed
to `Password123!` / flag-true, then restored to `Password123!` / flag-false
after the loop. End state is the seed-known password. `pnpm db:seed` must run
as `pnpm db:seed` (root dotenv wrapper) — the package script alone has no env.
Demo login left as seed expects; device walk re-arms the flag if it wants
the forced-change path.

## Scaffold record (2026-10-14)

Pinned at scaffold via `pnpm create expo-app` (default template) + `expo install`
resolution. Toolchain: Node v22.14.0 (meets SDK 57 minimum 22.13.x), pnpm 9.12.0.

| Package | Pinned |
|---|---|
| `expo` | ~57.0.28 |
| `expo-router` | ~57.0.26 |
| `react` / `react-dom` | 19.2.3 |
| `react-native` | 0.86.3 |
| `@expo/ui` | ~57.0.23 |
| `typescript` | ~6.0.3 |
| `@repo/env`, `zod@^4.4.3` | added for `src/env.ts` |

App identity: name/slug `mskool`, scheme `mskool://`,
`ios.bundleIdentifier` + `android.package` = `com.mskool.app`.
`EXPO_PUBLIC_API_URL` in root `.env` (LAN IP for physical devices) +
`turbo.json` build/dev env. Package renamed to `@repo/mobile` with
`check-types` script; template demo UI (`components/`, `constants/`,
`hooks/`, `explore.tsx`, `global.css`, `reset-project.js`) removed and
replaced with a minimal `Stack` shell + placeholder index pending the
auth-plumbing chunk. Template `README.md` replaced with a workspace pointer.

Corrections vs plan text:
- Doctor runs as `pnpm dlx expo-doctor` from `apps/mobile` (21/21 pass);
  `expo doctor` is unsupported in the local CLI.
- `expo install --check`: dependencies up to date.
- Skill conflict resolved: `expo-project-structure` suggests `src/server/` +
  `app/api/` routes — rejected per `docs/MOBILE_PLAN.md` (no `src/server`,
  no `app/api`; `apps/api` stays the only server). `src/app` is routes-only.
- `tsc --noEmit` green after demo-UI removal (template `.css` imports had no
  declarations under the repo gate).

L0 export + Atlas baseline: `expo export --platform android` green
(1241 modules, 2.7MB hbс). `EXPO_ATLAS=true` export wrote
`.expo/atlas.jsonl` (13MB). Baseline scan clean.
Note: Expo CLI cannot auto-install `expo-atlas` under pnpm workspaces
(`ERR_PNPM_INCLUDED_DEPS_CONFLICT`); it is a manual devDependency
(`expo-atlas@^0.4.0`).

## Contracts runtime spike — VERDICT: unsafe, do not import (2026-10-14,
re-run 2026-10-15 with full classification)

Method: temp route importing only `createStudentSchema` from
`@repo/contracts`, `expo export --platform android` (1834 modules, 5.3MB vs
1616 / 4.3MB clean), every bundled module classified by path. Spike reverted
after (`@repo/contracts` dep removed, route deleted, clean re-export
verified at 1616 modules / 4.3MB).

Correction to the first run's wording ("104 server modules" undercounted —
workspace files resolve as `packages/…`, not `@repo/…`, so the path regex
missed them). Exact classification of the import's footprint:

| Class | Modules | Source bytes | Contents |
|---|---|---|---|
| A — workspace table/contract definitions | 33 | ~511KB | `contracts/index` barrel + 19 contract files; `db/schema` barrel + 12 table files |
| B — drizzle-orm runtime | 102 | ~356KB | full pg-core column catalog, table/sql/relation helpers |
| C — drizzle-zod runtime | 1 | ~13KB | schema derivation |
| D — connection / server-only code | 0 | 0 | no `postgres`/`pg` driver, no db client, no adapters, no services |
| E — adjudicated client-safe | 1 | ~9KB | `better-auth/dist/db/schema.mjs` (field helpers, also in web bundle) |

So the reviewing agent's distinction is upheld: no connection code rides
along (class D is empty), and Metro does not fail. The ban nevertheless
stands, on coupling rather than breakage: one form schema drags the entire
data-definition layer plus the ORM into the phone bundle (+1.0MB, +217
modules), and every future schema edit reshapes what phones download. That
is the wrong boundary even where nothing crashes.

Standing decision: no runtime `@repo/contracts` imports in mobile. The first
slice needing form validation extracts a client-safe Zod-only entry (no
`@repo/db`, no Drizzle, no barrels) — or re-runs this spike. Row shapes were
never candidates: they stay `inferRouterOutputs` type-only.

Auth-chunk re-proof (2026-10-14, 1616 modules, 4.3MB): path-based scan of
every bundled module for real server packages —
`/node_modules/(drizzle-orm|drizzle-kit|drizzle-zod|postgres|pg|kysely)/`,
`@repo/(db|services)` runtime, `better-auth/dist/(db|adapters)/` — returns
exactly one hit: `better-auth/dist/db/schema.mjs` (9KB). Verified
client-safe: pure field-definition/parsing helpers (`mergeSchema`,
`parseSessionInput`, …), imports only `@better-auth/core` utils, pulled in
by the client's own cookie handling. The same file ships in the web browser
bundle today via `better-auth/react`. No data-layer, driver, adapter, or
connection-string module anywhere in the graph. Scan method lives in this
entry; naive substring greps false-positive on the pnpm store dir names
(`…_drizzle-orm@0.45.2_…`) and on the leak-guard regex in `lib/errors.ts`
(which names those keywords by design).

## Native build resolution + device walk (2026-10-16/17, Windows host)

### What unblocked the Android build

Three environment fixes were needed. The generated-file ones are now carried
in-repo by `apps/mobile/plugins/with-cmake-path-limit.js` (registered in
app.json) — **`expo prebuild --clean` is safe again**: re-run 2026-10-17, the
regenerated `android/` rebuilt green (475 tasks, BUILD SUCCESSFUL) and the
reinstalled app booted on the emulator (w25):

1. `apps/mobile/android/build.gradle` (generated): the RN/Expo
   `ExternalNativeBuild` gradle blocks get two extra CMake arguments —
   `-DCMAKE_OBJECT_PATH_MAX=255` and `-DCMAKE_SUPPRESS_REGENERATION=ON` —
   injected by the config plugin on every prebuild.
2. `.npmrc` (committed): `virtual-store-dir-max-length=12` keeps pnpm store
   dir names ~27 chars so CMake/Ninja paths inside `node_modules` stay away
   from Windows' 260-char limit.
3. Metro must run with `EXPO_NO_METRO_WORKSPACE_ROOT=1` in this pnpm
   monorepo (see below).

CMake `OBJECT_PATH_MAX` semantics, proven against the cmake 3.22.1 source
(`cmLocalGeneratorCheckObjectName`) and build probes — generic advice gets
this wrong:

- The limit must be strictly ABOVE the absolute object directory (~172 chars
  in this pnpm tree). Below that, CMake refuses to shorten any object path
  ("cannot be safely placed") and every long path stays long — that is why
  `128` made things worse, not better.
- A path is shortened only when its unshortened length EXCEEDS the limit;
  the shortened path is capped at the limit; the limit must also exceed
  `objectDir + filename + 33`.
- `90` was silently ignored (the effective default, 250, applied).
- `255` works: full build green, previously-unshortened deep objects hashed,
  zero path warnings, worst absolute object path 253 chars, worst `.d`
  sidecar 255 (keep the limit ≤255 so ninja's sidecars stay under 260).
- `-DCMAKE_SUPPRESS_REGENERATION=ON` kills the RERUN_CMAKE / "manifest still
  dirty after 100 tries" ninja loop (no-input phony target) permanently.

Other environment rules:

- Do NOT swap the SDK's ninja 1.10.2 for 1.12.1 (tried; irrelevant).
- Manual gradle CMake task runs must pass `-PreactNativeArchitectures=x86_64`.
- After any node_modules reinstall: `gradlew --stop`, delete
  `android/.gradle`, `android/build`, `android/app/build`, `android/app/.cxx`.

### Metro must not use the workspace root in this repo

Without `EXPO_NO_METRO_WORKSPACE_ROOT=1`, Metro resolves the project-relative
entry `node_modules/expo-router/entry` against the monorepo root, where
pnpm-isolated installs have no `expo-router` → the bundle 404s. Root cause:
`getMetroServerRoot`/`resolveWorkspaceRoot` in `@expo/config`
(`env.EXPO_NO_METRO_WORKSPACE_ROOT` is the supported escape hatch). Hoisted
installs mask the bug. Persisted 2026-10-17 in the committed
`apps/mobile/.env` (root `.gitignore` carries a narrow exception for that
file): the Expo CLI loads and exports it for every command — verified with
`prebuild`, `expo start`, and `expo run:android` with no shell variable set;
`entry.bundle` now HTTP 200 (6.4 MB) — the request that 404'd before. EAS
cloud builds: verify at the EAS gate — `eas.json` `env` is the lever if the
worker needs it.

### How to run the dev loop (Windows, this repo)

- Metro (workdir `apps/mobile`): `pnpm exec expo start --dev-client` — the
  `EXPO_NO_METRO_WORKSPACE_ROOT=1` fix comes from the committed
  `apps/mobile/.env` automatically; no shell variable needed.
- API (workdir `apps/api`):
  `pnpm exec dotenv -e ../../.env -- tsx watch src/index.ts`
- Deep link into a running dev client (emulator):
  `adb shell am start -a android.intent.action.VIEW -d "exp+mskool://expo-development-client/?url=http%3A%2F%2F<LAN-IP>%3A8081"`
- The LAN IP floats via DHCP (was 192.168.0.101 during the walk) — re-check
  before each walk session; `.env.local` points `EXPO_PUBLIC_API_URL` at it.
- Bundle chain verified end-to-end: dev-client manifest → LAN Metro
  `/node_modules/expo-router/entry.bundle` → HTTP 200, 8.3 MB.

### Device walk record — Android, emulator-5554 (2026-10-17)

Build: local `pnpm exec expo run:android --no-bundler` (BUILD SUCCESSFUL,
~4m47s, 475 tasks) + APK install; dev client over LAN Metro; API live on the
host. Screenshots kept locally in `apps/mobile/.expo/walk/` (w01–w21 plus
side-captures; `.expo` is gitignored).

| # | Leg | Result |
|---|---|---|
| 1 | Cold start → login | PASS — clean login screen |
| 2 | Wrong password → designed error copy | PASS + API `Invalid password` WARN |
| 3 | Correct password, user ARMED | **FINDING 1** below — server-side sign-in succeeded (session row) but the app bounced to an EMPTY login and dead-ended. *Re-walked after the fix: lands on `/change-password` (w22).* |
| 4 | Cold start with persisted armed session → `/change-password` | PASS (hydration took >12 s in dev — wait longer than that before judging a blank frame) |
| 5 | Mismatch error | PASS — "The new passwords don't match." |
| 6 | Set password → staff home | PASS — `must_change_password=false`; better-auth rotated the session as designed |
| 7 | Cold start, flag cleared → staff home | PASS — SecureStore persistence proven |
| 8 | Sign out → login | PASS — server session revoked (0 rows) |
| 9 | Sign in with the new password → staff home | PASS |
| 10 | API stopped → sign-in attempt | **FINDINGS 2 + 3** below — spinner held ~2.5 min, then a RAW technical error string reached the screen. *Re-walked after the fix: friendly network copy within the 15 s bound; retry after API restart → staff home (w23c, w24).* |
| 11 | Restart API → tap again (fields retained) | PASS — staff home |

Findings from the walk — **all fixed and re-walked on device (2026-10-17,
evidence w22–w24)**:

1. **Post-sign-in redirect race (armed users).** Root cause confirmed in
   `@better-auth/expo` 1.6.23: a successful sign-in only *notifies* the
   session atom (`notify("$sessionSignal")` after the cookie write) — it does
   not set the new session data, which arrives via an async refetch. So
   `router.replace("/")` could mount `index.tsx` on the stale signed-out
   atom → redirect to `/login`, whose guard only redirected when the flag was
   clear → the armed session dead-ended on an empty form. Fixed twice over:
   login's guard now routes any settled session on (armed →
   `/change-password`, clear → `/`), and the sign-in submit settles the
   session first (`refetchSession()`, bounded 4 s via `bestEffort`) so the
   bounce does not happen in the first place. Evidence: w22 — armed sign-in
   lands directly on the forced-change screen.
2. **Technical error leak.** `looksTechnical` extended with the native
   transport class (`fetch failed`, `ConnectException`, `failed to
   connect`, `java.net`, `Network request failed`, `ETIMEDOUT`/`ECONNRESET`/
   `ECONNREFUSED`/`ENETUNREACH`, `aborted`) plus unit cases. Evidence: w23c —
   the user sees "Couldn't reach the server. Check your connection and try
   again.", never the raw exception.
3. **No client-side timeout.** New `lib/with-timeout.ts`: `withTimeout`
   (AbortController, 15 s default) wraps every better-auth call in
   `lib/auth.ts` (sign-in, phone sign-in, change password, sign out);
   `bestEffort` bounds waits on work that takes no signal. Evidence: w23c —
   error state visible ≈15 s after submit (previously ~2.5 min), fields
   retained, button re-enabled; w24 — retry after the API came back reaches
   the staff home. Unit coverage: `with-timeout.test.ts` (4 cases; mobile
   suite 21/21). The tRPC link is deliberately **not** timed out yet: its
   fetch receives query-cancellation signals, and combining those safely
   (AbortSignal.any availability on Hermes 0.86) is an open check — recorded,
   not guessed.

Foundation completion while re-walking: `expo lint` had half-configured
itself on first run (added `eslint.config.js` + `eslint-config-expo` but no
`eslint` binary) — added `eslint@^9` to `apps/mobile` devDeps, fixed the one
error it surfaced (`_layout.tsx` wrote a ref during render → post-commit
effect), mobile lint now green.

Minor observations (polish, not blockers): stack headers show raw route
names ("login", "change-password", "index"); dev cold start shows white
frame(s) before the first app frame (dev JS boot) — verify splash behavior
on a preview build.

Seed-state note: the walks re-armed the demo admin (`Password123!`, flag
true) via a temporary helper; afterwards the helper restored the seed state
(`Password123!`, flag false), the orphaned re-walk session row was deleted
(0 sessions), and all temporary scripts/DB probes were removed. Do not leave
the demo DB armed.

## Repository context

Follow `AGENTS.md`, `docs/MOBILE_PLAN.md`, `docs/CONVENTIONS.md`, `docs/DECISIONS.md`, and `docs/TASKS.md`. The route parity ledger and phase order in `docs/MOBILE_PLAN.md` remain canonical. Update `docs/TASKS.md` when this chunk is complete. Never commit or push.
