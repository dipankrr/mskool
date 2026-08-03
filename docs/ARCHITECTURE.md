# Architecture

How the packages fit together and what happens during a request. For *why* a given
choice was made, see `docs/DECISIONS.md`.

---

## The type chain

```
packages/db          Drizzle tables — the shape of the data
      ↓
packages/contracts   Zod schemas via drizzle-zod — the shared vocabulary
      ↓
packages/services    Business logic — transactions, invariants, calculations
      ↓
packages/trpc        Routers — validate input, call a service, return
      ↓
apps/web             `import type { AppRouter }` — inferred client, zero runtime coupling
```

One direction only. Rename a column and the error surfaces in the web client at compile
time — that is the whole point of the arrangement.

**The boundary that matters:** `apps/web` may only ever `import type` from `@repo/trpc`.
A runtime import drags Drizzle, the Postgres driver, and your connection string into the
browser bundle. `packages/services` has no HTTP awareness: no `req`, no `res`, no
`TRPCError`. It should be callable from a router, a webhook, a cron job, or a test with
equal ease.

---

## Package responsibilities

| Package | Owns | Must not |
|---|---|---|
| `db` | Drizzle schema (one file per domain), client, migrations | Contain business logic |
| `contracts` | Zod schemas derived from tables, shared enums | Import services |
| `services` | Transactions, invariants, money math, scope filtering | Know about HTTP |
| `trpc` | Procedure builders, routers, context | Contain business logic |
| `authz` | `can()`, `DataScope`, scope tree, Redis cache, policies | Authenticate |
| `auth` | better-auth instance | Answer "may they?" (only "who are they?") |
| `env` | `createEnv()` helper | — |

**`services` is where correctness lives.** Fee calculation, promotion, receipt numbering,
and result computation belong there, in transactions, with tenancy as a required argument.

---

## Request lifecycle

```
Browser
  │  httpBatchLink, cookies included
  ▼
apps/api  (Express, :4000)
  │
  ├─ cors({ origin: CORS_ORIGIN, credentials: true })
  │
  ├─ /api/auth/*  →  better-auth  (mounted BEFORE express.json(); needs the raw body)
  │
  ├─ express.json()
  │
  ├─ /trpc/*      →  tRPC express adapter    ← what apps/web talks to
  ├─ /api/*       →  trpc-to-openapi          ← same routers as REST, for non-tRPC clients
  ├─ /openapi.json, /docs  →  Scalar reference
  └─ /health
```

`createContext` runs once per request: better-auth validates the session cookie, and the
result plus the `db` handle become `ctx`.

Then the procedure builder decides what happens next — this is the enforcement point for
the two authorization tracks (ADR-005):

```
publicProcedure    no session required
staffProcedure     kind === 'staff'   → can(permission) → attaches DataScope
studentProcedure   kind === 'student' → attaches activeStudentId (no permission gate)
systemProcedure    webhook signature  → no session at all (ADR-009)
```

Because `ctx.auth` is a discriminated union, a student reaching a staff procedure is a
**compile error**, not a runtime check someone forgets.

### Two transports, one router

Every procedure carrying `.meta({ openapi: {...} })` is exposed twice: as tRPC at `/trpc`
and as REST JSON at `/api`. Same router, same validation, same service call. The REST
surface exists for anything that is not a tRPC client — a future native app, partner
integrations, curl. It is not a second implementation, so it cannot drift.

---

## Authorization at a glance

```
STAFF
  role_assignments  (userId, roleType, scopeType, scopeId)
        ↓
  org_role_permissions  (per-org, editable — this is why permissions are data, not code)
        ↓
  can(userId, 'fee:read')  →  boolean
        ↓
  DataScope  →  every service query filters by it
```

`scope_nodes` is the tree that makes "org-level role sees all branches" work: a role
assigned at an org node covers every school node beneath it. Which is why **creating a
school, class, or section must insert its `scope_nodes` row in the same transaction**
(hard rule 12) — a node absent from the tree is unreachable, and every request for it
403s.

```
STUDENT
  session → student_portal_access → owned studentIds → activeStudentId
        ↓
  ownership filter (no can(), no role_assignments rows)
```

**Redis auth cache:** a staff member's resolved permission set is cached per user, so the
common path costs zero DB queries. It must be invalidated whenever `role_assignments` or
`org_role_permissions` changes for that user — a stale permission cache is a security bug,
not a performance one.

> **Not yet built.** `packages/authz` and the procedure builders above arrive in Phase 1.
> The comments currently in `packages/trpc/src/context.ts` describe this target state,
> not what exists today. See `docs/TASKS.md`.

---

## Environment variables

One root `.env`. Every script is wrapped in `dotenv -e .env`, so the whole monorepo reads
one file, and `turbo.json` declares per-task `env` arrays so caching stays correct.

Each package declares **only the variables it needs** in its own `src/env.ts`:

```ts
// packages/db/src/env.ts — the only file in this package that touches process.env
import { createEnv } from "@repo/env";
import { z } from "zod";

export const env = createEnv({ DATABASE_URL: z.url() });
```

`createEnv()` validates with Zod at import time and throws a listing of what is wrong.
A missing variable fails loudly at boot rather than surfacing as `undefined` deep in a
code path at 2am.

`apps/web` is the exception worth care: only `NEXT_PUBLIC_*` variables are readable in the
browser, so its `env.ts` validates those separately from server-only ones.

---

## Frontend structure

Route groups, not separate apps (ADR-010):

```
apps/web/src/app/
  (auth)/      login/  student-login/
  (admin)/     layout.tsx  → staff shell: sidebar, school switcher
               students/ fees/ attendance/ exams/ settings/
  (student)/   layout.tsx  → portal shell: mobile-first, child switcher
               profile/ fees/ results/ attendance/
```

`middleware.ts` reads the session and sends each `kind` to its own root, so a staff
member cannot land in the portal and vice versa. Two `features/` trees; one shared
`components/ui`.

---

## Migrations

`pnpm db:generate` produces SQL from the Drizzle schema; review it before applying.

Some constructs cannot be expressed in Drizzle and are appended to the generated file by
hand (ADR-013): the `EXCLUDE USING gist` constraints on `academic_years`, the
`DEFERRABLE` unique on attendance, and the three triggers. These are load-bearing
correctness guarantees, not decoration — the exclusion constraint is what makes
overlapping academic years impossible at the database level.
