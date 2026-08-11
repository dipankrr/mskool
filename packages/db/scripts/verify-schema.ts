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
        'academic_years_end_after_start'
      )
    ORDER BY con.conname
  `;
  for (const c of constraints) console.log(`  ${c.table_name}.${c.constraint_name}`);
  report("all CHECK constraints exist", constraints.length === 3, `found ${constraints.length}/3`);

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
