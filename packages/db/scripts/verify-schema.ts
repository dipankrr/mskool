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
        'scope_nodes_shape_matches_type'
      )
    ORDER BY con.conname
  `;
  for (const c of constraints) console.log(`  ${c.table_name}.${c.constraint_name}`);
  report("both CHECK constraints exist", constraints.length === 2, `found ${constraints.length}/2`);

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
  });

  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*) FROM organizations`;
  report("rollback left no organizations behind", count === "0", `count = ${count}`);

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
  await sql.end({ timeout: 5 });
  if (failures > 0) throw new Error(`${failures} verification check(s) failed`);
}

main().catch(async (error) => {
  console.error("\nverify-schema FAILED:\n", error);
  await sql.end({ timeout: 5 }).catch(() => {});
  throw error;
});
