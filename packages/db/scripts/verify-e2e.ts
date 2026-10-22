/**
 * Post-run assertions for the mobile attendance E2E (Maestro).
 *
 *   pnpm e2e:android            # runner calls this after the flows
 *
 * Proves the flows wrote through the real API into Postgres — not just that
 * the UI showed a success state. Assumes a clean `reset:demo` + `db:seed`
 * followed by `apps/mobile/e2e/flows/01..03`. Read-only; safe to re-run.
 */
import postgres from "postgres";
import { env } from "../src/env";

const sql = postgres(env.DIRECT_DATABASE_URL ?? env.DATABASE_URL, {
  prepare: false,
  idle_timeout: 5,
});

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const [org] = await sql<{ id: string }[]>`
    SELECT id FROM organizations WHERE slug = 'demo-trust'
  `;
  if (!org) {
    throw new Error(
      "demo-trust not found. Run `pnpm reset:demo -- --yes` then `pnpm db:seed` before the E2E.",
    );
  }

  const attendance = await sql`
    SELECT das.date, das.status
    FROM daily_attendance_status das
    JOIN students s ON s.id = das.student_id
    WHERE s.organization_id = ${org.id}
      AND s.admission_number = 'DEMO-0001'
      AND das.date = '2026-03-06'
  `;
  check(
    "Aditi is absent on Fri 6 Mar 2026 (one daily status)",
    attendance.length === 1 && attendance[0]!.status === "absent",
    JSON.stringify(attendance),
  );

  const calendar = await sql`
    SELECT day_type, reason
    FROM academic_calendar
    WHERE organization_id = ${org.id} AND date = '2026-03-07'
  `;
  check(
    "7 Mar 2026 is a holiday with the E2E reason",
    calendar.length === 1 &&
      calendar[0]!.day_type === "holiday" &&
      calendar[0]!.reason === "E2E holiday",
    JSON.stringify(calendar),
  );

  const policy = await sql`
    SELECT marking_mode, late_arrival_minutes
    FROM attendance_policies
    WHERE organization_id = ${org.id}
  `;
  check(
    "policy is daily with a 20-minute late window",
    policy.length === 1 &&
      policy[0]!.marking_mode === "daily" &&
      policy[0]!.late_arrival_minutes === 20,
    JSON.stringify(policy),
  );

  const periods = await sql`
    SELECT name, sequence_number
    FROM periods
    WHERE organization_id = ${org.id}
    ORDER BY sequence_number
  `;
  check(
    "one 'Period 1' period exists",
    periods.length === 1 &&
      periods[0]!.name === "Period 1" &&
      periods[0]!.sequence_number === 1,
    JSON.stringify(periods),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(async () => {
    await sql.end();
    if (failures > 0) {
      console.error(`\n${failures} E2E database check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll E2E database checks passed.");
  });
