/**
 * Seed script — `pnpm db:seed`.
 *
 * Phase 1 will seed: a demo organization (the tenant — ADR-001), one or two
 * schools under it, the default org_role_permissions rows, and a staff user
 * with an org-scoped role assignment.
 *
 * Note for whoever writes it: every school/class/section inserted here MUST
 * also insert its scope_nodes row in the same transaction (hard rule 12),
 * or nothing seeded will be reachable through authorization.
 */
async function main() {
  console.log("Nothing to seed yet — see docs/TASKS.md Phase 1.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
