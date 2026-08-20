# Frontend: School Administration Console (Phase 1–2 surface)

Build the web UI for the currently-buildable backend surface — `me`, schools (branches),
academic years (sessions), classes, sections — on a responsive, plain-language foundation
that Phases 3–5 (attendance, fees, marks) inherit.

## Goal

An `org_admin` or `principal` can sign in and stand up a school's entire academic skeleton
from a phone or an office desktop, without meeting a UUID, a Postgres constraint name, or
the word "deactivate".

---

## Workflow protocol — read before starting

**One chunk per turn. The user commits, not you.**

1. Implement **exactly one** chunk. Do not begin the next one.
2. Run that chunk's **Verify** steps.
3. Tick that chunk's boxes **in this file**, as part of the same diff. Only what actually
   passed Verify — an unticked box in a finished chunk is a finding to report, not an
   oversight. The ticks live in the commit under review, so rejecting the chunk reverts the
   plan's state along with the code, and the file never claims more than the tree delivers.
4. Run `git status` and `git diff --stat`, and summarise what changed and why.
5. Propose the commit message from that chunk verbatim.
6. **Stop and wait.** The user reviews the diff and commits.

**Never run** `git add`, `git commit`, `git push`, `git checkout`, or any history-rewriting
command. Never chain two chunks in one turn, even if a chunk is small.

Every chunk must leave `pnpm check-types` green and the app bootable. If a chunk cannot be
finished cleanly, stop and report rather than leaving a broken intermediate state.

---

## Preconditions (no diff; do once, before Chunk 1)

- [x] Browser CLIs installed globally: `@playwright/cli@0.1.18` (`playwright-cli`) and
      `agent-browser@0.27.0`. **Use `playwright-cli` only** — running both in one session
      creates two browsers and confusion over which holds the saved auth state.
- [x] `pnpm dev` (web :3000, api :4000) and `pnpm db:seed` for the three seeded logins.
- [x] Save an auth state per role once, then reuse it instead of retyping credentials:
      `playwright-cli open http://localhost:3000/login` → sign in → `playwright-cli state-save
      auth-orgadmin.json` (repeat for principal and class_teacher). Done: `auth-orgadmin.json`,
      `auth-principal.json`, `auth-classteacher.json` at the repo root, gitignored because each
      holds a live session cookie.
- [x] Confirm `apps/web/node_modules/next/dist/docs/01-app/` is present — the pinned Next 16
      App Router docs, preferred over web search.

---

## Hard context an implementer must know

**Type chain.** `apps/web` imports **only** `import type { AppRouter } from "@repo/trpc"`.
Never runtime code from `@repo/trpc`, `@repo/db`, `@repo/services`. Zod schemas come from
`@repo/contracts` (the package entry — never a path into its `src/`).

**This is a Base UI shadcn project, NOT Radix.** `components.json` style is `base-mira`;
`dropdown-menu.tsx` imports `@base-ui/react/menu`. Use **`render`**, not `asChild`. No
`@radix-ui/*` deps exist. Package manager is **pnpm** → `pnpm dlx shadcn@latest …`.

**Every staff call carries scope** (`packages/trpc/src/trpc.ts:42`):
`{ organizationId, schoolId?, classId?, sectionId? }`.

- **Lists** (`staffListProcedure`): send `organizationId` only. The server clips grants to the
  addressed subtree, so a principal automatically sees just their branch. `schoolId` is an
  *optional narrowing*.
- **Creates/mutations**: **must** send `schoolId`. `requireSchoolId`
  (`academic.service.ts:160`) throws a plain `Error` → 500 if absent.

**`permissions` from `me.get` is a render hint only** — never a gate. Authorization is
server-side `can()` (ADR-017).

**Year visibility is a permission** (ADR-024): `academic_year:read_history`, held by default by
`principal`, `vice_principal`, `accountant`. Without it a caller sees only the current session,
enforced server-side in the year/section joins.

**Existing quirks to work around**
- `Navbar` is in the **root** layout (`app/layout.tsx:28`) → renders on `/login`. Move it.
- `login-form.tsx:43` calls `router.push` **during render**. Fix.
- `librarian` has no `school:read` → `me.memberships[].schools === []`. Must not break the UI.
- `academic.year.current` returns **NOT_FOUND** when no session is flagged — a normal first-run
  state, not an error.
- `docs/TASKS.md` is stale: the `components.json` css path is already correct, and
  `pagee.tsx` / `spinner4.tsx` no longer exist.
- **Classes are not year-scoped** — `createClass` needs only `schoolId`. Only *sections* require
  a session. This governs how the first-run checklist gates its steps.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Data fetching | Client-side tRPC + TanStack Query throughout. Keep the server session gate in `(dashboard)/layout.tsx`. |
| Tables | Adopt `@tanstack/react-table`. One `DataTable` wrapper. |
| List archetypes | Reference lists: cards <768px / table ≥768px. Data grids (Phase 3+): always table, horizontal scroll + sticky first column, filters in a `Sheet`. |
| Responsive switch | CSS (`md:hidden` / `hidden md:block`). No JS breakpoint detection — causes hydration mismatch. |
| Nav | Sidebar ≥1024px; bottom tab bar + hamburger `Sheet` below. |
| IA | Home · Branches · Sessions · Classes · Profile. **Sections nested under a class**, not top-level. |
| Org switcher | Render only if `memberships.length > 1`. |
| Branch switcher | Render only if `schools.length > 1`. Required before any create. |
| Session picker | Default `academic.year.current`; offer past sessions only if `read_history` and >1 session. |
| Context persistence | localStorage, **validated against `me.get` on load**; drop stale/revoked ids. Not in the URL. |
| Unauthorized actions | **Hidden**, not disabled. Server remains the only gate. |
| Language | English only, plain wording. Copy centralized so Hindi/regional is additive. |
| Dates | `DD/MM/YYYY` displayed, ISO `YYYY-MM-DD` on the wire. |
| Toasts | Keep `sonner` (already wired in the root layout). |
| Theme | Swappable at any time — see "Changing the theme" below. Never hardcode a colour; always use paired semantic tokens. |
| Browser automation | `playwright-cli`. Not `agent-browser`, not both. |
| Web unit tests | No harness added. Verification is `check-types` + `playwright-cli` + the three seeded logins. |

**Terminology (user-facing).** School → **Branch** (when >1); Academic Year → **Session**;
Deactivate → **Close** / **Archive**, always with "records are kept". Class and Section keep
their names.

---

## Changing the theme

The user intends to replace the current theme. Two different operations, with very different risk:

- **Theme** — colours, radius, fonts, i.e. the CSS variables in `globals.css`. Safe at any time:
  `pnpm dlx shadcn@latest apply <code> --only theme`. Inspect first with `preset resolve`
  (current) and `preset decode <code>` (incoming).
- **Style** — `base-mira` → another style. This **regenerates the source of `components/ui/*`**
  and overwrites local edits. Only with `--dry-run` / `--diff` first, and never without asking.

Four rules keep a later theme swap free:

1. Never hardcode a colour (`bg-blue-500`, `text-emerald-600`, hex). Semantic tokens only.
2. Never hand-write `dark:` colour overrides — the `.dark` block already handles it.
3. Never hand-edit `components/ui/*`. Customisation lives in the wrappers in `components/`
   (`DataTable`, `FormDialog`, …), which is how this plan is structured anyway.
4. Always use **paired** tokens: `bg-primary` with `text-primary-foreground`. Never `text-white`
   on `bg-primary` — that is exactly what breaks when primary flips from light to dark.

**Fonts are a special case.** `--font-sans` comes from next/font (`Outfit`, `layout.tsx:11`) and is
mapped in `@theme inline`. A preset's font block can fight that, so prefer `--only theme` for
colours and change fonts by hand in `layout.tsx`.

**Do the swap in Chunk 3b, before any visual work.** Applied later, it invalidates Chunk 6's
contrast check and Chunk 12's visual QA, both of which then have to be redone.

---

## Skills and tools

All five live in `.agents/skills/` and are already installed — nothing to add. If the `skill`
tool reports a name as unavailable, the session predates its installation; read
`.agents/skills/<name>/SKILL.md` directly instead.

- **`shadcn`** — load for every chunk touching UI (3, 3b, 6–12). Enforces `FieldGroup`/`Field`
  forms, `data-icon` button icons, `gap-*` over `space-y-*`, `Empty` for empty states, `size-*`,
  items-inside-groups, no manual z-index. Run `pnpm dlx shadcn@latest docs <component>` and
  **fetch the returned URLs** — Base UI APIs differ from the Radix examples most sources show.
- **`frontend-design`** — load for chunks 6, 7, 12, and take it **selectively**. The skill is
  written for a studio pitching a distinctive brand page; this is a utility console for
  low-digital-literacy staff on budget Androids, where predictability beats memorability.
  - **Adopt:** its writing guidance (name things by what people control, not how the system is
    built; one action keeps one name across button, dialog and toast; errors state what happened
    *and* the fix; empty screens invite action; each element does exactly one job) and its quality
    floor (responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected,
    critique your own work against screenshots).
  - **Ignore:** "take one real aesthetic risk", "signature element", and any invention of a
    palette or type identity. The tokens live in `globals.css` and the user owns that choice.
- **`playwright-cli`** (`@playwright/cli@0.1.18`) — load for chunks 7–12. Mapped to this plan:
  `resize 360 640` / `414 896` / `768 1024` / `1024 768` / `1366 768` for the responsive matrix;
  `state-load auth-<role>.json` to switch seeded roles instantly; `route "**/trpc/**"
  --status=500` to force the error state; `localstorage-set` to test stale-context discard
  directly; `console` to catch hydration warnings; `find` to assert text without a full snapshot;
  `screenshot` for the self-critique loop; `show --annotate` to collect design feedback from the
  user on a live page.
- **`agent-browser`** (installed, **unused**) — recorded only so a later agent does not
  reintroduce it alongside `playwright-cli`.
- **`find-skills`** — only if a genuinely missing capability appears.
- **Next.js docs, pinned locally:** `apps/web/node_modules/next/dist/docs/`. Use `01-app/` for
  App Router; **ignore `02-pages/`** (Pages Router, unused). Prefer these over web search — they
  match the installed version. Read-only; never edit anything under `node_modules`.

---

## Chunk 1 — friendly database errors

Do this first; good UX is impossible without it, and it removes a 500 the UI would otherwise
have to work around.

- [x] Middleware in `packages/trpc/src/trpc.ts`, applied to both staff builders, wrapping
      `next()` and translating:
      - Postgres `23P01` / `23505` / `23514` **by constraint name** → `TRPCError` `CONFLICT`.
      - Plain service `Error`s (`requireSchoolId`, cross-school parents in `createSection`,
        "Failed to create…") → `BAD_REQUEST` / `CONFLICT` with user-safe text. Never leak
        developer-facing strings.
- [x] Constraint→message map in a new `packages/trpc/src/errors.ts`:
      - `academic_years_no_overlap_excl` → "These dates overlap the session {name} ({start} – {end})."
      - `academic_years_school_name_uq` → "This branch already has a session named {name}."
      - `academic_years_one_current_excl` → "Another session is already the running session."
      - `academic_years_end_after_start` → "The session cannot end before it starts."
      - `classes_school_name_uq` → "{name} already exists at this branch."
      - `classes_school_order_uq` → "Another class already uses that position in the order."
      - `sections_year_class_name_uq` → "{class} already has a Section {name} this session."
      - `schools_org_code_uq` → "Code {code} is already used by another branch."
- [x] ADR in `docs/DECISIONS.md`.

**Verified** (in a prior session): `check-types` 8/8, `smoke:authz` 15/15, `check:openapi`
23 endpoints, and nine live HTTP checks against the seeded fixture, each designed to fail at
the database so nothing was inserted. Landed as `de094fb`.

**Verify** `pnpm check-types`; `pnpm smoke:authz` still 15/15; via `/docs` or curl, a duplicate
session name returns 409 with a human message, and omitting `schoolId` on a create returns 400,
not 500.

```
feat(trpc): translate database constraint violations into friendly errors

The academic and organization services deliberately let Postgres raise instead
of pre-checking, because a SELECT-then-INSERT guard races under concurrency
(ADR-022). Nothing translated those failures, and there was no errorFormatter,
so the most likely first-run mistake surfaced the raw exclusion-constraint text
to the user as a 500.

Adds a middleware on both staff builders mapping known constraint names to
CONFLICT with human-readable messages, and converting plain service Errors —
requireSchoolId and createSection's cross-school parent guards — into
BAD_REQUEST rather than an opaque 500. Both transports share the routers, so
the REST surface benefits identically. Records the boundary choice as an ADR;
the database remains the authority.
```

## Chunk 2 — navbar and login hygiene

- [x] Move `Navbar` from `app/layout.tsx` into `app/(dashboard)/layout.tsx`.
- [x] Remove `router.push` from `login-form.tsx`'s render body (effect or server redirect).
      Done as a server redirect in `(auth)/login/page.tsx`, sharing one session read with the
      dashboard gate via the new `lib/auth-server.ts`.
- [x] Correct the stale web items in `docs/TASKS.md`.

**Two blocking bugs found while verifying, both fixed here** — neither was in the plan, and
the chunk could not be verified without them:

- [x] **`apps/web/src/env.ts` threw in the browser.** `createEnv` validated `process.env` as a
      whole object; a bundler can only inline literal `process.env.NEXT_PUBLIC_FOO` accesses,
      so in the browser it validated an empty object, threw at module evaluation, and took
      `auth-client.ts` and `trpc/client.ts` — the login form — down with it. `createEnv` now
      accepts `runtimeEnv`; `apps/web` passes literals. This would have blocked every chunk
      from 5 onward.
- [x] **The session gate crashed for signed-out visitors.** better-auth returns `200` with a
      JSON `null` body for "no session", so `.session` threw instead of redirecting.
- [x] `autocomplete` on the two login inputs, which the console was asking for.

**Verify** `/login` renders no navbar or profile menu; sign-in redirects once; `playwright-cli
console` shows no render-loop or hydration warning; `pnpm check-types`.

```
fix(web): move navbar out of the root layout and fix login redirect

Navbar was mounted in the root layout, so the sign-in page rendered an app
navigation bar with a profile menu for a user who is not yet authenticated. It
belongs to the authenticated shell, so it moves into the (dashboard) layout.

login-form called router.push during render when a session already existed,
which is a side effect in the render body and can loop. Also corrects three
stale entries in docs/TASKS.md: the components.json css path is already right,
and pagee.tsx and spinner4.tsx no longer exist.
```

## Chunk 3 — dependencies and ui primitives

Generated diff — skim-review, but check each file.

- [x] `pnpm add @tanstack/react-table` in `apps/web`.
- [x] `pnpm dlx shadcn@latest add dialog sheet alert-dialog select table skeleton badge empty sidebar tabs checkbox switch tooltip breadcrumb`
- [x] Review every generated file: Base UI `render` (not `asChild`), `lucide-react` icons,
      aliases matching `components.json`, sub-components inside their groups.

**Four findings that change later chunks:**

- **`@tanstack/react-table` resolved to v9.1.2, not v8.** The API is `useTable` +
  `tableFeatures` + `table.FlexRender`, *not* `useReactTable` + `getCoreRowModel`. Row models
  are registered as feature slots, so sorting state does not exist until `rowSortingFeature`
  is. Every shadcn data-table example on the web is v8 and must be translated. The package
  ships its own skills — read `apps/web/node_modules/@tanstack/react-table/skills/` (start
  with `getting-started`, then `migrate-v8-to-v9`) before writing `DataTable` in Chunk 6.
- **`hooks/use-mobile.ts` arrived as a `sidebar` dependency**, and it is a JS breakpoint
  detector — the thing this plan forbids. It is safe as written (it returns `undefined` until
  after mount, so server and first client render agree), but it hardcodes 768px, while the nav
  breakpoint here is 1024px. Chunk 7 should drive its own layout from CSS and not lean on
  `Sidebar`'s built-in <768px Sheet mode.
- **`TooltipProvider` is not mounted anywhere.** The CLI asks for it in the root layout; it
  only shares a delay between tooltips, and `base-mira`'s `sidebar` does not use tooltips at
  all, so it is deferred to Chunk 7 — mount it in the dashboard shell when the first tooltip
  lands, not on `/login`.
- **The shared Next tsconfig had no DOM lib** (`base.json` sets `lib: ["ES2022"]`), so
  `window` and `document` did not exist for `tsc` and the generated `sidebar` /
  `use-mobile` failed the gate with nine errors. Fixed in
  `packages/typescript-config/nextjs.json`. This also retires the workaround comment written
  in Chunk 2 about `RequestInit.cache` not type-checking — it does now.

**Verify** `pnpm check-types`; `rg "@radix-ui"` returns nothing; app still boots.

```
chore(web): add tanstack table and the shadcn primitives the console needs

Installs @tanstack/react-table and the fourteen shadcn components the admin
console depends on. The table engine is deliberate rather than premature: the
current lists are small, but the student, attendance, fee and marks grids in
Phases 3-5 need real sorting, filtering and pagination, and introducing one
DataTable abstraction now avoids retrofitting every list later.

This project is Base UI, not Radix, so the generated files use render rather
than asChild; each was reviewed for that, for lucide icons, and for correct
group composition.
```

## Chunk 3b — apply the new theme (optional, but do it here if at all)

Only if the theme is being changed. Deliberately its own commit: it touches design tokens and
nothing else, so it is trivially reviewable and trivially revertible.

- [x] `pnpm dlx shadcn@latest preset resolve` to record the current theme. **Current preset
      code: `b5x0G3yOW`** — style `mira`, baseColor `neutral`, theme `yellow`, chartColor
      `violet`, icons `lucide`, font `outfit`, radius `large`, menuAccent `bold`. Keep this
      code: re-applying it is how to get back if a candidate theme is worse.
- [ ] `pnpm dlx shadcn@latest preset decode <code>` to inspect the incoming one.
- [ ] `pnpm dlx shadcn@latest apply <code> --only theme`.
- [ ] Fonts, if changing, by hand in `layout.tsx` via next/font — not via the preset, which
      conflicts with the `--font-sans` mapping in `@theme inline`.
- [ ] Confirm `components/ui/*` is untouched by the diff. If it is not, the command changed the
      *style* rather than the theme — revert and re-run with `--only theme`.

**Verify** `pnpm check-types`; the app boots in light and dark; `playwright-cli screenshot` of
`/login` and the dashboard in both modes; primary/foreground contrast meets WCAG AA for body text.

```
chore(web): apply the new shadcn theme

Replaces the design tokens in globals.css with the chosen preset, using
--only theme so component sources are untouched. Applied before any screen work
so the contrast checks and the responsive pass later run against the final
palette rather than one about to be discarded.

Fonts stay under next/font in layout.tsx rather than coming from the preset,
because the preset's font block conflicts with the --font-sans mapping in the
@theme inline block.
```

## Chunk 4 — copy, formatting, error mapping

Hand-written — review carefully.

- [x] `lib/copy.ts` — all user-facing strings plus the terminology table. `login-form.tsx`
      now reads from it, so the module is the single source rather than an aspiration.
      `branchWord(count)` implements the School-vs-Branch rule; `countLabel` handles plurals.
- [x] `lib/format.ts` — `DD/MM/YYYY` display ⇄ ISO wire helpers.
- [x] `lib/errors.ts` — `TRPCClientError` → plain message: UNAUTHORIZED → "Your session
      expired. Please sign in again." + redirect to `/login`; FORBIDDEN → "You don't have
      permission. Ask your administrator."; NOT_FOUND → "This record is no longer available.";
      CONFLICT → server message verbatim (already human after Chunk 1); network/5xx →
      "Couldn't reach the server. Check your connection." + Retry.

**Notes for later chunks:**

- **`toFriendlyError` returns flags, not effects.** `{ kind, message, retryable,
  requiresSignIn }`. The module imports nothing from `next/navigation`, so it is readable from
  a server component; the `/login` redirect on `requiresSignIn` and the Retry control on
  `retryable` are the caller's job — wire both into the shared components in Chunk 6.
- **There is still no `errorFormatter` in `packages/trpc`**, so a zod input failure arrives as
  a JSON array in `message` rather than as `data.zodError`. `looksTechnical` catches it and
  falls back to form-level wording, which is enough for these screens. If a later chunk wants
  *field-level* server validation, that is the moment to add the formatter — not before.
- **Calendar dates never become `Date` objects.** `new Date("2026-03-31").getDate()` is the
  30th west of Greenwich; `formatTimestamp` is the one deliberate exception, for `timestamptz`.
- **Chunk 9's preset is already built**: `sessionFromStartYear`, `currentSessionStartYear`,
  `sessionStartYearOptions`.

**Verified** `pnpm check-types` 8/8. 25 date assertions and 13 error-mapping assertions run
against the real modules (throwaway scripts, not committed — the plan adds no web test
harness): both April/March boundaries, leap years, two-digit years, half-typed input,
`todayIso` local-vs-UTC, and — the ones that matter most — a raw exclusion-constraint string,
a zod issue array, `Missing permission: school:create` and a stack trace all degrading to
generic wording instead of reaching the screen.

**Verify** `pnpm check-types`; hand-check date conversions at the 1 Apr / 31 Mar boundaries.

```
feat(web): add copy, date formatting and error-mapping utilities

Three pure modules the rest of the console builds on. copy.ts centralises every
user-facing string, including the India-facing terminology the UI standardises
on: Branch for school, Session for academic year, and Close rather than
deactivate, always paired with a note that records are kept. Centralising it
now means a later Hindi or regional translation is additive.

format.ts converts between the DD/MM/YYYY the UI displays and the ISO dates the
wire uses, since MM/DD ambiguity is a real source of data-entry error here.
errors.ts turns a TRPCClientError into something a teacher can act on, so no
raw permission string or Postgres message ever reaches the screen.
```

## Chunk 5 — `me.get` bootstrap and active context

The architectural crux — review closely.

- [x] `features/session/use-me.ts` — wraps `trpc.me.get` with a long `staleTime`.
- [x] `ActiveContextProvider` holding `{ organizationId, schoolId | null, academicYearId | null }`:
      derive from `me.get`; hydrate from localStorage; **discard ids absent from `me.get`**;
      auto-select a sole org and sole branch; tolerate `schools: []`; resolve the session via
      ~~`academic.year.current`~~ **`academic.year.list` + `isCurrent`** — see below.
- [x] Expose `scopeArgs()` → `{ organizationId }` for lists and `writeScopeArgs()` →
      `{ organizationId, schoolId }` for mutations, prompting for a branch when none is chosen.
      `writeScopeArgs()` returns **null** when no branch is chosen; the prompt is the caller's,
      since a context cannot open a dialog.
- [x] Mount the provider in `(dashboard)/layout.tsx`; temporarily render the resolved context on
      the dashboard page (replaced in Chunk 7).

**`academic.year.current` is not usable, and this was measured, not assumed.** Probing all
three seeded logins against the live API:

| call | org_admin | principal | class_teacher |
|---|---|---|---|
| `/me` | 2 schools, 116 perms | 1 school, 83 perms | **`schools: []`**, 29 perms |
| `year.current` @ org scope | 200 | **403** | **403** |
| `year.current` @ schoolId | 200 | 200 | *no school id exists to send* |
| `year.list` @ org scope | 3 rows, **2 flagged current** | 2 rows | 1 row (current only) |

`current` is a strict `staffProcedure`, so the caller must address a node their grant
*covers* — a branch principal addressing the org node gets `403 Missing permission`, not the
`NOT_FOUND` this plan predicted. And a class-scoped teacher has no branch to address instead,
because `me` shows them none. The permissive `year.list` works for all three, and it is the
query the session picker needs anyway. **`isCurrent` is per school**, so with several branches
in view and none selected, `activeSession` is deliberately undefined rather than a guess.

**Two more findings:**

- **`schools: []` is not just the librarian.** The seeded `class_teacher` has it too, so it is
  the common case for anyone scoped below school level — not an edge case. Such a user can
  still read (org-scoped lists are clipped server-side) but can never write, which matches
  their permissions.
- **`@repo/contracts` row types are not the browser's types.** No superjson transformer means
  a `timestamp` is a `Date` in the contract and a `string` on the wire. Row shapes now come
  from `inferRouterOutputs<AppRouter>` in `lib/trpc/types.ts`; contracts remain the source for
  validation schemas, which omit timestamps entirely. Recorded in `docs/CONVENTIONS.md`, since
  every later chunk would otherwise hit it.

**Verified** `pnpm check-types` 8/8, console 0 errors across all three roles:

| | org_admin | principal | class_teacher |
|---|---|---|---|
| branch auto-select | no (2 visible) | **yes** (sole) | n/a (none) |
| `writeScopeArgs()` | null until a branch is picked | ready immediately | null |
| session resolved | after picking a branch | running session | **running session** |
| `school:create` hint | Yes | No | No |
| sessions listed | 3 | 2 | 1 |
| heading word | "Branches" | "Schools" | "Schools" |

Stale-context discard confirmed directly: `localstorage-set` with three fabricated uuids, then
reload — all three were dropped, the org fell back to the real membership, and there was no 403
loop. `schools: []` renders an explanation rather than crashing.

**Verify** all three seeded logins (`org_admin` 2 branches, `principal` 1, `class_teacher`);
`playwright-cli localstorage-set` a bogus branch id and confirm it is discarded rather than
causing a 403 loop; confirm a `schools: []` membership does not crash.

```
feat(web): bootstrap from GET /me and add active org, branch and session context

Every staff procedure requires an organizationId, but a better-auth session
carries only the user, so nothing in the browser knew which organization to
name and no staff endpoint was reachable. This wires GET /me as the first call
after sign-in and holds the result as the app's active context.

Two details are load-bearing. Persisted selections are validated against the
/me response and discarded when absent, because a revoked branch left in
localStorage would otherwise make every subsequent call fail authorization.
And list calls send only organizationId, letting the server clip grants to the
caller's subtree, while mutations must also send schoolId — omitting it reaches
requireSchoolId and fails. A membership with no visible branches, as a
librarian has, is a valid state and renders rather than erroring.
```

## Chunk 6 — shared building blocks

- [x] `PageHeader`, `DataTable` (responsive, `renderCard` prop for <768px), `EmptyState` (uses
      `Empty`), `ConfirmDialog` (`AlertDialog`, consequence text required), `FormDialog`
      (`Dialog` ≥768px / `Sheet` below), `ListSkeleton`, `PermissionGate`.
- [x] Contrast check against **whatever theme is in place**. The amber is gone — the theme
      applied in `5e9f969` is a mid-dark green, and **every pair clears WCAG AA for body text**,
      so no variable was touched:

      | pair | light | dark |
      |---|---|---|
      | primary button text | 5.09 AA | 7.19 AAA |
      | body on background | 19.71 AAA | 19.00 AAA |
      | muted text on background | 4.61 AA | 8.07 AAA |
      | destructive on background | 4.76 AA | 6.82 AA |
      | secondary button text | 16.11 AAA | 14.26 AAA |

**Four things worth knowing:**

- **`lib/table.ts` uses v9's `createTableHook`**, not a hand-rolled wrapper. It is the
  library's own "configure once" primitive and returns `useAppTable` plus a column helper
  already bound to the feature set, so columns built in one screen are assignable in another.
  Only `rowSortingFeature` is registered; filtering and pagination stay out of the bundle until
  a Phase 3-5 grid needs them. The four `sortFns` are registered because a column's default
  `sortingFn` is `'auto'` and `'auto'` resolves only *registered* functions — omitting them
  type-checks cleanly and fails at runtime.
- **`FormDialog` is the one sanctioned JS breakpoint**, and the reasoning does not generalise:
  Dialog and Sheet have separate portals and focus traps, so rendering both and hiding one with
  CSS would mount two modals and two copies of every field id. The hydration objection does not
  apply because a modal only exists after the user opens it — necessarily after hydration.
  Layout switching (`DataTable`'s cards vs table) stays pure CSS.
- **Base UI's `AlertDialog` is deliberately non-dismissible.** Escape and outside clicks do
  nothing, so `ConfirmDialog` can only be resolved by Cancel or the action. Verified, and it is
  the right semantics — but any code path that opens it must be able to close it, or the user is
  stuck behind a modal overlay.
- **`consequence` is a required prop** on `ConfirmDialog`, so "Are you sure?" is unrepresentable.

**Verified** `pnpm check-types` 8/8, console 0 errors throughout, exercised live rather than
only compiled:

- desktop 1366px → semantic `<table>` with an sr-only caption and sortable header buttons;
  clicking a header sorts and sets `aria-sort="descending"`
- mobile 360px → the table is still in the DOM but `checkVisibility()` is false, two cards
  render, and **the desktop sort order is preserved in the cards** — proving both shapes read
  the same row model. No horizontal page scroll.
- `ConfirmDialog` → `role="alertdialog"`, title as an `h2`, consequence as its description,
  Cancel focused on open
- `FormDialog` → `dialog` at 1366px, `sheet` anchored to the bottom edge at 360px, both with a
  real `<form>` and a `type="submit"` button
- `PermissionGate` → the principal holds `academic_year:create`, so the create button renders;
  `school:create` is absent and Chunk 8 is where that becomes visible

`EmptyState`'s empty and error paths are reached through `DataTable` but were not triggered here
(the seeded list is never empty) — Chunk 8 forces both with `playwright-cli route`.

**Verify** `pnpm check-types`. Full exercise arrives in Chunk 8.

```
feat(web): add shared page, table, dialog and permission-gate components

The building blocks every domain screen composes. DataTable carries the
console's responsive rule: cards below 768px and a table above, switched in CSS
rather than by measuring the viewport in JavaScript, which would cause
hydration mismatch. ConfirmDialog requires consequence text rather than
accepting a bare "Are you sure?", because the actions it guards — closing a
branch, promoting a session — are ones a non-technical user should not have to
guess about.

PermissionGate hides actions the caller lacks instead of disabling them, since
a dead control with no explanation is worse than an absent one. It reads the
permission hints from /me and is never the security boundary; the server
re-checks every call. Also verifies primary-button contrast against the active
theme.
```

## Chunk 7 — responsive app shell

- [x] Sidebar ≥1024px; bottom tab bar + hamburger `Sheet` below. Destinations: Home, Branches,
      Sessions, Classes, Profile.
- [x] Org switcher (conditional), branch switcher (conditional), session indicator/picker,
      profile menu, theme toggle.
- [x] Skeletons while `me.get` resolves — never a full-page spinner (Neon cold-starts ~500ms).

**Five things worth knowing:**

- **`Sidebar collapsible="none"` is what makes the 1024px breakpoint possible.** In that mode it
  renders a plain flex column and never consults `useIsMobile`, whose hardcoded 768px would
  otherwise turn the sidebar into a second, competing drawer between 768 and 1023px. Wrapped in
  `hidden lg:flex`, so the switch stays CSS.
- **The provider was split from its gate.** `ActiveContextProvider` now always renders its
  children and exposes a `{ loading | error | no-access | ready }` state;
  `ActiveContextGate`, mounted *inside* the shell, holds back only page content. That is what
  keeps navigation and the theme toggle on screen through a cold start.
  `useActiveContext()` still throws unless resolved, so Chunks 8-11 are unaffected.
- **Navigation is bottom tabs; the hamburger sheet is context.** Repeating five destinations in
  both places would be noise, so the sheet holds what the tabs cannot: trust, branch, session
  and sign-out. Its trigger is labelled with the current context (`MAIN · 2025-26`) rather than
  being a bare icon, because a user needs to see which branch they are in before trusting the
  screen.
- **Profile is a page, not a dropdown.** The template hid the account behind an avatar menu; the
  things inside it — who am I, what may I do, how do I leave — are exactly what a confused user
  hunts for. `navbar.tsx`, `navbar-profile.tsx` and `hooks/use-current-user.ts` are deleted:
  the last was a second identity fetch alongside `me.get`, and the profile menu had an
  unreachable "Login" branch inside the authenticated shell.
- **`SessionPicker` hides itself when a branch must be chosen.** Found in the browser: an
  org admin with two branches and none selected got a picker labelled `—` offering a list that
  mixed both branches' years, because `isCurrent` is per school. It now renders nothing until a
  branch makes it meaningful.

**Verified** `pnpm check-types` 8/8, console 0 errors. Measured, not eyeballed:

| width | horizontal scroll | sidebar | bottom tabs | content covered |
|---|---|---|---|---|
| 360 / 414 / 768 | none | hidden | visible | no |
| 1024 / 1366 | none | visible | hidden | no |

The covered-content check scrolls to the bottom first — the tabs are `fixed`, so measuring
without scrolling reports a false overlap.

| | org_admin | principal | class_teacher |
|---|---|---|---|
| org switcher | label (1 membership) | label | label |
| branch switcher | **dropdown** (2) | label only (sole school) | **absent** (`schools: []`) |
| session picker | hidden until a branch is picked | **dropdown** (history) | label only (no history) |

Keyboard focus is visible throughout: sidebar links carry a 2px ring from
`sidebarMenuButtonVariants`, and the links written here carry a 2px outline in the ring colour
the base layer already sets. One correction for the record — an earlier reading of "no focus
indicator" was a truncated `box-shadow` string, not a real defect.

Placeholder pages: `/branches`, `/sessions` and `/classes` render a header plus a
"not built yet" empty state so nothing dead-ends. Chunks 8, 9 and 10 replace them. `/profile`
and Home are real, and Chunk 12 replaces Home with the setup checklist.

**Verify** `playwright-cli resize` at 360×640, 414×896, 768×1024, 1024×768, 1366×768: no
horizontal page scroll, bottom tabs do not cover content, no clipped dialogs. `org_admin` sees a
branch switcher; `principal` does not; `class_teacher` sees no session picker. Keyboard-tab the
whole shell and confirm focus is always visible.

```
feat(web): add the responsive app shell with org, branch and session switchers

Replaces the placeholder dashboard with the real navigation: a sidebar at
desktop widths and a bottom tab bar plus hamburger sheet below, chosen because
thumb-reachable bottom tabs match what these users already know from everyday
Android apps.

All three switchers are conditional, which falls out of the authorization model
rather than being a special case: /me returns one membership per organization
and only the branches a caller may see, so a single-branch principal gets a
plain label while a trust admin gets a real switcher. The session picker
appears only for callers holding academic_year:read_history, since everyone
else can address the current session only. Loading uses skeletons rather than a
full-page spinner so the shell stays on screen through a cold database start.
```

## Chunk 8 — branches

Simplest vertical first — establishes the CRUD template with the least to go wrong.

- [x] `school.*`: list, create, edit, **Close** (`deactivate`, hard rule 2 — say "records are
      kept"). Create gated behind `school:create` via `PermissionGate`.

**Scope per call is not the blanket rule.** `school.create` addresses the **org** node, not the
selected branch: the school being created has no `scope_nodes` row yet, and the service reads
`ctx.organizationId`. `update`/`deactivate` address **the row being changed**
(`schoolId: row.id`), not the active context — a principal does not cover the org node, so
addressing the org would 403 them out of editing their own branch. Every mutation invalidates
`me.get` as well as the list, because `me.memberships[].schools` feeds the branch switcher.

**Two bugs found and fixed while verifying:**

- **The desktop `FormDialog` had no scroll handling**, so an eleven-field form grew past the
  viewport and the submit button sat below the bottom edge with nothing to scroll — fillable and
  unsaveable at 768px height. The Sheet scrolled; the Dialog did not. Both now scroll only the
  field area, keeping title and buttons fixed.
- **A failed list took ~17 seconds to admit it.** TanStack's default three retries with
  exponential backoff kept a skeleton on screen long enough to read as a hang. Now one retry,
  and none at all for a permission or not-found answer, which re-asking cannot change. Also
  corrected the error title, which read "Couldn't load your school" on a branch list.

**Verified** `check-types` 8/8, console clean:

- **duplicate code → the full chain works**: `schools_org_code_uq` → Postgres 23505 → Chunk 1's
  translator → 409 → Chunk 4's passthrough → toast reading *"Code MAIN is already used by
  another branch. Pick a different code."* No Postgres string reached the screen.
- `principal` → heading reads "Schools", **no create button**, list clipped server-side to one row
- 360px → cards, table hidden, no horizontal scroll; 1366px → table
- forced 500 on `school.list` → mapped message plus a Retry that recovers the list
- create → toast, row appears, code auto-uppercased (`east` → `EAST`), and the new branch shows
  in the switcher immediately, which is the `me.get` invalidation working

A third branch, **EAST (Howrah)**, was created during verification and left in place — Chunk 12
needs a branch with no sessions to reach the first-run checklist.

**Verify** `principal` sees no create button; a duplicate branch code shows the friendly
conflict from Chunk 1; cards <768px, table ≥768px; `route "**/trpc/**" --status=500` shows the
mapped network message with a working Retry.

```
feat(web): manage branches

First domain vertical, and the template the remaining three follow: a list
built on DataTable, a create and edit form validated by the shared contract
schema, and a close action behind a confirm that explains the consequence.

Closing a branch deactivates it rather than deleting it, because student
records, payments and results all reference it and must stay reachable, so the
UI says records are kept instead of implying deletion. Creating a branch is
gated on school:create, which in practice means an organization admin; a
principal sees no create control at all rather than a button that fails.
```

## Chunk 9 — sessions

Adds constraints, a preset, a consequence-bearing confirm, and history gating.

- [x] `academic.year.*`: list, create, edit, and **Make this the running session**
      (`setCurrent`) behind a `ConfirmDialog` explaining it changes what every colleague sees.
- [x] Create form offers an **Indian session preset**: pick a start year → 1 Apr YYYY –
      31 Mar YYYY+1, auto-named `YYYY-YY`. Manual dates stay available.
- [x] Show past sessions only when `read_history` is held. `originalEndDate` and `isCurrent` are
      **not** form fields (the contract omits them).

**Every write needs a branch named.** `createAcademicYear` and `setCurrentAcademicYear` both call
`requireSchoolId`, so all three mutations use `writeScopeArgs()`. A `withBranch` guard turns the
"no branch chosen" case into a message instead of a doomed request, and the screen shows a
choose-a-branch state rather than a list of actions that cannot work.

**Preset detail:** the hidden name and date inputs stay *registered* while the preset drives
them — hiding an input does not unregister it, and those values are exactly what is submitted.
Dates use native `type="date"`, so the phone's own picker opens, the value is already the ISO
string the wire wants, and it displays in the reader's locale.

**Verified** `check-types` 8/8, console clean. Logic checked through the API, where it is
deterministic, rather than inferred from screenshots:

| case | result |
|---|---|
| duplicate name | 409 *"This branch already has a session named 2025-26. Pick a different name."* |
| overlapping dates | 409 *"These dates overlap another session at this branch (01/04/2025 – 31/03/2026)…"* |
| end before start | 400, not 500 |
| no `schoolId` | 400 *"Choose a branch first — this has to be saved against one branch."* |
| `principal` list | 2 rows, closed session included; reads it by id → 200 |
| `class_teacher` list | 1 row, closed session excluded |
| fresh EAST branch | 0 sessions, so the empty state is reachable |

Browser: the preset defaults to `2026-27` and fills name, 01/04/2026 and 31/03/2027; the switch
reveals the manual fields and hides the preset; the list shows running vs past.

**Plan correction:** this chunk expected a `class_teacher` to get "a clean not-found for a closed
session". They actually get **403**, because addressing `schoolId` requires covering the school
node and a class-scoped grant does not — the Chunk 5 finding again. It never surfaces in the UI,
which only ever lists (permissive, org-scoped), and both codes map to safe wording in
`lib/errors.ts`.

**Verify** overlapping dates and duplicate names both show friendly messages;
`class_teacher` sees only the current session and a clean not-found for a closed one;
`principal` reads that same closed session.

```
feat(web): manage academic sessions

Sessions are the richest vertical, so it exercises the whole foundation: the
overlap and duplicate-name constraints now surface as readable conflicts, and
promoting a session sits behind a confirm that states plainly it changes what
every colleague sees, because one row moving reassigns a school's visible
history.

Creating a session offers an Indian academic-year preset — pick a start year
and get 1 April to 31 March, named automatically — because typing two dates is
where the overlapping-session mistake comes from. Past sessions are listed only
for callers holding academic_year:read_history, matching the server-side rule
rather than reimplementing it; the client asks the permissive question for
lists and the strict one for a single session, as the router already does.
```

## Chunk 10 — classes and bulk ladder

- [ ] `academic.class.*`: list ordered by `numericOrder`, create, edit, Close.
- [ ] **Never expose a raw `numericOrder` input** — `classes_school_order_uq` makes it a
      collision trap. Offer a **curated ladder** (Nursery −3, LKG −2, UKG −1, Class 1…12,
      matching `academic.contract.ts:99`) with tick-boxes and auto-assigned order.
- [ ] Copy must state that **Class 11 Science/Commerce are *sections* with a `stream`**, not two
      classes — two "Class 11" rows collide on both name and order.
- [ ] Bulk create loops single `create` calls: report per-row outcome and allow retrying only
      the failures. There is no transactional bulk endpoint.

**Verify** duplicate name and duplicate order both friendly; interrupt the network mid-bulk
(`playwright-cli route`) and confirm a per-row report plus working retry.

```
feat(web): manage classes with a bulk class-ladder setup

Classes are unique per branch on both name and numeric order, so exposing a raw
order field would hand a non-technical admin an opaque collision on a number
they have no reason to understand. Instead the UI offers the standard Indian
ladder — Nursery through Class 12, with pre-primary years ordered below zero so
Class 1 keeps its obvious position — and assigns order itself.

Bulk creation loops individual calls because no transactional bulk endpoint
exists, so partial failure is expected and is reported per row with a retry for
only the rows that failed. The form also states that Class 11 streams belong in
sections rather than as separate classes, which is both the schema's intent and
the mistake the order constraint would otherwise catch too late.
```

## Chunk 11 — sections

- [ ] Route `/classes/[classId]`; sections for the **active session**. List, create ("add A, B,
      C" in one go), edit, Close.
- [ ] `academicYearId` / `classId` are **not** patchable (the contract omits them) — a misplaced
      section is closed and re-created. Say so in the UI.
- [ ] `stream` / `house` / `roomNumber` / `maxStudents` are optional.

**Verify** duplicate section name friendly; a class id from another branch is not reachable; a
closed session's sections stay hidden without `read_history`.

```
feat(web): manage sections within a class

Sections live under a class detail route rather than a top-level screen,
because a section is meaningless without both a class and a session: a
top-level list would force two selections before showing anything. The active
session supplies the year, so the common case needs no picker at all.

Moving a section between classes or sessions is deliberately not offered. It
would relocate every student, attendance record and result attached to it and
leave its authorization node's ancestry stale, so the UI explains that a
misplaced section is closed and recreated instead. Creating A, B and C in one
step keeps the common case to a single interaction.
```

## Chunk 12 — home checklist, final QA, docs

- [ ] Home: when setup is incomplete, a 3-step checklist in dependency order — create the running
      session → add classes → add sections. **Only step 3 is hard-gated** on a session existing
      (classes are not year-scoped); steps are merely *presented* in order. When complete, show a
      summary (running session, counts, quick actions).
- [ ] Full matrix: 360 / 414 / 768 / 1024 / 1366 × the three seeded roles. Every list has
      explicit loading, empty (with CTA), and error (with Retry) states.
- [ ] `prefers-reduced-motion` respected; keyboard focus visible throughout.
- [ ] `pnpm check-types` green. If any router `meta` changed, `pnpm check:openapi`.
- [ ] Update `docs/TASKS.md` with what the frontend now covers.

**Verify the empty-org path without touching the seed:** as `org_admin`, create a **new branch**
(Chunk 8) and select it — it has no sessions, so the checklist is genuinely reachable.

```
feat(web): add the setup checklist home screen and finish responsive QA

A newly provisioned organization has no session, so the current-session lookup
returns not-found and every list is empty. Left as bare tables that is a dead
end for the person doing setup, so Home becomes a three-step checklist —
session, classes, sections — that explains what each step unlocks. Only the
sections step is genuinely blocked on a session existing, since classes are not
year-scoped; the others are ordered for guidance rather than gated. Once setup
is complete the same screen becomes a summary.

Also completes the responsive and state pass across five widths and the three
seeded roles, confirms reduced-motion and keyboard focus behaviour, and records
the delivered frontend surface in docs/TASKS.md.
```

---

## Risks / gotchas

- **Bulk create is not atomic.** N sequential calls; partial failure is expected. Report per-row —
  never one "failed" toast that hides which rows landed.
- **Stale persisted context** is the likeliest auth bug: a revoked branch in localStorage makes
  every call 403. The validation in Chunk 5 is the fix; don't skip it.
- **`schoolId` on writes** — omitting it yields a 500, not a validation error, until Chunk 1
  lands. That is why Chunk 1 is first.
- **Neon cold start** (~500ms after idle) reads as a hang. Skeletons, not spinners.
- **Base UI ≠ Radix.** `asChild` will fail. Verify against `pnpm dlx shadcn@latest docs`.
- **A theme swap after Chunk 6** invalidates the contrast check and the Chunk 12 visual pass.
  Do it in Chunk 3b or accept the rework.
- **`frontend-design` is calibrated for brand pages.** Take its copy discipline and quality
  floor; do not take its "signature element" mandate as licence to restyle a utility console.
- Don't add a chart library; nothing here needs one.

## Validation baseline

`pnpm dev`, then `pnpm db:seed` for the three logins: `org_admin` (2 branches, sees history),
`principal` (school A only, sees history), `class_teacher` (read-only, current session only).
Trip each constraint deliberately and confirm no Postgres string ever reaches the UI.

## Out of scope (no backend exists)

Students/guardians, enrollments, subjects, teacher–subject assignments, terms/calendar,
attendance, fees, exams/report cards, staff management, role assignment, the permissions editor,
the student/parent portal, and org creation (no `platformProcedure` — see `docs/TASKS.md`).
