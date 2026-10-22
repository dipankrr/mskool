# Mobile attendance E2E — Maestro on Android

Status: **done locally, green twice (2026-10-20); commits pending.** Owner go:
2026-10-20 ("start doing it"). Follow-on to attendance chunk 3. Attendance is the
first complete mobile domain, so it is also the first E2E target — the suite is
the regression net for the slices that reuse its patterns (homework next).

## 1. Measurable outcome

1. One command resets the demo fixture, pins the emulator clock, launches the app and
   runs the golden attendance journeys against the **real API and Postgres** — no mocks.
2. Two consecutive runs from a clean reset are green; the clock is restored afterwards.
3. A failure names the step and leaves screenshots/artifacts for review.
4. The suite catches cross-screen regressions the unit tests cannot: marking → summary,
   policy → marking hint, calendar day → marking gate.

## 2. Tooling decision

- **Maestro CLI 2.11.0** on Windows (Java 21). Native Windows support; lighter than
  Appium/Detox; YAML flows; selectors by accessibility id/text.
- Emulator API 34 (`mskool-dev`), Expo dev client, Metro on `:8081`, API on `:4000`.
- App package `com.mskool.app`, scheme `mskool`.
- RN `testID` appears as `resource-id` in Maestro's hierarchy, so flows use
  `id:` selectors (`login-email`, `tab-attendance`, `attendance-save`, …) rather than
  copy text wherever the id exists.
- Maestro is a **developer-machine tool**, not a repo dependency: install
  `maestro.zip` from the GitHub release, put `bin` on PATH. Document the version in
  the README; do not commit the binary.

## 3. Prerequisites and deterministic base

- API and Metro running (the runner checks `:4000` / `:8081` and fails with a clear
  message instead of starting servers).
- Reset: `pnpm reset:demo -- --yes` then `pnpm db:seed`.
- After a clean seed (verified 2026-10-20): Aditi Sharma (`DEMO-0001`) is the only
  sectioned 6-A student; Rohan Verma (`DEMO-0002`) is admitted without a section;
  11 demo users; policy `daily / homeroom_authoritative / NULL / 15`; calendar
  generated for AY 2025-26.
- Clock: pin `Fri 6 Mar 2026 11:00 IST` (inside AY 2025-26), `auto_time=0`; restore
  `auto_time=1` / `auto_time_zone=1` at the end. Rooted emulator (`adb root`) needed.
- App state: `pm clear com.mskool.app`, then the dev-client deep link
  `mskool://expo-development-client/?url=http%3A%2F%2F<host>%3A8081`.
- Dev-client **Tools FAB** sits over the Attendance header gear and intercepts taps
  in dev builds. After launch, drag it from the top-right to the bottom-left
  (`adb shell input swipe 971 253 160 1900 1200`). Release builds do not have it.

## 4. Flows (v1)

1. **`01-mark.yaml` — class teacher marks and saves.**
   Login `teacher@demo-trust.test` → Attendance tab → assert day `Fri 6 Mar` and Aditi
   → tap her row (present → absent) → `Save attendance` → saved bar → Summary →
   her row reads `1 absent`. This is the write path plus the read model.
2. **`02-subject-teacher.yaml` — permission split, no write.**
   Continues from flow 1: sign out (More → `more-sign-out`) → login
   `subject-teacher@demo-trust.test` → Attendance. The saved day is editable
   (`attendance-edit`; the role holds `attendance:create`) but the manage gear is
   absent (no `attendance:update`). This proves the API/`me.get` permission split
   drives the affordances; it does not write.
3. **`03-manage.yaml` — admin configures.**
   Sign out → login `admin@demo-trust.test` → gear → Calendar: open 7 Mar, set
   Holiday + reason `E2E holiday`, save, row re-renders. Back → Policy: late window
   20, save, saved bar. Back → Periods: add `Period 1` (times optional) → save →
   list row appears. Reset before the next run cleans every write (periods have no
   delete endpoint).

Why not the section switcher: the clean seed has only **6-A** in school A (one
student); the checkpoint's 6-B/six-student demo was manual data wiped by the
reset. A dedicated `seed:e2e` with a second section and roster is the follow-up;
flow 2 uses the permission journey instead, which the thin fixture supports.

Order matters: flow 1 writes attendance for 6 Mar; flows 2–3 run on the same seed.
Each flow starts from the previous end state (subject teacher is signed in for
flow 3, which signs out first).

## 5. Harness layout

```
apps/mobile/e2e/
  flows/01-mark.yaml
  flows/02-subject-teacher.yaml
  flows/03-manage.yaml
  run-android.mjs          # orchestrator (root script: pnpm e2e:android)
  README.md
packages/db/scripts/verify-e2e.ts   # Postgres assertions after the flows
```

`run-android.mjs`:

1. verify `adb devices` has the target device, `:4000` and `:8081` listen;
2. `pnpm reset:demo -- --yes` + `pnpm db:seed`;
3. pin the clock, dismiss the keyguard, disable animations (saved/restored);
4. `pm clear com.mskool.app` + deep link + wait for a **stable** login screen
   (dismisses the dev-client first-run sheet and closes the DevTools menu; the
   sheet can appear a beat after login, so the wait requires ~4 s of stability
   and a second settle pass);
5. `maestro test` the three flows in explicit order (artifacts under
   `apps/mobile/.expo/e2e/<timestamp>/`);
6. `pnpm --filter @repo/db verify:e2e`: Aditi absent on 6 Mar; 7 Mar holiday with
   reason `E2E holiday`; late window 20; one `Period 1`;
7. restore animations and the clock even on failure (`finally`).

The emulator reaches Metro through `10.0.2.2:8081` (override `E2E_METRO_HOST`),
so the runner does not depend on the machine's LAN IP. The root script is
`"e2e:android": "dotenv -e .env -- node apps/mobile/e2e/run-android.mjs"` so the
verifier inherits `DATABASE_URL`.

Not part of `pnpm test` (needs a device). The command is a root script because it
orchestrates the API fixture, the database verifier and the device; CI is a later
slice.

## 6. Acceptance

- Two consecutive runs green from a clean reset. **Passed 2026-10-20** after the
  stable-login fix: `2026-10-20T11-15-25-596Z` (flows 1m01 + 0m41 + 1m50) and
  `2026-10-20T11-22-34-326Z` (0m54 + 0m37 + 1m41); both DB checks green and the
  clock returned to `auto_time=1`.
- Flow 1 leaves exactly one attendance status (absent) and the summary reads it.
- The clock is restored (`auto_time=1`) whether the suite passes or fails.
- The reset script leaves no demo rows behind (asserted by the seed succeeding).
  The two runs each reset once; the ledger trigger is asserted back both times.
- Docs: this plan, `docs/TASKS.md`, and the mobile plan's test section.

Recorded flakes/fixes:

- The full DevTools menu survives the first-run sheet's **Continue**; the runner
  closes it with BACK.
- The first-run sheet can appear **after** the login screen draws. A one-shot
  Maestro conditional missed it and flow 1 failed its login assert. The runner
  now waits for ~4 s of stable login plus a second settle pass, and the flow keeps
  a conditional as a fallback.
- Maestro's adb handshake occasionally times out on a freshly booted emulator;
  retry once (README troubleshooting).

## 7. Findings that block the harness

The 2026-10-20 reset attempt exposed real gaps in `apps/api/scripts/reset-demo.ts`:

- The whole **homework/assignment domain** was missing from the wipe list
  (`student_assignments` blocked enrollment deletion; ~30 tables in total).
- `student_assignments.current_evaluation_id` → `assignment_evaluations` is a cycle;
  the pointer must be nulled before evaluations are deleted.
- Report-card templates, storage objects, student photos, ID-card templates and the
  public-site row were never deleted, blocking org/school/user deletion.
- Demo users can hold a `role_assignment` outside `demo-trust` (public-site org), so
  deleting users by email alone fails; role assignments and audit rows must be
  removed by user as well.

Fix is in this slice, as its own commit (it is a dev-script bug, independent of E2E).
The ledger trigger now also restores on the **failure path** (`restoreLedgerTrigger`
is idempotent and `main().catch` calls it if the drop is still in effect), so a
failed wipe cannot leave the append-only guard off. The runner still treats a
failed reset as fatal and stops before seeding.

The E2E harness is not a dependency of `pnpm test`; it needs a device, a running
API/Metro and Maestro. Commit it separately from the reset fix.

## 8. Known gaps / follow-ups

- Dev-client build only; a release/preview APK is the hardening step (no FAB, no
  Metro, closer to production).
- One emulator/API level; iOS is explicitly out of scope (owner decision 2026-10-20).
- The seeded roster is thin (one student in 6-A) and there is only one section in
  school A. Flow 2 covers the permission split instead of the section switcher;
  the switcher/empty-section journey needs a dedicated `seed:e2e` with 6-B and a
  roster — recommended before the homework slice reuses the harness.
- No visual snapshots; no performance/concurrency coverage.
- Reset still uses a hand-maintained table list. A catalog-derived delete order is the
  robust long-term answer; the seed-failure signal (FK error names the table) keeps it
  honest until then.

## 9. Commit plan

After attendance chunks 2/3 so the E2E work reviews on its own. Full chunk 2/3
messages and file lists live in those plans; the two new commits are:

**A — fix(api): make reset:demo cover the homework domain and failed wipes**

Files: `apps/api/scripts/reset-demo.ts` only.

```
fix(api): make reset:demo cover the homework domain and failed wipes

The E2E reset exposed four gaps: the homework/assignment tables were never
in the wipe (student_assignments blocked enrollment deletes); the
student_assignments.current_evaluation_id -> assignment_evaluations cycle
needed nulling first; report-card/ID-card templates, storage objects,
student photos and the public-site row blocked org/school/user deletes;
and demo users can hold role/audit rows outside demo-trust.

Also make the append-only trigger safe on the failure path: the restore SQL
is now one idempotent function called by main().catch when the drop is still
in effect, so a failed reset cannot leave financial_transactions mutable.
```

**B — test(mobile): add Maestro attendance E2E harness**

Files:
- `apps/mobile/e2e/README.md` (A)
- `apps/mobile/e2e/run-android.mjs` (A)
- `apps/mobile/e2e/flows/01-mark.yaml` (A)
- `apps/mobile/e2e/flows/02-subject-teacher.yaml` (A)
- `apps/mobile/e2e/flows/03-manage.yaml` (A)
- `packages/db/scripts/verify-e2e.ts` (A)
- `packages/db/package.json` (M — `verify:e2e`)
- `package.json` (M — `e2e:android`)
- `.kilo/plans/2026-10-20-mobile-attendance-e2e.md` (A)
- Docs (`docs/MOBILE_PLAN.md`, `docs/TASKS.md`) are committed with chunk 3 E;
  do not re-add them here.

```
test(mobile): add Maestro attendance E2E harness

Three golden Android flows against the real API/Postgres: 01 class teacher
marks Aditi absent, saves and reads "1 absent" in the summary; 02 subject
teacher can edit the saved day but gets no manage gear; 03 admin sets 7 Mar
as a holiday, saves a 20-minute late window and creates Period 1.

`pnpm e2e:android` resets demo-trust + seeds, pins the emulator clock to
Fri 6 Mar 2026, clears/reconnects the dev client, waits for a stable login,
runs the flows in order, then asserts the writes with @repo/db verify:e2e.
The clock and animations restore in a finally; artifacts land in
apps/mobile/.expo/e2e/<timestamp>/.

Two consecutive full runs passed 2026-10-20 (3/3 flows and 4/4 DB checks
each). Not part of pnpm test; needs an emulator, Maestro 2.11+, API :4000
and Metro :8081.
```

Do not commit the Maestro install or `apps/mobile/.expo/` artifacts (gitignored).
E2E remains outside `pnpm test`; CI is a later slice.
