# mskool mobile (`@repo/mobile`)

One Expo iOS/Android app, two shells: `(staff)` first, `(family)` with the
family phase (ADR-043). Consumes the same tRPC surface as `apps/web` via
`import type { AppRouter }` only — never runtime `@repo/trpc`/`@repo/db`.

Plan: `docs/MOBILE_PLAN.md`. Step-0 slice:
`.kilo/plans/1791972469955-mobile-step0-foundation.md`.

```bash
pnpm --filter @repo/mobile exec expo install --check
pnpm --filter @repo/mobile exec expo-doctor
pnpm --filter @repo/mobile start
```

Scheme: `mskool://`. API origin: `EXPO_PUBLIC_API_URL` in root `.env`.
Dev builds are the project baseline; Expo Go is exploration only.

Local dev needs `apps/mobile/.env.local` (gitignored, per-machine) with
`EXPO_PUBLIC_API_URL=http://<this-machine's-LAN-IP>:4000` — Expo loads env
from the app directory, NOT the monorepo root, so bare `expo start` fails
loudly without it. Verify the LAN IP when devices can't reach the API.
