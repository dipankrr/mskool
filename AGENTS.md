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
| Mobile | Expo + React Native + Expo Router (`apps/mobile`; native iOS/Android app) |
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
pnpm test             # vitest. Currently @repo/authz only (scope maths).


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
  mobile/       Expo Router app. Native React Native UI; imports ONLY `type AppRouter` from @repo/trpc.
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
db → contracts → services → trpc → web/mobile (type-only)
```

Types flow one direction. A column change propagates to the client as a type error;
that is the point. `apps/web` and `apps/mobile` must never import runtime code
from `@repo/trpc`, `@repo/db`, or `@repo/services` — only `import type`.
The mobile bundle must not pull server-only dependencies through runtime imports
from `@repo/contracts`; prove client-safe schema imports at the foundation gate
before using shared schemas at runtime. See `docs/MOBILE_PLAN.md`.

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

## Mobile implementation contract

Before changing `apps/mobile`, read `docs/TASKS.md`, `docs/MOBILE_PLAN.md`,
and the mobile conventions in `docs/CONVENTIONS.md`. The plan's route parity
ledger and slice order are the source of truth; update both the ledger and
`docs/TASKS.md` when a workflow changes status.

These are hard rules for mobile work:

0. **Use docs from internet & applicable skills and current references before implementation.** Check
   the available skills and read the directly relevant one before Expo/RN work. Use docs like expo docs (docs.expo.dev) for reference
   Examples: `expo-router` for navigation, `expo-data-fetching` for network
   work, `expo-design-system` for tokens/components, `expo-native-ui` and
   `expo-ui` for platform controls, `expo-animation` for gestures/motion,
   `vercel-react-native-skills` for RN performance, and
   `mobile-design` for mobile UX/design reviews, `expo-examples` for supported
   integration examples, `expo-dev-client` for development builds, and
   `expo-project-structure` for the initial app layout only. Skills guide the
   workflow; they do not replace version-matched technical documentation.
   Verify APIs against the pinned SDK and official Expo/React Native/platform
   docs or the maintainer docs for the exact library version. Record links,
   versions, and applicable skills in the slice plan. If a skill, memory, or
   old example conflicts with current docs, resolve and record the conflict
   before coding. Do not invent APIs or copy unchecked snippets.
1. **Do not port the web UI.** Build screens with React Native/Expo routes and
   native interaction patterns. No Next.js page, DOM/shadcn component, CSS
   layout, responsive-web screenshot implementation, or WebView substitute
   counts as a mobile feature. Reuse business rules and API contracts only.
2. **Do not start feature UI from endpoints or web screenshots.** First write
   the slice's actor/task/context, journey, wireflow, screen states, and
   acceptance criteria in the mobile slice plan. For the initial shell, get
   owner review of the three prototype journeys required by `MOBILE_PLAN.md`
   before implementing the production shell or shared UI. Later slices follow
   the reviewed mobile patterns and only reopen design review when their
   workflow differs materially.
3. **Every web staff workflow needs a mobile disposition.** Map its actor,
   permission, entry point, completion, and mobile screen in the route parity
   ledger. A route with an API but no usable journey is incomplete. No staff
   route may be called “web-only” without an explicit owner decision.
4. **Every data screen handles real states.** Initial loading, empty, error
   and retry, offline, permission denial, submitting, success, app resume,
   and unsaved work must be designed where relevant. Keep forms keyboard-safe;
   support platform back/dismiss, touch targets, text scaling, and screen
   readers. Never show a success state before the server confirms it.
5. **Show the actual mobile result.** Before marking a UI slice complete,
   review a rendered screen on a phone-sized layout and do its required device
   walk. A passing typecheck or a screenshot of a browser-sized page does not
   prove mobile UX. Use iOS and Android checks at the release gates in the
   plan.

When a requirement conflicts with this contract or the mobile plan, stop
before coding and report the conflict with the affected workflow; do not
silently substitute a web layout.

---

## Where to look

| File | Contents |
|---|---|
| `docs/PRD.md` | Product scope, personas, what is deliberately not built |
| `docs/ARCHITECTURE.md` | Package boundaries, request lifecycle, env, auth wiring |
| `docs/DOMAIN.md` | The 63 tables, 5 domains, critical business flows |
| `docs/CONVENTIONS.md` | Naming, Drizzle patterns, anti-patterns with rationale |
| `docs/DECISIONS.md` | **ADR log. Read before changing any architectural choice.** |
| `docs/MOBILE_PLAN.md` | Mobile build order + per-domain endpoint tables (ADR-043) |
| `docs/TASKS.md` | Phased backlog + "resume here". Update as you work. |
| `docs/reference/` | Original raw SQL and the authz prototype it was ported from |

---

## Working agreement

- **Read `docs/TASKS.md` before starting.** It says what is done and what is next.
- **Never commit or push yourself.** Prepare the change, run the gates, and hand the user
  a ready-to-paste commit message plus the exact file list. The user reviews and commits
  manually. Keep commits small — one layer or one concern per commit, not one
  mega-commit per feature.
- **Update `docs/TASKS.md` when you finish.** The next agent depends on it.
- **Record architectural choices in `docs/DECISIONS.md`** as a new ADR. Never silently
  contradict an existing one — supersede it explicitly, with reasoning.
- Each fact lives in exactly one doc; others link to it. Do not restate the tenancy model
  in five places — it will drift.
- Prefer editing existing files over adding new ones.
- When raw SQL in `docs/reference/` conflicts with `docs/DECISIONS.md`, **DECISIONS.md wins**
  — the SQL is pre-decision source material.
