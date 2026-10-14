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

## Repository context

Follow `AGENTS.md`, `docs/MOBILE_PLAN.md`, `docs/CONVENTIONS.md`, `docs/DECISIONS.md`, and `docs/TASKS.md`. The route parity ledger and phase order in `docs/MOBILE_PLAN.md` remain canonical. Update `docs/TASKS.md` when this chunk is complete. Never commit or push.
