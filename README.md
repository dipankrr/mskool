# Exam Platform

A multi-vendor SaaS scaffold for digitising merit/talent-search exams
(the kind run by independent organisations across schools/districts in
India — not board exams). One codebase, many exam-conducting
organisations ("vendors"), each running their own exams/cycles/schools/
centers with role-scoped access.

This is a **from-scratch monorepo scaffold**: configs, env handling, the
DB→contracts→API→client type chain, and a handful of demo procedures so
you can see the whole flow working end to end. The domain logic (forms,
center allotment, marks entry, results) is intentionally minimal — just
enough to prove the pattern — you'll flesh it out from here.

Stack: Turborepo + pnpm · TypeScript · Express + tRPC v11 · `trpc-to-openapi`
+ Scalar docs · Next.js (App Router) · Zod · Drizzle (Postgres) ·
better-auth (email/password + organizations plugin). No Docker for now.

---

## 0. A note on dependency versions

Versions are pinned to what's current as of mid-2026 (TypeScript 6, Next.js
16, tRPC v11.17, Drizzle 0.45, better-auth 1.6). One exception, on purpose:
**`zod` is pinned to `^3.25.1`, not the new `4.x` default.** Zod 4 is stable
and faster, but at the time of writing `trpc-to-openapi` and parts of the
`better-auth` ecosystem are still verified against Zod 3 (3.25+ is the
version that added the `"zod/v4"` subpath, so it's the safe floor). This is
the exact "pin a Zod major across the whole chain" issue your reference
doc flagged for `drizzle-zod` — same problem, just one layer further out.
Once you confirm `trpc-to-openapi`/`better-auth` support Zod 4 cleanly in
your install, bumping is a one-line change in each `package.json`.

Run `pnpm outdated -r` after install to see what's moved since.

---

## 1. How the pieces fit together


```
packages/db          Drizzle tables (single source of truth) — server-only
        ↓
packages/contracts   Zod schemas DERIVED from db tables via drizzle-zod
        ↓
apps/api             Express + tRPC routers built on those contracts
        ↓ (type-only import of AppRouter, zero runtime code)
apps/web             Next.js, fully-typed tRPC client
```

- **`apps/web` never imports `@repo/db`.** It only imports the *type* of
  `AppRouter` from `@repo/api/server`. TypeScript erases that import at
  build time, so the browser bundle never sees `drizzle-orm`/`postgres`.
- **`packages/contracts`** is where `drizzle-zod` removes the duplication
  you used to hand-write: `createInsertSchema(table)` / `createSelectSchema(table)`
  generate the Zod schema straight from the Drizzle table. You only
  hand-write the bits the DB can't express (`.omit()` server-computed
  fields, `.extend()` extra validation like `studentClass` enums).
  Change a column → the contract picks it up automatically; you only get
  a type error if an `.omit`/`.extend` no longer lines up, which is
  exactly the safety net you want.
- **Two transports, one router**: every tRPC procedure with
  `.meta({ openapi: {...} })` is reachable both as a normal tRPC call
  (`apps/web`, batched, fully typed) **and** as a plain REST/JSON
  endpoint (`/api/...`) documented live at `/api/docs` via Scalar — for
  partner integrations, mobile apps, or just `curl`.

### Roles & multi-vendor auth

- `organization` (better-auth org plugin) = one exam-conducting vendor.
- `user.isSuperAdmin` = platform-level admin, not tied to any org.
- `member.role` = one of `org_admin`, `district_incharge`,
  `school_incharge`, `center_incharge`, `data_entry_operator` — scoped to
  **one** organization.
- `member.scopeType` / `scopeId` narrow a role to one entity (e.g.
  `school_incharge` + `scopeType: "school"` + `scopeId: <schools.id>`),
  so the same `member` table covers org-wide and entity-scoped roles
  without a separate table per scope type.
- Permissions are defined once in `packages/auth/src/permissions.ts`
  (a better-auth access-control statement) — that's the file to edit
  when "who can do what" changes, instead of hunting through routers.
- `apps/api/src/trpc/middleware/require-org-role.ts` enforces org+role on
  every procedure; each router additionally checks `scopeId` against the
  specific record being touched (see comments in
  `registration.router.ts` / `marks.router.ts`).

### Demo flow the sample routers walk through

1. `exam.create` — org_admin defines an exam ("BTSC Junior Talent Search").
2. `exam.createCycle` — org_admin opens this year's cycle (dates, subjects,
   fee — stored as validated JSON config, since rules differ per org).
3. `registration.create` — school_incharge digitises one student's paper
   form fill-up.
4. `registration.review` — district_incharge/org_admin approves/rejects.
5. `registration.assignCenter` — org_admin assigns an exam center + stamps
   an admit card number.
6. `marks.enter` — center_incharge/data_entry_operator enters subject marks
   after the exam.
7. `marks.publishResult` — org_admin computes & publishes the result.

Every step is also a REST endpoint — open `http://localhost:4000/api/docs`
once running to see them all with live "Try it" support.

---

## 2. Environment variables (the part that "makes your head spin")

There is **one root `.env`** for local dev. `dotenv -e .env` loads it once,
then `turbo run dev/build` passes the relevant variables down to every
app/package as real `process.env` entries (see the `"env": [...]` arrays
in `turbo.json` — that list is also what tells turbo's cache which vars
affect a task's output, so caching stays correct).

Nobody reads `process.env` directly except one file per package:
`packages/*/src/env.ts` or `apps/*/src/env.ts`. Each of those calls
`createEnv({...})` (from `packages/env`) with a Zod shape of **only the
variables that package needs**. Get a var wrong or forget to set it →
you get one loud, typed error at startup, not an `undefined` three
files deep at midnight. Everywhere else in the code, you `import { env }
from "./env"` and get typed values — never `process.env` directly.

`apps/web` is the one special case: only `NEXT_PUBLIC_*` variables are
readable in the browser. Its `env.ts` validates just those; any
server-only secret never goes anywhere near `apps/web`.

In production there is **no `.env` file at all** — your host (Railway,
Render, Vercel, a VPS) injects real environment variables, and the same
`env.ts` files validate those at boot exactly the same way.

---

## 3. Running it locally — step by step

You said you'll unzip this and open it in VS Code — here's exactly what
to do next.

```bash
# 0. Prerequisites: Node 20+, pnpm (corepack enable && corepack prepare pnpm@9.12.0 --activate)
#    and a Postgres database reachable from your machine (local install,
#    or a free instance on Neon/Supabase — either is fine, no Docker needed).

# 1. Install everything
pnpm install

# 2. Set up your env
cp .env.example .env
# edit .env: at minimum set DATABASE_URL to your Postgres connection string,
# and set BETTER_AUTH_SECRET to any long random string
# (e.g. `openssl rand -base64 32`)

# 3. Create the database tables
pnpm db:push          # quick, no migration files — good for dev iteration
# (use `pnpm db:generate` + `pnpm db:migrate` instead once you want
#  versioned migration files for prod deploys — see §5)

# 4. Seed demo data (one org, one org_admin, one school + school_incharge,
#    one center, one exam + open cycle)
pnpm db:seed
# copy the printed orgId / examCycleId into apps/web/src/app/page.tsx

# 5. Run everything
pnpm dev
```

That starts, via turbo, in parallel:

- **API** → http://localhost:4000  
  - tRPC endpoint: `http://localhost:4000/trpc`
  - REST endpoints: `http://localhost:4000/api/...`
  - **Interactive docs (Scalar)**: `http://localhost:4000/api/docs` ← start here
  - Auth routes: `http://localhost:4000/api/auth/*`
- **Web** → http://localhost:3000

Other scripts you'll use day to day:

| Command | When |
|---|---|
| `pnpm dev` | every day, runs api+web together |
| `pnpm db:studio` | open Drizzle Studio (visual DB browser) |
| `pnpm db:generate` | after editing `packages/db/src/schema/*.ts`, to create a migration file |
| `pnpm db:migrate` | apply generated migrations (use this in prod, not `db:push`) |
| `pnpm build` | builds api (tsup → `dist/`) and web (`next build`) |
| `pnpm check-types` | typecheck every package without emitting |
| `pnpm lint` | eslint everywhere |

Creating a logged-in session for the demo: better-auth's email/password
sign-up isn't wired into a UI yet (out of scope for this scaffold) — call
it directly while building the login page:

```bash
curl -X POST http://localhost:4000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"name":"Org Admin","email":"orgadmin@btsc.example.com","password":"changeme123"}'
```

Then create the matching `member` row (role `org_admin`, scoped to the
seeded org) directly via `pnpm db:studio` until you build an invite-flow
UI — better-auth's organization plugin also exposes
`auth.api.createOrganization` / `addMember` server-side if you'd rather
script it.

---

## 4. What to build next (roughly in order)

1. Login/sign-up pages in `apps/web` using `authClient` (already wired in
   `apps/web/src/lib/auth-client.ts`).
2. An invite-member flow (better-auth's org plugin has `inviteMember`/
   `acceptInvitation` built in) so org_admins can onboard
   district/school/center incharges without you hand-inserting rows.
3. Flesh out `schools`/`centers` CRUD routers (same drizzle-zod contract
   pattern as `exam.router.ts`).
4. District-scoped filtering in `registration.list` (join through
   `schools.district`, noted as a TODO in the router).
5. File uploads for student photos (the `photoUrl` column is ready, just
   needs an upload handler — S3-compatible storage of your choice).
6. PDF generation for admit cards / marksheets (the data's all there in
   `registrations`/`results`).

---

## 5. Deploying (no Docker)

**Database**: provision managed Postgres — Neon, Supabase, or Railway's
Postgres add-on all work fine. Copy the connection string.

**Before first deploy**, switch from `db:push` to versioned migrations:
```bash
pnpm db:generate   # writes packages/db/drizzle/000X_*.sql
git add packages/db/drizzle && git commit -m "db: initial migration"
```
Run `pnpm db:migrate` as a release/predeploy step on every deploy from
here on (most hosts have a "pre-deploy command" field for exactly this).

**`apps/api`** (Express):
- Build: `pnpm turbo run build --filter=@repo/api` → outputs `apps/api/dist`.
- Run: `node apps/api/dist/index.js`.
- Deploy target: Railway, Render, Fly.io, or a plain VPS with a process
  manager (pm2/systemd) — anything that runs a long-lived Node process.
- Set env vars in that host's dashboard: `DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your deployed api URL),
  `CORS_ORIGIN` (your deployed web URL), `PORT` (often provided by the
  host automatically).

**`apps/web`** (Next.js):
- Deploy target: Vercel is the path of least resistance for Next.js.
- Set `NEXT_PUBLIC_API_URL` to your deployed api's URL in Vercel's env
  var settings.
- Build command: `cd ../.. && pnpm turbo run build --filter=@repo/web`
  (or let Vercel auto-detect the monorepo — it understands turborepo).

**CORS**: double check `CORS_ORIGIN` on the api matches the web app's
exact deployed origin, or auth cookies won't be sent cross-origin.

**Turbo remote caching** (optional, speeds up CI): `npx turbo login` then
`npx turbo link` — not required to ship, just nice once your team grows.

---

## 6. Notes on things deliberately simplified for a demo

- `requireOrgRole` does the org+role check; scope (`scopeId`) checks are
  done per-router because the relevant field differs per resource —
  see the inline comments in `registration.router.ts` and
  `marks.router.ts` for where to harden this further (e.g. extract a
  reusable `requireScopeMatch(resourceLookup)` helper once you have 3+
  routers repeating the same pattern).
- `marks.publishResult`'s pass/fail threshold (33%) is a placeholder —
  swap in your real grading rules, probably as part of the per-cycle
  `config` JSON so it can differ by org/cycle like everything else
  dynamic in this system.
- District-level visibility filtering is stubbed with a comment, not
  implemented — it needs a join through `schools.district` once you
  decide whether "district" is its own table or stays a plain string
  column (string is fine until you need district-level settings too).
