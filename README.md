# mskool

Multi-tenant SaaS School Management System for private schools in India — CBSE, ICSE,
state board, and unaffiliated.

The tenant is the **Organization** (a Trust or Society), not the school. A school is a
branch under an org. This is the single most important architectural fact in the
codebase — see `docs/DECISIONS.md` ADR-001.

> **Working on this repo, human or AI? Read [AGENTS.md](./AGENTS.md) first**, then
> [docs/TASKS.md](./docs/TASKS.md) for what is done and what is next.

---

## Stack

Turborepo + pnpm · Express + tRPC v11 · Next.js 16 · PostgreSQL + Drizzle · Zod 4 ·
better-auth · Tailwind v4 + shadcn

---

## Getting started

```bash
pnpm install
cp .env.example .env        # then fill in DATABASE_URL and BETTER_AUTH_SECRET
pnpm db:migrate
pnpm dev                    # web :3000, api :4000
```

Requires PostgreSQL 15+ and Node 20+. Redis is needed once the authz cache lands in
Phase 1.

## Commands

```bash
pnpm dev            # all apps
pnpm build
pnpm check-types    # tsc --noEmit everywhere — the gate; must be green
pnpm lint

pnpm db:generate    # drizzle-kit generate
pnpm db:migrate
pnpm db:studio
pnpm db:seed
```

Scripts are wrapped in `dotenv -e .env`, so one root `.env` feeds the whole monorepo.

## Layout

```
apps/api        Express host — better-auth, tRPC at /trpc, REST at /api, docs at /docs
apps/web        Next.js App Router
packages/db     Drizzle schema + client
packages/contracts   Zod schemas derived from the schema
packages/services    Business logic
packages/trpc        Routers
packages/auth        better-auth instance
packages/env         createEnv() helper
```

Types flow one direction — `db → contracts → services → trpc → web` — so a column change
surfaces as a compile error in the client. `apps/web` imports only `type AppRouter`.

## Docs

| File | Contents |
|---|---|
| [AGENTS.md](./AGENTS.md) | Entry point: stack, commands, the 12 hard rules |
| [docs/PRD.md](./docs/PRD.md) | Scope, personas, deliberate non-goals |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Boundaries, request lifecycle, authz |
| [docs/DOMAIN.md](./docs/DOMAIN.md) | The 63 tables and the critical flows |
| [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) | Naming, Drizzle patterns, anti-patterns |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | ADR log — read before changing architecture |
| [docs/TASKS.md](./docs/TASKS.md) | Phased backlog and where to resume |

## Status

Phase 0 — foundation and documentation. The domain schema begins in Phase 1; see
`docs/TASKS.md`.
