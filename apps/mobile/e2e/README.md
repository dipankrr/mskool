# Mobile E2E — attendance (Maestro, Android)

The mobile app's first automated journey suite. It runs the **real dev client
against the real API and Postgres** on an Android emulator — no mocks. It is
deliberately outside `pnpm test`: it needs a device, a running API/Metro, and it
**wipes the demo fixture**.

Three golden flows:

| Flow | Persona | Proves |
|---|---|---|
| `01-mark.yaml` | class teacher | login → Attendance → mark Aditi absent → save → summary reads `1 absent` |
| `02-subject-teacher.yaml` | subject teacher | `attendance:create` allows editing the saved day; `attendance:update` (the manage gear) is not offered |
| `03-manage.yaml` | admin | calendar day override → policy late window → period create, all through the real API |

They share one session sequence, so run them in order (`01` signs in, `02`/`03`
sign out and switch persona). `run-android.mjs` does that.

## Prerequisites

- API 34 (Android 14) emulator, app `com.mskool.app` (dev client) installed.
- **Java 21** (`JAVA_HOME` set) and adb with `adb root` (userdebug emulator).
- API on `:4000` and Metro on `:8081` already running. Web is **not** needed:
  - API: `pnpm --filter @repo/api dev`
  - Metro: `pnpm --filter @repo/mobile start`
- Maestro CLI **2.11+** on `PATH` (or in `%USERPROFILE%\maestro\bin`).
  Download `maestro.zip` from the Maestro GitHub releases, extract it to
  `%USERPROFILE%\maestro`, and add `%USERPROFILE%\maestro\bin` to `PATH`.
  `maestro --version` should work in a fresh shell.
- The emulator must reach Metro on the host. The runner uses the emulator alias
  `10.0.2.2:8081`; override with `E2E_METRO_HOST` if needed.

## Run

```bash
pnpm e2e:android
```

What it does:

1. checks `:4000` / `:8081` and the device;
2. `pnpm reset:demo -- --yes` + `pnpm db:seed` — **destroys and recreates the
   `demo-trust` org**;
3. pins the emulator clock to **Fri 6 Mar 2026 11:00 IST** (inside AY 2025-26),
   disables animations, dismisses the keyguard;
4. `pm clear com.mskool.app`, reconnects the dev client via
   `mskool://expo-development-client/?url=http://10.0.2.2:8081`, dismisses the
   dev-client first-run sheet, waits for login;
5. runs the three flows in order;
6. asserts the Postgres writes (`@repo/db verify:e2e`): Aditi absent on 6 Mar,
   7 Mar holiday with reason `E2E holiday`, late window 20, one `Period 1`;
7. restores animations and the clock (`auto_time=1`) in a `finally`.

Artifacts (Maestro screenshots/hierarchy on failure, plus the runner's last UI
dump on a launch timeout) go to `apps/mobile/.expo/e2e/<timestamp>/`.

## The clean fixture

After the reset + seed:

- Aditi Sharma (`DEMO-0001`) is the only sectioned 6-A student; Rohan Verma is
  admitted without a section. **Only one 6-A section exists** in school A — the
  richer manual demo (6-B, six students) was not seeded and is wiped by the
  reset. Use the flow's assertions as written; a dedicated `seed:e2e` with more
  students is a planned follow-up.
- Policy: `daily`, `homeroom_authoritative`, late window 15.
- Calendar generated for AY 2025-26; no attendance and no periods.

## Dev-client FAB

After a sign-in the Expo DevTools FAB resets onto the Attendance header gear and
eats the tap. Flow 3 drags it to the bottom-left immediately before tapping the
gear. This is a dev-build-only workaround; a release/preview APK has no FAB and
is the planned hardening step.

## Clock

The pin uses `adb root` + `settings put global auto_time 0` + `date`. If a run is
killed before `finally`, restore it manually:

```bash
adb shell settings put global auto_time 1
adb shell settings put global auto_time_zone 1
```

## When it fails

- **"Could not connect to development server"**: Metro is down or the emulator
  cannot reach `10.0.2.2:8081`; try `E2E_METRO_HOST=<host LAN IP>`.
- **Login timeout**: the runner saves `ui-timeout.xml` in the artifacts folder;
  check whether the dev launcher or an error screen is up.
- **`pm clear` failed**: the dev client is not installed on that AVD.
- **Reset failed**: treat as fatal. The reset now restores the append-only
  ledger trigger on the failure path too; if it still reports a trigger problem,
  stop and fix the database before running anything else.
- **Maestro adb timeout at start**: retry once — the adb instrumentation handshake
  occasionally times out on a freshly booted emulator.

## Known gaps

- Dev-client build (Metro required); release/preview APK is the hardening step.
- One thin section; no list-density/scroll assertions until `seed:e2e` exists.
- Android only. iOS is out of scope by owner decision (2026-10-20).
- No CI runner yet; no visual snapshots, performance, or concurrency coverage.
