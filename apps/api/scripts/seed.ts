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
import {
  DEFAULT_ROLE_PERMISSIONS,
  invalidateUserAuthCache,
  ROLE_TYPES,
  type DataScope,
  type RoleType,
  type ScopeType,
} from "@repo/authz";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  organizations,
  orgRolePermissions,
  roleAssignments,
  schools,
  staff,
  user,
} from "@repo/db/schema";
import { academicService, organizationService } from "@repo/services";
import { and, eq, isNull } from "drizzle-orm";

// Stable identifiers. The seed finds rows by these, which is what makes
// re-running it a no-op rather than a duplicate-key error.
const ORG_SLUG = "demo-trust";
const SCHOOL_A_CODE = "MAIN";
const SCHOOL_B_CODE = "NORTH";

const ADMIN_EMAIL = "admin@demo-trust.test";
const PRINCIPAL_EMAIL = "principal@demo-trust.test";
const TEACHER_EMAIL = "teacher@demo-trust.test";
/** Dev only. The production bootstrap is a separate, deliberate flow. */
const SEED_PASSWORD = "Password123!";

// Academic structure — the minimum that lets the smoke test prove the year
// tenancy filter and the read_history gate. School A gets TWO years, one
// current and one closed: with a single year a broken history gate and a
// correct one return the same row, so the closed year is the control. The
// ranges do not overlap and only one year per school is promoted to current,
// because both are EXCLUDE constraints checked per statement (ADR-013) — a
// seed that violates either aborts the run rather than warning.
const CLASS_A_NAME = "Class 6";
const CLASS_A_ORDER = 6;

const YEAR_CURRENT = {
  name: "2025-26",
  startDate: "2025-04-01",
  endDate: "2026-03-31",
} as const;
const YEAR_CLOSED = {
  name: "2024-25",
  startDate: "2024-04-01",
  endDate: "2025-03-31",
} as const;

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

/**
 * Backfill the org's permission matrix to match DEFAULT_ROLE_PERMISSIONS.
 *
 * The demo org is a FIXTURE, not a real tenant. `createOrganization` copies the
 * defaults once at creation and — per ADR-011 — never touches them again, so an
 * org seeded before a permission was added (e.g. `academic_year:read_history`,
 * ADR-024, or the class teacher's `academic_year:read`) is missing it forever.
 * That is correct for a real trust, which owns its matrix; it is wrong for a
 * test fixture that must exercise the CURRENT code — without this, the smoke
 * test's history-gate checks fail on any org first seeded before those
 * permissions existed.
 *
 * INSERT-only (onConflictDoNothing): it adds the pairs the matrix lacks and
 * never removes one, so it is a no-op on a fresh org and cannot clobber a real
 * org's deliberate edits. Mirrors the copy in
 * organization.service.createOrganization; the production invariant is untouched
 * because production orgs are never seeded.
 */
async function syncDefaultPermissions(organizationId: string) {
  const rows = ROLE_TYPES.flatMap((roleType) =>
    DEFAULT_ROLE_PERMISSIONS[roleType].map((permission) => ({
      organizationId,
      roleType,
      permission,
    })),
  );

  const inserted = await db
    .insert(orgRolePermissions)
    .values(rows)
    .onConflictDoNothing()
    .returning();

  console.log(
    inserted.length > 0
      ? `  + backfilled ${inserted.length} permission(s) to match defaults`
      : `  = permission matrix already current`,
  );
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

/**
 * Find-or-create an academic year through the service, so it is written exactly
 * the way the API writes it (frozen originalEndDate, no isCurrent). Keyed on
 * (schoolId, name) — the table's unique index — so re-running finds rather than
 * duplicates. A new year is never current; the caller promotes one below.
 *
 * The scope carries a school (schoolId: string, not the nullable DataScope
 * form) because a year always belongs to one branch.
 */
async function findOrCreateAcademicYear(
  scope: DataScope & { schoolId: string },
  input: { name: string; startDate: string; endDate: string },
) {
  const [existing] = await db
    .select()
    .from(academicYears)
    .where(
      and(
        eq(academicYears.schoolId, scope.schoolId),
        eq(academicYears.name, input.name),
      ),
    );

  if (existing) {
    console.log(`  = academic year ${input.name} (exists)`);
    return existing;
  }

  const academicYear = await academicService.createAcademicYear(scope, input);
  console.log(`  + academic year ${input.name}`);
  return academicYear;
}

/**
 * Find-or-create a class through the service, which inserts its scope_nodes row
 * in the same transaction (hard rule 12). Without that node the class is
 * unreachable and every request against it — including the class teacher's
 * below — 403s. Keyed on (schoolId, name).
 */
async function findOrCreateClass(
  scope: DataScope & { schoolId: string },
  name: string,
  numericOrder: number,
) {
  const [existing] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, scope.schoolId), eq(classes.name, name)));

  if (existing) {
    console.log(`  = class ${name} (exists)`);
    return existing;
  }

  const cls = await academicService.createClass(scope, { name, numericOrder });
  console.log(`  + class ${name}`);
  return cls;
}

async function main() {
  // The seed writes known-password logins. That must never touch production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production.");
  }

  console.log("\nSeeding…\n");

  const organization = await findOrCreateOrganization();

  // Keep the fixture's permission matrix current before anything relies on it
  // (the class teacher's read / the principal's read_history below).
  await syncDefaultPermissions(organization.id);

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

  // --- Academic structure + a third login for the year-visibility tests -----
  //
  // The smoke test needs two things this seed did not previously provide: a
  // school-B year, to prove a school-A grant cannot see it; and a caller who
  // holds academic_year:read but NOT read_history, to prove the history gate.
  // Only class_teacher and subject_teacher lack read_history by default
  // (defaultPermissions.ts), so neither the org_admin nor the principal above
  // can demonstrate it — hence a class teacher.
  //
  // scopeA / scopeB are left unannotated so their schoolId stays `string`
  // (not the nullable DataScope form), which is what the helpers require.
  const scopeA = {
    organizationId: organization.id,
    schoolId: schoolA.id,
    classId: null,
    sectionId: null,
  };
  const scopeB = {
    organizationId: organization.id,
    schoolId: schoolB.id,
    classId: null,
    sectionId: null,
  };

  // School A: a closed year and the current one. Neither is current on creation;
  // only 2025-26 is promoted, so the one-current-per-school constraint is never
  // contended. Guarding setCurrent on isCurrent keeps a re-run a true no-op.
  const closedYearA = await findOrCreateAcademicYear(scopeA, YEAR_CLOSED);
  const currentYearA = await findOrCreateAcademicYear(scopeA, YEAR_CURRENT);
  if (!currentYearA.isCurrent) {
    await academicService.setCurrentAcademicYear(scopeA, currentYearA.id);
  }

  // School B: one current year — the negative control for the tenancy test.
  const yearB = await findOrCreateAcademicYear(scopeB, YEAR_CURRENT);
  if (!yearB.isCurrent) {
    await academicService.setCurrentAcademicYear(scopeB, yearB.id);
  }

  // One class in school A to scope the class teacher to.
  const classA = await findOrCreateClass(scopeA, CLASS_A_NAME, CLASS_A_ORDER);

  const teacherUser = await findOrCreateUser(TEACHER_EMAIL, "Demo Class Teacher");

  await findOrCreateStaff(
    organization.id,
    schoolA.id,
    teacherUser.id,
    "EMP-TEACH",
    "Meera",
    "Nair",
    "Class Teacher",
  );

  // class_teacher scoped to the class NODE (scopeId === class id). This role
  // holds academic_year:read but not read_history — exactly the caller the
  // history-gate assertion needs.
  await findOrCreateAssignment(
    teacherUser.id,
    organization.id,
    "class_teacher",
    "class",
    classA.id,
    adminUser.id,
  );

  // A previous run may have left a cached snapshot that predates these grants.
  await invalidateUserAuthCache(adminUser.id);
  await invalidateUserAuthCache(principalUser.id);
  await invalidateUserAuthCache(teacherUser.id);

  console.log(`
Done.

  organization   ${organization.id}
  school A       ${schoolA.id}  (${SCHOOL_A_CODE})
  school B       ${schoolB.id}  (${SCHOOL_B_CODE})

  school A years ${currentYearA.name} (current), ${closedYearA.name} (closed)
  school B year  ${yearB.name} (current)
  class          ${classA.name}  (${classA.id})

  ${ADMIN_EMAIL}      org_admin @ org         → both schools
  ${PRINCIPAL_EMAIL}  principal @ school A    → school A only
  ${TEACHER_EMAIL}    class_teacher @ Class 6 → no read_history

  password for all: ${SEED_PASSWORD}
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
