/**
 * Proves the hand-written CHECK constraints (ADR-013) are actually enforced by
 * the server, not merely present in a .sql file.
 *
 *   pnpm db:verify
 *
 * Every write happens inside a transaction that is ALWAYS rolled back, so this
 * is safe to run against a database with data in it. A constraint that exists
 * but does not bite is worse than no constraint, because it is trusted.
 *
 * Note on the savepoints: in Postgres a failed statement poisons the whole
 * transaction, so a test that deliberately triggers a violation must run inside
 * a SAVEPOINT and the failing statement must be issued on the SAVEPOINT handle
 * — not the outer transaction handle. Otherwise the first expected failure
 * aborts every assertion after it.
 */
import postgres from "postgres";
import { env } from "../src/env";

const sql = postgres(env.DIRECT_DATABASE_URL ?? env.DATABASE_URL, {
  prepare: false,
  idle_timeout: 5,
});

/** Any handle that can run a query: the transaction or a savepoint. */
type Queryable = postgres.TransactionSql;

let failures = 0;

function report(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const ACCEPTED = "__unexpectedly_accepted__";
const ROLLBACK = "__rollback__";

/** Runs `body`, then rolls back unconditionally. */
async function inRollback(body: (tx: Queryable) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await body(tx as Queryable);
      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
  }
}

/**
 * Expects `run` to be REJECTED by a specific named constraint. Checking the
 * NAME matters: an insert rejected by a NOT NULL or a typo would otherwise
 * count as a pass and the real constraint could be absent.
 */
async function expectReject(
  tx: Queryable,
  label: string,
  constraint: string,
  run: (q: Queryable) => Promise<unknown>,
) {
  try {
    await tx.savepoint(async (sp) => {
      await run(sp as Queryable);
      throw new Error(ACCEPTED);
    });
    report(label, false, "insert was ACCEPTED but should have been rejected");
  } catch (error) {
    if (error instanceof Error && error.message === ACCEPTED) {
      report(label, false, "insert was ACCEPTED but should have been rejected");
      return;
    }
    const violated = (error as { constraint_name?: string }).constraint_name;
    report(
      label,
      violated === constraint,
      violated ? `rejected by ${violated}` : String(error),
    );
  }
}

/** Expects `run` to succeed. Wrapped so an unexpected failure cannot poison the tx. */
async function expectAccept(
  tx: Queryable,
  label: string,
  run: (q: Queryable) => Promise<unknown>,
) {
  try {
    await tx.savepoint(async (sp) => {
      await run(sp as Queryable);
    });
    report(label, true);
  } catch (error) {
    const violated = (error as { constraint_name?: string }).constraint_name;
    report(label, false, violated ? `rejected by ${violated}` : String(error));
  }
}

async function main() {
  console.log("\n=== constraints registered on the server ===");
  const constraints = await sql<{ table_name: string; constraint_name: string }[]>`
    SELECT rel.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.contype = 'c'
      AND con.conname IN (
        'role_assignments_org_scope_id_matches_org',
        'scope_nodes_shape_matches_type',
        'academic_years_end_after_start',
        'terms_end_after_start',
        'terms_weightage_range',
        'attendance_policies_threshold_range',
        'fee_structure_lines_amount_non_negative',
        'fee_structure_lines_month_range',
        'fee_structure_lines_month_order',
        'late_fee_rules_value_positive',
        'late_fee_rules_date_order'
      )
    ORDER BY con.conname
  `;
  for (const c of constraints) console.log(`  ${c.table_name}.${c.constraint_name}`);
  report("all CHECK constraints exist", constraints.length === 11, `found ${constraints.length}/11`);

  // contype 'x' is an EXCLUDE constraint. drizzle-kit cannot see these at all,
  // so their absence would be silent — hence checking the catalog directly.
  const exclusions = await sql<{ table_name: string; constraint_name: string }[]>`
    SELECT rel.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.contype = 'x'
      AND con.conname IN (
        'academic_years_no_overlap_excl',
        'academic_years_one_current_excl'
      )
    ORDER BY con.conname
  `;
  for (const c of exclusions) console.log(`  ${c.table_name}.${c.constraint_name}`);
  report("both EXCLUDE constraints exist", exclusions.length === 2, `found ${exclusions.length}/2`);

  // A term's dates must sit inside its parent year's dates — a cross-table
  // rule no CHECK can hold, so it is a trigger in hand-written migration SQL.
  // drizzle-kit cannot see it and the catalog table differs; same silence-as-
  // absence risk as the EXCLUDEs, same catalog check as the answer.
  const triggers = await sql<{ tgname: string }[]>`
    SELECT tg.tgname FROM pg_trigger tg
    JOIN pg_class rel ON rel.oid = tg.tgrelid
    WHERE rel.relname = 'terms'
      AND tg.tgname = 'terms_dates_within_year_trg'
      AND NOT tg.tgisinternal
  `;
  report("the terms date trigger exists", triggers.length === 1, `found ${triggers.length}/1`);

  console.log("\n=== hard rule 11: every timestamp is timestamptz ===");
  const naive = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
    ORDER BY table_name, column_name
  `;
  report("no naive timestamp columns", naive.length === 0, `${naive.length} found`);
  for (const c of naive) console.log(`        ${c.table_name}.${c.column_name}`);

  await inRollback(async (tx) => {
    const [org] = await tx<{ id: string }[]>`
      INSERT INTO organizations (name, legal_name, slug)
      VALUES ('Verify Trust', 'Verify Educational Trust', 'verify-trust')
      RETURNING id
    `;
    const [school] = await tx<{ id: string }[]>`
      INSERT INTO schools (organization_id, name, legal_name, code)
      VALUES (${org.id}, 'Verify School', 'Verify School', 'VS1')
      RETURNING id
    `;

    console.log("\n=== scope_nodes_shape_matches_type ===");

    // What insertScopeNode() actually writes for a school: school_id NULL,
    // because a school node's own id IS the schoolId.
    await expectAccept(tx, "school node with NULL school_id is accepted", (q) =>
      q`INSERT INTO scope_nodes (id, type, organization_id)
        VALUES (${school.id}, 'school', ${org.id})`,
    );

    // A class node without school_id yields a DataScope whose schoolId is null
    // — a filter spanning the whole org. This is the leak being closed.
    await expectReject(
      tx,
      "class node WITHOUT school_id is rejected",
      "scope_nodes_shape_matches_type",
      (q) =>
        q`INSERT INTO scope_nodes (id, type, organization_id)
          VALUES (gen_random_uuid(), 'class', ${org.id})`,
    );

    await expectReject(
      tx,
      "section node WITHOUT class_id is rejected",
      "scope_nodes_shape_matches_type",
      (q) =>
        q`INSERT INTO scope_nodes (id, type, organization_id, school_id)
          VALUES (gen_random_uuid(), 'section', ${org.id}, ${school.id})`,
    );

    await expectReject(
      tx,
      "org node whose id <> organization_id is rejected",
      "scope_nodes_shape_matches_type",
      (q) =>
        q`INSERT INTO scope_nodes (id, type, organization_id)
          VALUES (gen_random_uuid(), 'org', ${org.id})`,
    );

    console.log("\n=== role_assignments_org_scope_id_matches_org ===");
    const [u] = await tx<{ id: string }[]>`
      INSERT INTO "user" (id, name, email, updated_at)
      VALUES ('verify-user-1', 'Verify User', 'verify@example.test', now())
      RETURNING id
    `;

    await expectAccept(tx, "org grant with scope_id = organization_id is accepted", (q) =>
      q`INSERT INTO role_assignments (user_id, organization_id, role_type, scope_type, scope_id)
        VALUES (${u.id}, ${org.id}, 'org_admin', 'org', ${org.id})`,
    );

    // scopeCovers() compares node.organizationId to assignment.scope_id, so a
    // divergent scope_id is either a dead grant or one aimed at another tenant.
    await expectReject(
      tx,
      "org grant with divergent scope_id is rejected",
      "role_assignments_org_scope_id_matches_org",
      (q) =>
        q`INSERT INTO role_assignments (user_id, organization_id, role_type, scope_type, scope_id)
          VALUES (${u.id}, ${org.id}, 'org_admin', 'org', gen_random_uuid())`,
    );

    // A school-scoped grant legitimately has scope_id <> organization_id; the
    // constraint must not over-reach and block it.
    await expectAccept(tx, "school grant with scope_id <> organization_id is accepted", (q) =>
      q`INSERT INTO role_assignments (user_id, organization_id, role_type, scope_type, scope_id)
        VALUES (${u.id}, ${org.id}, 'principal', 'school', ${school.id})`,
    );

    console.log("\n=== academic_years_no_overlap_excl ===");

    // A second school in the same org: the constraint keys on school_id, so
    // this is what proves it does not over-reach to the whole tenant.
    const [school2] = await tx<{ id: string }[]>`
      INSERT INTO schools (organization_id, name, legal_name, code)
      VALUES (${org.id}, 'Verify School Two', 'Verify School Two', 'VS2')
      RETURNING id
    `;

    const year = (
      q: Queryable,
      schoolId: string,
      name: string,
      start: string,
      end: string,
      isCurrent = false,
    ) =>
      q`INSERT INTO academic_years
          (organization_id, school_id, name, start_date, end_date, original_end_date, is_current)
        VALUES (${org.id}, ${schoolId}, ${name}, ${start}, ${end}, ${end}, ${isCurrent})`;

    await expectAccept(tx, "first academic year is accepted", (q) =>
      year(q, school.id, "2025-26", "2025-04-01", "2026-03-31"),
    );

    await expectReject(
      tx,
      "overlapping year in same school is rejected",
      "academic_years_no_overlap_excl",
      (q) => year(q, school.id, "2025-26-dup", "2026-01-01", "2026-12-31"),
    );

    // The '[]' bound in the constraint makes a shared boundary date a conflict.
    // If someone rewrites it as '[)' this is the assertion that notices.
    await expectReject(
      tx,
      "year starting on the previous year's end date is rejected",
      "academic_years_no_overlap_excl",
      (q) => year(q, school.id, "2026-27-off", "2026-03-31", "2027-03-30"),
    );

    await expectAccept(tx, "adjacent non-overlapping year is accepted", (q) =>
      year(q, school.id, "2026-27", "2026-04-01", "2027-03-31"),
    );

    await expectAccept(tx, "same dates in a DIFFERENT school are accepted", (q) =>
      year(q, school2.id, "2025-26", "2025-04-01", "2026-03-31"),
    );

    console.log("\n=== academic_years_one_current_excl ===");

    // Dates here are deliberately non-overlapping: if they collided, the
    // overlap constraint would fire first and this test would pass for the
    // wrong reason.
    await expectAccept(tx, "first current year is accepted", (q) =>
      year(q, school2.id, "2026-27", "2026-04-01", "2027-03-31", true),
    );

    await expectReject(
      tx,
      "second current year in same school is rejected",
      "academic_years_one_current_excl",
      (q) => year(q, school2.id, "2027-28", "2027-04-01", "2028-03-31", true),
    );

    await expectAccept(tx, "second NON-current year is accepted", (q) =>
      year(q, school2.id, "2027-28", "2027-04-01", "2028-03-31"),
    );

    await expectAccept(tx, "current year in a DIFFERENT school is accepted", (q) =>
      year(q, school.id, "2027-28", "2027-04-01", "2028-03-31", true),
    );

    console.log("\n=== academic_years_end_after_start ===");

    // An inverted range is refused even without this constraint, because
    // daterange() inside the no-overlap EXCLUDE throws on lower > upper. That
    // makes the NAME the whole point of this assertion: it distinguishes "our
    // stated rule rejected this" from "a Postgres internal happened to". If
    // someone narrows the EXCLUDE constraint later, the incidental guard
    // disappears and only this one remains.
    await expectReject(
      tx,
      "end_date before start_date is rejected",
      "academic_years_end_after_start",
      (q) => year(q, school.id, "2028-29-bad", "2029-03-31", "2028-04-01"),
    );

    // The bound is `>=`, not `>`. A single-day year is absurd but it is not
    // what this constraint exists to prevent, and a constraint that over-reaches
    // is as much a bug as one that under-reaches.
    await expectAccept(tx, "start_date = end_date is accepted", (q) =>
      year(q, school.id, "2029-30", "2029-04-01", "2029-04-01"),
    );

    console.log("\n=== terms_dates_within_year_trg ===");

    // A year for the term assertions to hang off, dated far from the years
    // above so nothing else can fire first.
    await expectAccept(tx, "the terms test year is accepted", (q) =>
      year(q, school.id, "2030-31", "2030-04-01", "2031-03-31"),
    );
    const [termYear] = await tx<{ id: string }[]>`
      SELECT id FROM academic_years WHERE name = '2030-31' AND school_id = ${school.id}
    `;

    const term = (
      q: Queryable,
      name: string,
      seq: number,
      start: string,
      end: string,
      weightage = "100.00",
    ) =>
      q`INSERT INTO terms
          (organization_id, school_id, academic_year_id, name, sequence_number,
           start_date, end_date, weightage)
        VALUES (${org.id}, ${school.id}, ${termYear.id}, ${name}, ${seq},
                ${start}, ${end}, ${weightage})`;

    await expectAccept(tx, "a term inside the year is accepted", (q) =>
      term(q, "Term 1", 1, "2030-04-01", "2030-09-30"),
    );

    // Boundary: a term may share its year's first and last day. If the trigger's
    // comparison ever hardened to strict `<`/`>`, this is the assertion that
    // notices — the mirror of the '[]' bound check on the year overlap above.
    await expectAccept(tx, "a term spanning the WHOLE year is accepted", (q) =>
      term(q, "Full Year", 2, "2030-04-01", "2031-03-31"),
    );

    await expectReject(
      tx,
      "a term starting BEFORE the year is rejected",
      "terms_dates_within_year_trg",
      (q) => term(q, "Early", 3, "2030-03-01", "2030-09-30"),
    );

    await expectReject(
      tx,
      "a term ending AFTER the year is rejected",
      "terms_dates_within_year_trg",
      (q) => term(q, "Late", 3, "2030-10-01", "2031-04-30"),
    );

    // The trigger guards UPDATEs of the dates too, not only inserts — a year
    // extended backwards, or a term dragged out past its year's end, is the
    // same violation arriving by a different statement.
    await expectReject(
      tx,
      "extending a term past the year end is rejected",
      "terms_dates_within_year_trg",
      (q) =>
        q`UPDATE terms SET end_date = '2031-04-30'
          WHERE academic_year_id = ${termYear.id} AND name = 'Term 1'`,
    );

    console.log("\n=== terms row-level CHECKs ===");

    // No EXCLUDE here makes daterange() throw first, so unlike the year case
    // the CHECK is genuinely the only guard — but the NAME still distinguishes
    // "our rule rejected this" from a NOT NULL or a typo.
    await expectReject(
      tx,
      "end_date before start_date is rejected",
      "terms_end_after_start",
      (q) => term(q, "Inverted", 4, "2030-12-01", "2030-11-01"),
    );

    await expectAccept(tx, "a single-day term is accepted", (q) =>
      term(q, "One Day", 4, "2030-12-01", "2030-12-01"),
    );

    await expectReject(
      tx,
      "a duplicate sequence number in one year is rejected",
      "terms_year_sequence_uq",
      (q) => term(q, "Dup Seq", 1, "2030-10-01", "2030-12-31"),
    );

    // The sequence key is per YEAR, not per school: a second year restarts at
    // Term 1. (Non-overlapping with 2030-31, so the year constraint stays out
    // of the way.)
    await expectAccept(tx, "the terms second test year is accepted", (q) =>
      year(q, school.id, "2031-32", "2031-04-01", "2032-03-31"),
    );
    const [nextYear] = await tx<{ id: string }[]>`
      SELECT id FROM academic_years WHERE name = '2031-32' AND school_id = ${school.id}
    `;
    await expectAccept(tx, "the same sequence in a DIFFERENT year is accepted", (q) =>
      q`INSERT INTO terms
          (organization_id, school_id, academic_year_id, name, sequence_number, start_date, end_date)
        VALUES (${org.id}, ${school.id}, ${nextYear.id}, 'Term 1', 1, '2031-04-01', '2031-09-30')`,
    );

    await expectReject(
      tx,
      "weightage 0 is rejected",
      "terms_weightage_range",
      (q) => term(q, "Zero Weight", 5, "2030-10-01", "2030-12-31", "0.00"),
    );

    await expectReject(
      tx,
      "weightage above 100 is rejected",
      "terms_weightage_range",
      (q) => term(q, "Overweight", 5, "2030-10-01", "2030-12-31", "100.01"),
    );

    console.log("\n=== student_enrollments: the year anchor ===");

    // Hard rule 6's structural half: ONE enrollment per student per year, so
    // promotion can only ever INSERT a new row for the next year — the unique
    // index makes a second row for the same (student, year) unrepresentable.
    const [enrStudent] = await tx<{ id: string }[]>`
      INSERT INTO students
        (organization_id, school_id, admission_number, first_name, last_name,
         date_of_birth, gender)
      VALUES (${org.id}, ${school.id}, 'VERIFY-0001', 'Verify', 'Student',
              '2012-06-15', 'female')
      RETURNING id
    `;
    const [enrYear] = await tx<{ id: string }[]>`
      SELECT id FROM academic_years WHERE name = '2030-31' AND school_id = ${school.id}
    `;
    const [nextEnrYear] = await tx<{ id: string }[]>`
      SELECT id FROM academic_years WHERE name = '2031-32' AND school_id = ${school.id}
    `;
    const [enrClass] = await tx<{ id: string }[]>`
      INSERT INTO classes (organization_id, school_id, name, numeric_order)
      VALUES (${org.id}, ${school.id}, 'Verify 6', 6)
      RETURNING id
    `;
    const [enrSection] = await tx<{ id: string }[]>`
      INSERT INTO sections
        (organization_id, school_id, class_id, academic_year_id, name)
      VALUES (${org.id}, ${school.id}, ${enrClass.id}, ${enrYear.id}, 'A')
      RETURNING id
    `;

    const enroll = (
      q: Queryable,
      yearId: string,
      sectionId: string | null,
      status: string,
    ) =>
      q`INSERT INTO student_enrollments
          (organization_id, school_id, student_id, academic_year_id, class_id,
           section_id, enrollment_status)
        VALUES (${org.id}, ${school.id}, ${enrStudent.id}, ${yearId},
                ${enrClass.id}, ${sectionId}, ${status})`;

    await expectAccept(tx, "an active enrollment with a section is accepted", (q) =>
      enroll(q, enrYear.id, enrSection.id, "active"),
    );

    await expectReject(
      tx,
      "a SECOND enrollment for the same (student, year) is rejected",
      "student_enrollments_student_year_uq",
      (q) => enroll(q, enrYear.id, null, "admitted"),
    );

    // The promotion shape: the NEXT year is a new row, admitted with no
    // section yet — both the year-anchor rule and the nullable-section state
    // in one acceptance.
    await expectAccept(
      tx,
      "the same student in the NEXT year is accepted (promotion inserts)",
      (q) => enroll(q, nextEnrYear.id, null, "admitted"),
    );

    console.log("\n=== Phase 3: attendance config tables (0007) ===");

    // --- academic_calendar: one day-type per school per year per date. ---

    const calDay = (
      q: Queryable,
      schoolId: string,
      yearId: string,
      date: string,
      dayType: string,
    ) =>
      q`INSERT INTO academic_calendar
          (organization_id, school_id, academic_year_id, date, day_type)
        VALUES (${org.id}, ${schoolId}, ${yearId}, ${date}, ${dayType})`;

    await expectAccept(tx, "a calendar day is accepted", (q) =>
      calDay(q, school.id, enrYear.id, "2030-08-15", "holiday"),
    );

    await expectReject(
      tx,
      "a SECOND day-type for the same (school, year, date) is rejected",
      "academic_calendar_school_year_date_uq",
      (q) => calDay(q, school.id, enrYear.id, "2030-08-15", "working"),
    );

    // The key includes the YEAR: the same calendar date recurs every session,
    // and 15 August of next year needs its own row.
    await expectAccept(tx, "the same DATE in the NEXT year is accepted", (q) =>
      calDay(q, school.id, nextEnrYear.id, "2030-08-15", "holiday"),
    );

    // And per-SCHOOL: the second school marks its own 15 August without
    // touching the first school's row. (Uses school2's own year, not a
    // cross-tenant year reference.)
    const [school2Year] = await tx<{ id: string }[]>`
      SELECT id FROM academic_years WHERE name = '2026-27' AND school_id = ${school2.id}
    `;
    await expectAccept(tx, "the same DATE in a DIFFERENT school is accepted", (q) =>
      calDay(q, school2.id, school2Year.id, "2030-08-15", "working"),
    );

    // --- attendance_policies: ONE per school. ---

    const policy = (q: Queryable, schoolId: string, threshold: number | null) =>
      q`INSERT INTO attendance_policies
          (organization_id, school_id, marking_mode, daily_status_rule, threshold_percentage)
        VALUES (${org.id}, ${schoolId}, 'period_wise', 'threshold_percentage', ${threshold})`;

    await expectAccept(tx, "a school's first policy is accepted", (q) =>
      q`INSERT INTO attendance_policies (organization_id, school_id)
        VALUES (${org.id}, ${school.id})`,
    );

    await expectReject(
      tx,
      "a SECOND policy for the same school is rejected",
      "attendance_policies_school_uq",
      (q) => policy(q, school.id, 75),
    );

    await expectAccept(tx, "a policy for a DIFFERENT school is accepted", (q) =>
      policy(q, school2.id, 75),
    );

    // The threshold CHECK fires on UPDATE too — school2's policy is the row
    // under test because school already has its (unique) row.
    await expectReject(
      tx,
      "threshold_percentage 0 is rejected",
      "attendance_policies_threshold_range",
      (q) =>
        q`UPDATE attendance_policies SET threshold_percentage = 0
          WHERE school_id = ${school2.id}`,
    );
    await expectReject(
      tx,
      "threshold_percentage 101 is rejected",
      "attendance_policies_threshold_range",
      (q) =>
        q`UPDATE attendance_policies SET threshold_percentage = 101
          WHERE school_id = ${school2.id}`,
    );
    await expectAccept(tx, "threshold_percentage 100 is accepted", (q) =>
      q`UPDATE attendance_policies SET threshold_percentage = 100
        WHERE school_id = ${school2.id}`,
    );

    // --- periods: unique (section, year, sequence). ---

    const period = (q: Queryable, sectionId: string, yearId: string, seq: number) =>
      q`INSERT INTO periods
          (organization_id, school_id, section_id, academic_year_id, name, sequence_number)
        VALUES (${org.id}, ${school.id}, ${sectionId}, ${yearId}, 'Period 1', ${seq})`;

    await expectAccept(tx, "a section's first period is accepted", (q) =>
      period(q, enrSection.id, enrYear.id, 1),
    );

    await expectReject(
      tx,
      "a duplicate sequence number in one section is rejected",
      "periods_section_year_sequence_uq",
      (q) => period(q, enrSection.id, enrYear.id, 1),
    );

    await expectAccept(tx, "the next sequence in the same section is accepted", (q) =>
      period(q, enrSection.id, enrYear.id, 2),
    );

    // The key is per SECTION: section B restarts at Period 1.
    const [enrSectionB] = await tx<{ id: string }[]>`
      INSERT INTO sections
        (organization_id, school_id, class_id, academic_year_id, name)
      VALUES (${org.id}, ${school.id}, ${enrClass.id}, ${enrYear.id}, 'B')
      RETURNING id
    `;
    await expectAccept(tx, "the same sequence in a DIFFERENT section is accepted", (q) =>
      period(q, enrSectionB.id, enrYear.id, 1),
    );

    console.log("\n=== Phase 3: the record layer (0008) ===");

    // The record-layer fixture: two periods of enrSection (created by the
    // periods block above), the verify user as the marker, and a mid-August
    // date inside 2030-31. No calendar row is needed — the calendar gate is
    // a SERVICE rule; the database only holds the rows the service allows.
    const [period1] = await tx<{ id: string }[]>`
      SELECT id FROM periods
      WHERE section_id = ${enrSection.id} AND sequence_number = 1
    `;
    const [period2] = await tx<{ id: string }[]>`
      SELECT id FROM periods
      WHERE section_id = ${enrSection.id} AND sequence_number = 2
    `;

    const record = (
      q: Queryable,
      date: string,
      periodId: string | null,
      status: string,
    ) =>
      q`INSERT INTO attendance_records
          (organization_id, school_id, student_id, academic_year_id, date,
           class_id, section_id, period_id, status, marked_by)
        VALUES (${org.id}, ${school.id}, ${enrStudent.id}, ${enrYear.id}, ${date},
                ${enrClass.id}, ${enrSection.id}, ${periodId}, ${status}, 'verify-user-1')`;

    // --- the daily-mode double-mark guard (hand-written, 0008) ---

    await expectAccept(tx, "a daily-mode record (NULL period) is accepted", (q) =>
      record(q, "2030-08-20", null, "present"),
    );

    // The whole point of the COALESCE sentinel: two NULL period_ids are NOT
    // distinct, so the second same-day mark is refused. A plain unique index
    // would let it through.
    await expectReject(
      tx,
      "a SECOND daily-mode record the same day is rejected",
      "attendance_records_student_day_period_uq",
      (q) => record(q, "2030-08-20", null, "absent"),
    );

    await expectAccept(tx, "another day's daily record is accepted", (q) =>
      record(q, "2030-08-21", null, "present"),
    );

    // Period-wise mode: same student, same day, DIFFERENT periods — the pair
    // the guard exists to permit.
    await expectAccept(tx, "a period-wise record is accepted", (q) =>
      record(q, "2030-08-22", period1.id, "present"),
    );
    await expectAccept(
      tx,
      "a second period the same day is accepted (period-wise pair)",
      (q) => record(q, "2030-08-22", period2.id, "present"),
    );

    await expectReject(
      tx,
      "the SAME period twice in one day is rejected",
      "attendance_records_student_day_period_uq",
      (q) => record(q, "2030-08-22", period1.id, "absent"),
    );

    // --- daily_attendance_status: one answer per student per year per day ---

    const status = (q: Queryable, date: string) =>
      q`INSERT INTO daily_attendance_status
          (organization_id, school_id, student_id, academic_year_id, date,
           class_id, section_id, status, derivation_mode)
        VALUES (${org.id}, ${school.id}, ${enrStudent.id}, ${enrYear.id}, ${date},
                ${enrClass.id}, ${enrSection.id}, 'present', 'direct')`;

    await expectAccept(tx, "a daily status row is accepted", (q) =>
      status(q, "2030-08-20"),
    );

    await expectReject(
      tx,
      "a SECOND daily status for the same (student, year, date) is rejected",
      "daily_attendance_status_student_year_date_uq",
      (q) => status(q, "2030-08-20"),
    );

    // --- attendance_summary: partial keys, shape CHECKs, generated column ---

    const summary = (
      q: Queryable,
      periodType: string,
      opts: { month?: number | null; year?: number | null; termId?: string | null } = {},
    ) =>
      q`INSERT INTO attendance_summary
          (organization_id, school_id, student_id, academic_year_id, term_id,
           period_type, month, year, working_days, days_present, days_absent,
           days_late, days_on_leave)
        VALUES (${org.id}, ${school.id}, ${enrStudent.id}, ${enrYear.id},
                ${opts.termId ?? null}, ${periodType}, ${opts.month ?? null},
                ${opts.year ?? null}, 10, 8, 1, 1, 0)`;

    // Two terms of the year exist from the terms block above; the term rows
    // are what the old single-composite-key design could not distinguish.
    const termRows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM terms WHERE academic_year_id = ${enrYear.id}
      ORDER BY sequence_number LIMIT 2
    `;

    await expectAccept(tx, "a monthly summary is accepted", (q) =>
      summary(q, "monthly", { month: 8, year: 2030 }),
    );

    await expectReject(
      tx,
      "a duplicate monthly summary is rejected",
      "attendance_summary_monthly_uq",
      (q) => summary(q, "monthly", { month: 8, year: 2030 }),
    );

    await expectAccept(tx, "a DIFFERENT month's summary is accepted", (q) =>
      summary(q, "monthly", { month: 9, year: 2030 }),
    );

    await expectReject(
      tx,
      "a monthly row with NO month is rejected (shape)",
      "attendance_summary_monthly_shape",
      (q) => summary(q, "monthly"),
    );

    await expectAccept(tx, "a first term's summary is accepted", (q) =>
      summary(q, "term", { termId: termRows[0].id }),
    );

    await expectAccept(tx, "a second term's summary is accepted", (q) =>
      summary(q, "term", { termId: termRows[1].id }),
    );

    await expectReject(
      tx,
      "a duplicate of the first term's summary is rejected",
      "attendance_summary_term_uq",
      (q) => summary(q, "term", { termId: termRows[0].id }),
    );

    await expectReject(
      tx,
      "a term row carrying a month is rejected (shape)",
      "attendance_summary_term_shape",
      (q) => summary(q, "term", { termId: termRows[0].id, month: 8 }),
    );

    await expectAccept(tx, "the annual summary is accepted", (q) =>
      summary(q, "annual"),
    );

    await expectReject(
      tx,
      "a SECOND annual summary is rejected",
      "attendance_summary_annual_uq",
      (q) => summary(q, "annual"),
    );

    // The generated column: 8 of 10 working days present = 80.00, computed
    // by the DATABASE. If this ever reads null or a wrong value, someone has
    // un-generated the column and code is expected to maintain it.
    await expectAccept(tx, "the generated percentage computes 80.00", async (q) => {
      const [row] = await q<{ attendance_percentage: string }[]>`
        SELECT attendance_percentage FROM attendance_summary
        WHERE student_id = ${enrStudent.id} AND period_type = 'monthly'
          AND month = 8
      `;
      if (row.attendance_percentage !== "80.00") {
        throw new Error(
          `generated percentage is ${row.attendance_percentage}, expected 80.00`,
        );
      }
    });

    console.log("\n=== fees: the configuration layer (0010) ===");

    // Fixtures hang off the enrollment block's class and year — a structure
    // needs a class+year, a line needs a head. All of it rolls back.
    const feeHead = (
      q: Queryable,
      name: string,
      category = "regular",
    ) =>
      q`INSERT INTO fee_heads
          (organization_id, school_id, name, category)
        VALUES (${org.id}, ${school.id}, ${name}, ${category})`;

    const feeStructure = (
      q: Queryable,
      name: string,
      classId = enrClass.id,
      mode = "term_wise",
    ) =>
      q`INSERT INTO fee_structures
          (organization_id, school_id, academic_year_id, class_id, name, installment_mode)
        VALUES (${org.id}, ${school.id}, ${enrYear.id}, ${classId}, ${name}, ${mode})`;

    const feeLine = (
      q: Queryable,
      structureId: string,
      headId: string,
      amount: string,
      fromMonth = 1,
      toMonth = 12,
    ) =>
      q`INSERT INTO fee_structure_lines
          (organization_id, school_id, fee_structure_id, fee_head_id,
           annual_amount, applicable_from_month, applicable_to_month)
        VALUES (${org.id}, ${school.id}, ${structureId}, ${headId},
                ${amount}, ${fromMonth}, ${toMonth})`;

    const lateFeeRule = (
      q: Queryable,
      value: string,
      calculation = "flat",
      effectiveFrom = "2030-04-01",
      effectiveTo: string | null = null,
    ) =>
      q`INSERT INTO late_fee_rules
          (organization_id, school_id, calculation_type, value, effective_from, effective_to)
        VALUES (${org.id}, ${school.id}, ${calculation}, ${value}, ${effectiveFrom}, ${effectiveTo})`;

    await expectAccept(tx, "a fee head is accepted", (q) => feeHead(q, "Tuition Fee"));
    await expectReject(
      tx,
      "a duplicate head name in one school is rejected",
      "fee_heads_school_name_uq",
      (q) => feeHead(q, "Tuition Fee"),
    );
    // The uniqueness is per SCHOOL, not per org — the second branch of the
    // trust may name its heads identically.
    await expectAccept(tx, "the same head name in a DIFFERENT school is accepted", (q) =>
      q`INSERT INTO fee_heads (organization_id, school_id, name, category)
        VALUES (${org.id}, ${school2.id}, 'Tuition Fee', 'regular')`,
    );

    await expectAccept(tx, "a structure is accepted", (q) => feeStructure(q, "Class 6 2030-31"));
    await expectReject(
      tx,
      "a SECOND structure for the same class+year is rejected",
      "fee_structures_class_year_uq",
      (q) => feeStructure(q, "Class 6 2030-31 duplicate"),
    );
    // The resolver reads "the structure for class C in year Y" — a second
    // school's class is a different addressable node, so its structure is free.
    await expectAccept(tx, "a structure for the same class NAME in a DIFFERENT year is accepted", (q) =>
      q`INSERT INTO fee_structures
          (organization_id, school_id, academic_year_id, class_id, name, installment_mode)
        VALUES (${org.id}, ${school.id}, ${nextEnrYear.id}, ${enrClass.id}, 'Class 6 2031-32', 'monthly')`,
    );

    const [head] = await tx<{ id: string }[]>`
      SELECT id FROM fee_heads WHERE name = 'Tuition Fee' AND school_id = ${school.id}
    `;
    const [structure] = await tx<{ id: string }[]>`
      SELECT id FROM fee_structures WHERE name = 'Class 6 2030-31' AND school_id = ${school.id}
    `;

    await expectAccept(tx, "a structure line is accepted", (q) =>
      feeLine(q, structure.id, head.id, "12000.00"),
    );
    await expectReject(
      tx,
      "a SECOND line for the same head+structure is rejected",
      "fee_structure_lines_structure_head_uq",
      (q) => feeLine(q, structure.id, head.id, "999.00"),
    );
    // Hard rule 4's boundary: zero is a legitimate annual amount (a head kept
    // in the structure at no charge); below zero never is. A fresh head, so
    // the unique pair is out of the way and the CHECK is what answers.
    await expectAccept(tx, "the zero-amount line head is accepted", (q) => feeHead(q, "Activity Fee"));
    const [activityHead] = await tx<{ id: string }[]>`
      SELECT id FROM fee_heads WHERE name = 'Activity Fee' AND school_id = ${school.id}
    `;
    await expectAccept(tx, "a ZERO annual amount is accepted", (q) =>
      feeLine(q, structure.id, activityHead.id, "0.00"),
    );

    // Lines use a fresh head each so the unique pair never muddies which
    // constraint fired.
    await expectAccept(tx, "the second line head is accepted", (q) => feeHead(q, "Lab Fee"));
    const [labHead] = await tx<{ id: string }[]>`
      SELECT id FROM fee_heads WHERE name = 'Lab Fee' AND school_id = ${school.id}
    `;
    await expectReject(
      tx,
      "a NEGATIVE annual amount is rejected",
      "fee_structure_lines_amount_non_negative",
      (q) => feeLine(q, structure.id, labHead.id, "-1.00"),
    );
    await expectReject(
      tx,
      "an out-of-range applicable month is rejected",
      "fee_structure_lines_month_range",
      (q) => feeLine(q, structure.id, labHead.id, "100.00", 1, 13),
    );
    await expectReject(
      tx,
      "an inverted applicable-month range is rejected",
      "fee_structure_lines_month_order",
      (q) => feeLine(q, structure.id, labHead.id, "100.00", 9, 4),
    );

    await expectAccept(tx, "a late-fee rule is accepted", (q) => lateFeeRule(q, "50.00"));
    await expectReject(
      tx,
      "a late-fee rule with value 0 is rejected",
      "late_fee_rules_value_positive",
      (q) => lateFeeRule(q, "0.00"),
    );
    await expectReject(
      tx,
      "a late-fee rule ending before it starts is rejected",
      "late_fee_rules_date_order",
      (q) => lateFeeRule(q, "50.00", "flat", "2030-10-01", "2030-09-01"),
    );
    // A single-day rule window is absurd but legitimate — the bound is >=, and
    // a constraint that over-reaches is its own bug (the terms precedent).
    await expectAccept(tx, "a single-day late-fee window is accepted", (q) =>
      lateFeeRule(q, "50.00", "flat", "2030-10-01", "2030-10-01"),
    );
  });

  // Asserts the rollback, not an empty database: `pnpm db:seed` legitimately
  // leaves rows here, so counting the whole table would fail spuriously on any
  // seeded environment. What must be true is that nothing THIS SCRIPT wrote
  // survived — hence keying on the slug it inserts.
  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*) FROM organizations WHERE slug = 'verify-trust'
  `;
  report("rollback left no verify-trust rows behind", count === "0", `count = ${count}`);

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
  await sql.end({ timeout: 5 });
  if (failures > 0) throw new Error(`${failures} verification check(s) failed`);
}

main().catch(async (error) => {
  console.error("\nverify-schema FAILED:\n", error);
  await sql.end({ timeout: 5 }).catch(() => {});
  throw error;
});
