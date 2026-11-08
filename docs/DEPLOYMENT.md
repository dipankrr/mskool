# Deployment

**Status (2026-11-05): the API deploy path is built and verified locally. It has not been
deployed to Hostinger yet.** This file covers the API only; web and mobile have their own
builds.

---

## What runs where

| Piece | Where | Why |
|---|---|---|
| API (Express + tRPC + better-auth) | Hostinger **Web App** (Node 22) | A managed Node process, started on incoming traffic and stopped after an idle period. |
| PostgreSQL | Neon | Pooled URL at runtime, direct URL for migrations. |
| Redis | Upstash | Required: the authz cache is read on every authorized request. |
| Object storage | Cloudflare R2 (S3-compatible), metadata in Postgres | One private and one public bucket per environment (ADR-063). |
| Web | Not covered here | See [Web](#web) below. |
| Mobile | EAS / local native build | Talks to the API over HTTPS. |

Do not deploy the API to serverless functions or to a plan without Node.js app support.
The two sweepers live in the API process, and better-auth's webhook mounts need raw bodies.

---

## The build artifact

```bash
pnpm build:api                    # -> apps/api/dist/index.mjs (~6.1 MB + source map)
pnpm --filter @repo/api start     # -> node dist/index.mjs
```

`tsup` bundles **everything** — the `@repo/*` workspace packages and their npm dependencies
— into `index.mjs`. The output needs no `node_modules` beside it and no TypeScript runtime.
That is deliberate: the workspace packages export raw `.ts` source, while the production
entry must run in plain Node without a TypeScript loader. A self-contained artifact also
keeps the same start command portable to another Node host. Hostinger deploys the whole
Express root (including `node_modules`) into `hbuilds/current/nodejs`, but the artifact does
not depend on that layout. See ADR-060.

One dependency stays outside the bundle: `sharp` (ADR-063 image processing) ships a native
binary per platform, so `index.mjs` imports it at runtime from `apps/api`'s `node_modules`, which
the build's `pnpm install` provides on the host. A deploy must boot and process an image before
the first upload feature relies on it.

`dist/server.mjs` is a second library/test entry; Hostinger runs only `index.mjs`. It is
redundant in the hosted process but retained to avoid changing the API package's existing
build surface as part of the deployment change.

---

## Hostinger setup

1. Push `main` to GitHub. Hostinger's GitHub app can read a private repository; one GitHub
   account is allowed per hosting plan.
2. Hostinger dashboard → **Websites → Create site → Web App → Import Git Repository**.
3. Pick the repository and the `main` branch, then set:

   | Setting | Value |
   |---|---|
   | Application type | `Express` |
   | Root directory | `/` or empty (the Turborepo root; the API needs the workspace) |
   | Node.js version | `22` |
   | Build script | `build:api` (root script; runs `pnpm --filter @repo/api build`) |
   | Output directory | **Leave empty** (Hostinger deploys the whole Express root) |
   | Entry file | `apps/api/dist/index.mjs` (entry paths for Express are root-relative) |

   These path rules come from Hostinger's current Build Settings reference: Express output
   stays empty and its entry file is relative to the selected root. Do not enter
   `apps/api/dist` as both output and part of the entry path.

4. Add the environment variables below, then deploy.
5. Open the runtime logs if the site shows 503. A missing env var fails at boot with
   `❌ Invalid environment variables`; a port problem shows as `EADDRINUSE`.

The build installs the whole monorepo (including the mobile workspace), so the first build
is slow. Later builds reuse the pnpm store.

### Temporary test deployment

For the first smoke test, use Hostinger's temporary URL and the existing test Neon, Redis
and auth secret. The URL is public even if it is hard to guess, so do this only while the
database contains fake data. Do not share the URL.

```env
NODE_ENV=production
DATABASE_URL=<existing Neon pooled URL>
REDIS_URL=<existing Upstash rediss:// URL>
BETTER_AUTH_SECRET=<existing test secret>
BETTER_AUTH_URL=https://<hostinger-temporary-url>
CORS_ORIGIN=https://<hostinger-temporary-url>
HOMEWORK_WORKER_DISABLED=true
FEES_WORKER_DISABLED=true
DISABLE_RATE_LIMIT=false
```

Do not set `PORT` or `DIRECT_DATABASE_URL`, and do not run a migration or seed merely to
deploy the same code against the already-current test database. Stop the local API while
checking the hosted one so there is one writer and one set of rate-limit observations.

### Environment variables

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Excludes Expo dev origins and enables production auth behaviour. |
| `PORT` | **do not set** | Hostinger injects the port it proxies to. The API defaults to 4000 only when it is absent. |
| `DATABASE_URL` | Neon **pooled** URL | Host contains `-pooler`; the client already sets `prepare: false`. |
| `DIRECT_DATABASE_URL` | Neon **direct** URL | Not read at runtime; keep it out of the running app. Used by migrations from your machine. |
| `BETTER_AUTH_SECRET` | 32 random bytes | Reusing the test secret is acceptable for the temporary test; rotate before a real pilot. |
| `BETTER_AUTH_URL` | `https://api.mskool.in` | Exact public origin, no trailing slash. Secure cookies follow this. |
| `CORS_ORIGIN` | `https://mskool.in` | Comma-separated allowlist. Add the web origin when web is deployed. Native mobile requests send no `Origin`. |
| `REDIS_URL` | `rediss://…` | Upstash TLS URL, not `redis://`. |
| `FEE_WEBHOOK_SECRET` | optional | Omit it and the gateway webhook answers 404. Set it only when a gateway is wired. |
| `HOMEWORK_WORKER_DISABLED` | `true` on Hostinger for now | Hostinger stops idle processes, so an in-process schedule is not reliable. |
| `FEES_WORKER_DISABLED` | `true` on Hostinger for now | Same limitation; add a cron entry point or use an always-on host before enabling it. |
| `DISABLE_RATE_LIMIT` | unset | `true` is a test-suite escape hatch; never in production. |
| `STORAGE_ENDPOINT`, `STORAGE_REGION` | the R2 S3 endpoint, `auto` | Another S3-compatible provider takes its own endpoint and region. |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | the prod token | Scoped to the two prod buckets only. |
| `STORAGE_PRIVATE_BUCKET`, `STORAGE_PUBLIC_BUCKET` | `mskool-prod-private`, `mskool-prod-public` | |
| `PUBLIC_FILES_BASE_URL` | the public bucket's custom domain | No trailing slash. R2's `r2.dev` address is rate-limited and for testing only. |
| `STORAGE_WORKER_DISABLED` | omit (runs) | Cleanup is not time-critical, so idle suspension only delays it. |

Generate the auth secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`BETTER_AUTH_URL` and `CORS_ORIGIN` are also better-auth's trusted origins, alongside the
native app's `mskool://` scheme. `exp://` origins are development-only and are dropped when
`NODE_ENV=production`.

---

## Database

Use a **separate Neon project or branch** for production. The dev database carries walk
fixtures and demo logins; do not point the public API at it.

Run migrations from your machine against the production **direct** URL before deploying the
code that needs them:

```powershell
$env:DIRECT_DATABASE_URL = "postgresql://…direct…"
pnpm db:migrate
```

```bash
DIRECT_DATABASE_URL="postgresql://…direct…" pnpm db:migrate
```

The root `.env` still supplies `DATABASE_URL`; `dotenv` does not override a variable you
already set. Drizzle has no down migrations, so take a Neon branch or restore point first.

For the first real tenant:

```powershell
$env:DATABASE_URL = "postgresql://…pooled…"
pnpm db:provision -- --org-name "…" --org-slug … --school-name "…" --school-code … --admin-name "…" --admin-email …
```

**Never run `pnpm db:seed` in production.** It creates the demo org and the shared known
password.

---

## Domain

Use the **Hostinger temporary URL for the first smoke test**, then connect
`api.mskool.in` after the API boots and the auth journey passes. Hostinger supports this
flow directly and keeps the temporary URL available while DNS propagates.

`api.mskool.in` is the recommended stable hostname before a mobile release or pilot:

- `BETTER_AUTH_URL` is baked into auth links and secure-cookie behaviour; changing it later
  means another env edit and redeploy.
- The mobile app inlines `EXPO_PUBLIC_API_URL` at build time, so a stable API URL avoids a
  second app build.
- Hostinger issues the subdomain's TLS certificate automatically. Create the subdomain as
  its own website (Hostinger does not support adding a Node.js app to a subfolder of an
  existing site).

When connecting the domain, change `BETTER_AUTH_URL` to `https://api.mskool.in`, update
`CORS_ORIGIN` for the actual web origin (when one exists), and redeploy. A local Expo test
only needs its Metro bundle restarted with the new `EXPO_PUBLIC_API_URL`; a distributed
binary needs a new build.

---

## Mobile

Set the API URL at build time:

- Local/dev: `EXPO_PUBLIC_API_URL=https://api.mskool.in` in the root `.env`.
- EAS: the same value in the build profile's environment (`eas env` / `eas.json`).

The native app attaches the session cookie manually; it does not rely on CORS. After the
first successful sign-in, check a scoped read (students, fees) rather than only the login
screen.

---

## Verify a deploy

```bash
curl https://api.mskool.in/health
curl https://api.mskool.in/openapi.json
curl -I https://api.mskool.in/docs
```

`/health` returns `ok` plus the two sweepers' heartbeats. Then sign in from the app and open
one list. Finally check the runtime logs: a better-auth warning about a missing client IP
means the proxy header changed and the rate limiter has fallen back to one shared bucket.

Local verification done on 2026-11-04 against the built bundle:

- boot with `NODE_ENV=production` and the real Neon/Upstash endpoints;
- `/health`, `/docs`, `/openapi.json`, CORS preflight (allowed origin gets the header,
  unknown origin does not);
- `POST /api/auth/sign-in/email` → `/trpc/me.get` (permissions and both schools) →
  `/api/auth/sign-out`;
- a DB-backed public read (`/api/public/site/demo-trust`);
- Redis `PING`/`SET`/`GET`;
- `X-Forwarded-For` reaches better-auth as the session's `ipAddress`.

---

## Hostinger limits that matter

- **120-second request cap.** The exam compute is ~4 s for 20 students × 3 subjects; a very
  large publish could still approach the cap. Split the work if it does.
- **No inbound WebSockets.** The app does not use them.
- **No Docker or local Redis.** Neon and Upstash are external, so this is fine.
- **Processes stop after an idle period**, not only on deploy/restart. The next request
  starts the API again, but in-process timers are not a scheduler. Keep both workers
  disabled on Hostinger until a finishing cron script or secret-protected cron route exists,
  or move the API to an always-on host. That cron entry point does not exist yet.
- **One Node process.** Do not add PM2 or cluster mode; Hostinger already manages the
  process.
- **Deploys restart the app.** Ship outside school hours.
- **Photos and documents are Postgres rows.** Watch Neon's storage limit as schools upload
  student photos and ID-card assets.

---

## Web

`apps/web` is not part of this deploy. It assumes the API is on the same origin
(`window.location.origin`) and `next.config.mjs` rewrites `/trpc` and `/api` to
`http://localhost:4000`. Serving web against `api.mskool.in` requires changing both the
rewrite destination and the client URL, plus cross-site cookie handling. Do that as its own
change; do not put web and the API in one Hostinger Node app.

---

## Deploy checklist

1. `pnpm check-types` is green.
2. `pnpm build:api` succeeds and `apps/api/dist/index.mjs` exists; CI runs
   this same artifact build on every push and pull request.
3. For a temporary test, confirm the existing test database is current and contains no real
   data. A production database and restore point are deferred until the pilot.
4. `main` is pushed.
5. Hostinger deploy succeeds; `/health` returns `ok`.
6. Sign in from the app; open one scoped list; sign out.
7. Runtime logs are clean (no env, port, Redis, or auth-IP errors).
8. To roll back, redeploy the previous commit. A migration that already ran stays applied.
