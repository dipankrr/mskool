# AGENTS.md

**Read this file first.** Entry point for any AI coding agent in this repo (Claude Code,
Cline, Cursor, Copilot). Short by design: stack, commands, hard rules, and pointers.

---

## What we are building

**mskool** — multi-tenant SaaS School Management System for private schools in India
(CBSE / ICSE / unaffiliated). Production-grade, not an MVP.

**The tenant is the Organization (a Trust/Society), NOT the school.** A school is a branch
under an org. Most important architectural fact in the codebase — see `docs/DECISIONS.md` ADR-001.

---

## Stack

| Concern | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| API | Express + tRPC v11 (`apps/api`) |
| Web | Next.js 16 App Router (`apps/web`) |
| DB | PostgreSQL 15+ via Drizzle ORM (`packages/db`) |
| Validation | **Zod 4** (`z.email()`, not `z.string().email()`) |
| Auth | better-auth (`packages/auth`) — authentication only |
| Authorization | custom RBAC + Redis cache (`packages/authz`) |
| Styling | Tailwind v4 + shadcn |

---

## Commands

Run from repo root. Scripts are wrapped in `dotenv -e .env`, so one root `.env` feeds
the whole monorepo.

```bash
pnpm dev              # all apps (web :3000, api :4000)
pnpm build
pnpm check-types      # tsc --noEmit everywhere — MUST be green before finishing
pnpm lint

pnpm db:generate      # drizzle-kit generate
pnpm db:migrate
pnpm db:studio
pnpm db:seed
```

`pnpm check-types` is the gate. Never report a task complete while it fails.

---

## Repo layout

```
apps/
  api/          Express host: better-auth, tRPC /trpc, REST /api/*, docs /docs
  web/          Next.js. Imports ONLY `type AppRouter` from @repo/trpc.
packages/
  db/           Drizzle schema + client. schema/ split one file per domain.
  contracts/    Zod schemas derived from db via drizzle-zod. Shared vocabulary.
  services/     Business logic. Classes + exported singletons. No HTTP awareness.
  trpc/         Routers. Thin — validate, call service, return.
  authz/        Permissions, scopes, policies, Redis auth cache.
  auth/         better-auth instance.
  env/          createEnv() helper. Each package has its own env.ts declaring
                only the vars it needs; those are the only readers of process.env.

docs/           Architecture, domain, conventions, decisions, tasks.
docs/reference/ Original design source (raw SQL, authz prototype).
```

### The type chain — do not break it

```
db → contracts → services → trpc → web (type-only)
```

Types flow one direction. A column change propagates to the client as a type error;
that is the point. `apps/web` must never import runtime code from `@repo/trpc`,
`@repo/db`, or `@repo/services` — only `import type`.

---

## Hard rules

Breaking these causes data corruption, security holes, or silent history loss.
Rationale in `docs/CONVENTIONS.md`.

1. **Never query an operational table without a tenancy filter.** Staff queries filter by
   `DataScope`; student queries filter by owned `studentId`. Both are *required function
   arguments* so the compiler catches omissions.
2. **Never hard-delete** a user, student, payment, attendance record, or exam result.
   Use `status` / `is_active`.
3. **Never UPDATE `financial_transactions`.** Append-only; corrections are offsetting rows.
4. **Never store money as float.** `decimal(10,2)` in DB, decimal library in code.
5. **Never read `attendance_records` for reporting.** Read `daily_attendance_status`.
6. **Never mutate `student_enrollments` year-over-year.** Promotion inserts a new row.
7. **Never update `student_component_results` after `published`.** Insert a revision row first.
8. **Never expose unpublished marks to students.** Student portal reads
   `published_report_cards` only.
9. **Never implement auth logic by hand.** better-auth owns passwords, sessions, tokens.
10. **UUID primary keys everywhere** (`uuid().primaryKey().defaultRandom()`), except
    better-auth's own tables, whose ids are `text`.
11. **Always `timestamp({ withTimezone: true })`.**
12. **Creating a school/class/section MUST also insert a `scope_nodes` row**, in the same
    transaction. Miss it and every request for that node 403s.

---

## Two authorization tracks

Staff and students are authorized by different mechanisms. Know which you are writing.

```
STAFF   →  role_assignments → org_role_permissions → can() → DataScope
           tRPC: staffProcedure('resource:action')
           Namespace: <domain>.*   e.g. fee.list

STUDENT →  session → student_portal_access → owned studentIds
           tRPC: studentProcedure  (no permission gate; ownership filter)
           Namespace: portal.*     e.g. portal.fees.list
```

Students have **no** `role_assignments` rows and never invoke `can()`. Guardians have no
login — the student account is the family account. See ADR-005 … ADR-009.

---

## Where to look

| File | Contents |
|---|---|
| `docs/PRD.md` | Product scope, personas, what is deliberately not built |
| `docs/ARCHITECTURE.md` | Package boundaries, request lifecycle, env, auth wiring |
| `docs/DOMAIN.md` | The 63 tables, 5 domains, critical business flows |
| `docs/CONVENTIONS.md` | Naming, Drizzle patterns, anti-patterns with rationale |
| `docs/DECISIONS.md` | **ADR log. Read before changing any architectural choice.** |
| `docs/TASKS.md` | Phased backlog + "resume here". Update as you work. |
| `docs/reference/` | Original raw SQL and the authz prototype it was ported from |

---

## Working agreement

- **Read `docs/TASKS.md` before starting.** It says what is done and what is next.
- **Update `docs/TASKS.md` when you finish.** The next agent depends on it.
- **Record architectural choices in `docs/DECISIONS.md`** as a new ADR. Never silently
  contradict an existing one — supersede it explicitly, with reasoning.
- Each fact lives in exactly one doc; others link to it. Do not restate the tenancy model
  in five places — it will drift.
- Prefer editing existing files over adding new ones.
- When raw SQL in `docs/reference/` conflicts with `docs/DECISIONS.md`, **DECISIONS.md wins**
  — the SQL is pre-decision source material.
