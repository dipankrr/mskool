/**
 * One-shot backfill for ADR-061: re-counts every school's CURRENT session of
 * attendance summaries under the new rules (working days from the day each
 * student joined, minus left-and-rejoined gaps; late counted per the school's
 * policy). Closed and earlier sessions are left exactly as they are.
 *
 * Run once per environment, right after migration 0046:
 *
 *   pnpm attendance:recompute
 *
 * Re-runnable: the summary is a pure function of the daily statuses and the
 * calendar, so a second run writes the same numbers. One transaction per
 * school, so a failure leaves every other school done and this one as it was.
 */
import { db } from "@repo/db";
import { academicYears, schools } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { recomputeCurrentSession } from "@repo/services";

async function main() {
  const rows = await db
    .select({
      schoolId: schools.id,
      organizationId: schools.organizationId,
      name: schools.name,
    })
    .from(schools)
    .innerJoin(academicYears, eq(academicYears.schoolId, schools.id))
    .where(eq(academicYears.isCurrent, true));

  console.log(`Re-counting the current session for ${rows.length} school(s).`);
  let total = 0;
  for (const row of rows) {
    const started = performance.now();
    const students = await db.transaction((tx) =>
      recomputeCurrentSession(tx, row.organizationId, row.schoolId),
    );
    total += students;
    console.log(
      `  ${row.name}: ${students} student(s) in ${Math.round(performance.now() - started)} ms`,
    );
  }
  console.log(`\nDone. ${total} student(s) re-counted.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
