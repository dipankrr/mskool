/**
 * Seed — `pnpm db:seed`.
 *
 * Creates the minimum needed to sign in and exercise the authorization spine:
 * one organization (the tenant, ADR-001), TWO schools under it, and two staff
 * logins whose grants sit at different levels of the scope tree.
 *
 * WHY TWO SCHOOLS. One school proves nothing. Every interesting property of
 * `scopeWhere` is about what a caller CANNOT see, and with a single school a
 * broken tenancy filter and a correct one return exactly the same row. The
 * second school is the control.
 *
 * WHY THIS LIVES IN apps/api AND NOT packages/db (ADR-020). A seed is a
 * composition root: it needs @repo/auth to hash a password (hard rule 9),
 * @repo/services to create a school and its scope node in one transaction
 * (hard rule 12), and @repo/authz for the default permission matrix. All three
 * already depend on @repo/db, so seeding from inside @repo/db would invert the
 * type chain and put a cycle in turbo's graph.
 *
 * IDEMPOTENT. Every step is find-or-create, so re-running changes nothing.
 * Nothing here deletes (hard rule 2) — if you want a clean slate, drop the
 * database and re-migrate.
 */
import { auth } from "@repo/auth";
import { invalidateUserAuthCache, type RoleType, type ScopeType } from "@repo/authz";
import { db } from "@repo/db";
import { organizations, roleAssignments, schools, staff, user } from "@repo/db/schema";
import { organizationService } from "@repo/services";
import { and, eq, isNull } from "drizzle-orm";

// Stable identifiers. The seed finds rows by these, which is what makes
// re-running it a no-op rather than a duplicate-key error.
const ORG_SLUG = "demo-trust";
const SCHOOL_A_CODE = "MAIN";
const SCHOOL_B_CODE = "NORTH";

const ADMIN_EMAIL = "admin@demo-trust.test";
const PRINCIPAL_EMAIL = "principal@demo-trust.test";
/** Dev only. The production bootstrap is a separate, deliberate flow. */
const SEED_PASSWORD = "Password123!";

async function findOrCreateOrganization() {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG));

  if (existing) {
    console.log(`  = organization ${ORG_SLUG} (exists)`);
    return existing;
  }

  // Goes through the service, not a raw insert: createOrganization also copies
  // DEFAULT_ROLE_PERMISSIONS into org_role_permissions in the same
  // transaction. An org without that matrix has roles that grant nothing, and
  // the failure looks like a permissions bug rather than a missing seed step.
  const organization = await organizationService.createOrganization({
    name: "Demo Trust",
    legalName: "Demo Educational Trust",
    slug: ORG_SLUG,
    email: "office@demo-trust.test",
    phone: "9800000000",
    city: "Kolkata",
    state: "West Bengal",
    pincode: "700001",
  });

  console.log(`  + organization ${ORG_SLUG}`);
  return organization;
}

async function findOrCreateSchool(
  organizationId: string,
  code: string,
  name: string,
  legalName: string,
) {
  const [existing] = await db
    .select()
    .from(schools)
    .where(and(eq(schools.organizationId, organizationId), eq(schools.code, code)));

  if (existing) {
    console.log(`  = school ${code} (exists)`);
    return existing;
  }

  // Again the service, for hard rule 12: this inserts the scope_nodes row in
  // the same transaction. A school without its node is unreachable — every
  // request against it 403s, including from the admin who created it.
  const school = await organizationService.createSchool(organizationId, {
    name,
    legalName,
    code,
    board: "cbse",
    city: "Kolkata",
    state: "West Bengal",
    pincode: "700001",
  });

  console.log(`  + school ${code}`);
  return school;
}

/**
 * Creates the login through better-auth, never by inserting into `user`
 * directly (hard rule 9). better-auth owns password hashing and the matching
 * `account` row; a hand-rolled insert produces a user who cannot sign in.
 */
async function findOrCreateUser(email: string, name: string) {
  const [existing] = await db.select().from(user).where(eq(user.email, email));

  if (existing) {
    console.log(`  = user ${email} (exists)`);
    return existing;
  }

  await auth.api.signUpEmail({
    body: { name, email, password: SEED_PASSWORD },
  });

  const [created] = await db.select().from(user).where(eq(user.email, email));

  if (!created) {
    throw new Error(`better-auth reported success but no user row exists for ${email}.`);
  }

  console.log(`  + user ${email}`);
  return created;
}

async function findOrCreateStaff(
  organizationId: string,
  schoolId: string,
  userId: string,
  employeeCode: string,
  firstName: string,
  lastName: string,
  designation: string,
) {
  const [existing] = await db
    .select()
    .from(staff)
    .where(
      and(eq(staff.organizationId, organizationId), eq(staff.employeeCode, employeeCode)),
    );

  if (existing) {
    console.log(`  = staff ${employeeCode} (exists)`);
    return existing;
  }

  const [created] = await db
    .insert(staff)
    .values({
      organizationId,
      // notNull, so even an org-level admin has a primary posting.
      schoolId,
      userId,
      employeeCode,
      firstName,
      lastName,
      designation,
    })
    .returning();

  if (!created) throw new Error(`Failed to create staff ${employeeCode}.`);

  console.log(`  + staff ${employeeCode}`);
  return created;
}

/**
 * Grants a role at a scope.
 *
 * For scopeType 'org' the scopeId MUST equal the organizationId — there is a
 * CHECK constraint on this (ADR-019), because scopeCovers() resolves an
 * org grant by comparing node.organizationId against assignment.scopeId. If
 * the two diverge the grant silently never matches.
 */
async function findOrCreateAssignment(
  userId: string,
  organizationId: string,
  roleType: RoleType,
  scopeType: ScopeType,
  scopeId: string,
  grantedBy: string | null,
) {
  const [existing] = await db
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.organizationId, organizationId),
        eq(roleAssignments.roleType, roleType),
        eq(roleAssignments.scopeId, scopeId),
        isNull(roleAssignments.revokedAt),
      ),
    );

  if (existing) {
    console.log(`  = grant ${roleType} @ ${scopeType} (exists)`);
    return existing;
  }

  const [created] = await db
    .insert(roleAssignments)
    .values({ userId, organizationId, roleType, scopeType, scopeId, grantedBy })
    .returning();

  if (!created) throw new Error(`Failed to grant ${roleType}.`);

  console.log(`  + grant ${roleType} @ ${scopeType}`);
  return created;
}

async function main() {
  // The seed writes known-password logins. That must never touch production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production.");
  }

  console.log("\nSeeding…\n");

  const organization = await findOrCreateOrganization();

  const schoolA = await findOrCreateSchool(
    organization.id,
    SCHOOL_A_CODE,
    "Demo Public School — Main Campus",
    "Demo Public School, Main Campus",
  );

  const schoolB = await findOrCreateSchool(
    organization.id,
    SCHOOL_B_CODE,
    "Demo Public School — North Campus",
    "Demo Public School, North Campus",
  );

  const adminUser = await findOrCreateUser(ADMIN_EMAIL, "Demo Org Admin");
  const principalUser = await findOrCreateUser(PRINCIPAL_EMAIL, "Demo Principal");

  await findOrCreateStaff(
    organization.id,
    schoolA.id,
    adminUser.id,
    "EMP-ADMIN",
    "Asha",
    "Verma",
    "Trust Administrator",
  );

  await findOrCreateStaff(
    organization.id,
    schoolA.id,
    principalUser.id,
    "EMP-PRIN",
    "Rakesh",
    "Iyer",
    "Principal",
  );

  // Org-scoped: sees both schools. scopeId === organizationId per ADR-019.
  await findOrCreateAssignment(
    adminUser.id,
    organization.id,
    "org_admin",
    "org",
    organization.id,
    null,
  );

  // School-scoped to A ONLY. This is the negative control: if this principal
  // can see school B, the tenancy filter is broken.
  await findOrCreateAssignment(
    principalUser.id,
    organization.id,
    "principal",
    "school",
    schoolA.id,
    adminUser.id,
  );

  // A previous run may have left a cached snapshot that predates these grants.
  await invalidateUserAuthCache(adminUser.id);
  await invalidateUserAuthCache(principalUser.id);

  console.log(`
Done.

  organization   ${organization.id}
  school A       ${schoolA.id}  (${SCHOOL_A_CODE})
  school B       ${schoolB.id}  (${SCHOOL_B_CODE})

  ${ADMIN_EMAIL}      org_admin @ org      → both schools
  ${PRINCIPAL_EMAIL}  principal @ school A → school A only

  password for both: ${SEED_PASSWORD}
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
