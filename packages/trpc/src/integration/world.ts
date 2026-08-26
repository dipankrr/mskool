import { auth } from "@repo/auth";
import {
  DEFAULT_ROLE_PERMISSIONS,
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
  sections,
  studentPortalAccess,
  students,
  user,
} from "@repo/db/schema";
import { academicService, organizationService } from "@repo/services";
import { and, eq, isNull } from "drizzle-orm";

/**
 * The integration fixture — a dedicated tenancy-isolated world, built the way
 * the seed builds one and idempotent for the same reason.
 *
 * WHY A DEDICATED ORG. The dev database drifts (manual UI testing adds
 * schools and sections to the demo trust), so exact-count assertions against
 * demo rows would break for reasons that have nothing to do with the code.
 * Everything here lives under orgs whose slug starts `authz-itg-`, and every
 * query in the suite filters by those ids — a drifted row elsewhere is
 * invisible by construction, which is itself the tenancy property under test.
 *
 * WHY TWO ORGS. A second org with its own school and admin is the only way to
 * assert cross-TENANT denial (a foreign org id must be indistinguishable from
 * a nonexistent one); two schools inside one org assert the weaker cross-BRANCH case.
 *
 * IDEMPOTENT, NOTHING DELETED (hard rule 2). Every step is find-or-create on
 * a natural key; re-running changes nothing. Entities created by tests
 * (scratch year, scratch class) use names a re-run recognizes and reuses.
 */
const PASSWORD = "Integration123!";

export const ORG_A_SLUG = "authz-itg-a";
export const ORG_B_SLUG = "authz-itg-b";

const email = (persona: string) => `${persona}@authz-itg.test`;

type SchoolScope = DataScope & { schoolId: string };

async function findOrCreateOrganization(slug: string, name: string) {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug));
  if (existing) return existing;

  const organization = await organizationService.createOrganization({
    name,
    legalName: name,
    slug,
  });
  return organization;
}

/**
 * Insert-only matrix sync (mirrors the seed): createOrganization copied the
 * defaults once, but a fixture org created before a permission existed must
 * still exercise CURRENT code.
 */
async function syncDefaultPermissions(organizationId: string) {
  const rows = ROLE_TYPES.flatMap((roleType) =>
    DEFAULT_ROLE_PERMISSIONS[roleType].map((permission) => ({
      organizationId,
      roleType,
      permission,
    })),
  );
  await db.insert(orgRolePermissions).values(rows).onConflictDoNothing();
}

async function findOrCreateSchool(
  organizationId: string,
  code: string,
  name: string,
) {
  const [existing] = await db
    .select()
    .from(schools)
    .where(and(eq(schools.organizationId, organizationId), eq(schools.code, code)));
  if (existing) return existing;

  // Through the service: school + scope_nodes row in one transaction (hard rule 12).
  return organizationService.createSchool(organizationId, {
    name,
    legalName: name,
    code,
    board: "cbse",
  });
}

/** better-auth owns credentials (hard rule 9) — never insert into `user` directly. */
async function findOrCreateUser(persona: string) {
  const mail = email(persona);
  const [existing] = await db.select().from(user).where(eq(user.email, mail));
  if (existing) return existing;

  await auth.api.signUpEmail({
    body: { name: persona, email: mail, password: PASSWORD },
  });
  const [created] = await db.select().from(user).where(eq(user.email, mail));
  if (!created) throw new Error(`better-auth reported success but no row for ${mail}.`);
  return created;
}

interface GrantSpec {
  userId: string;
  organizationId: string;
  roleType: RoleType;
  scopeType: ScopeType;
  scopeId: string;
  expiresAt?: Date;
  revokedAt?: Date;
}

async function findOrCreateAssignment(spec: GrantSpec) {
  const [existing] = await db
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, spec.userId),
        eq(roleAssignments.organizationId, spec.organizationId),
        eq(roleAssignments.roleType, spec.roleType),
        eq(roleAssignments.scopeId, spec.scopeId),
        isNull(roleAssignments.revokedAt),
      ),
    );
  // A revoked grant is found by nothing above — by design (the SQL filter
  // this suite pins). Re-running recreates it, so revoked personas stay revoked.
  if (existing) return existing;

  const [created] = await db
    .insert(roleAssignments)
    .values({ ...spec })
    .returning();
  if (!created) throw new Error(`Failed to grant ${spec.roleType}.`);
  return created;
}

async function findOrCreateYear(
  scope: SchoolScope,
  input: { name: string; startDate: string; endDate: string },
) {
  const [existing] = await db
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, scope.schoolId), eq(academicYears.name, input.name)));
  if (existing) return existing;

  return academicService.createAcademicYear(scope, input);
}

async function findOrCreateClass(scope: SchoolScope, name: string, numericOrder: number) {
  const [existing] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, scope.schoolId), eq(classes.name, name)));
  if (existing) return existing;

  return academicService.createClass(scope, { name, numericOrder });
}

async function findOrCreateSection(
  scope: SchoolScope,
  academicYearId: string,
  classId: string,
  name: string,
) {
  const [existing] = await db
    .select()
    .from(sections)
    .where(
      and(
        eq(sections.classId, classId),
        eq(sections.academicYearId, academicYearId),
        eq(sections.name, name),
      ),
    );
  if (existing) return existing;

  return academicService.createSection(scope, { name, academicYearId, classId });
}

async function findOrCreateStudent(
  organizationId: string,
  schoolId: string,
  admissionNumber: string,
) {
  const [existing] = await db
    .select()
    .from(students)
    .where(eq(students.admissionNumber, admissionNumber));
  if (existing) return existing;

  const [created] = await db
    .insert(students)
    .values({
      organizationId,
      schoolId,
      admissionNumber,
      firstName: "Itg",
      lastName: admissionNumber,
      dateOfBirth: "2012-06-15",
      gender: "female",
    })
    .returning();
  if (!created) throw new Error(`Failed to create student ${admissionNumber}.`);
  return created;
}

async function findOrCreatePortalAccess(
  userId: string,
  studentId: string,
  isActive: boolean,
) {
  const [existing] = await db
    .select()
    .from(studentPortalAccess)
    .where(
      and(
        eq(studentPortalAccess.userId, userId),
        eq(studentPortalAccess.studentId, studentId),
      ),
    );
  if (existing) return existing;

  const [created] = await db
    .insert(studentPortalAccess)
    .values({ userId, studentId, isActive })
    .returning();
  if (!created) throw new Error("Failed to create portal access.");
  return created;
}

export interface IntegrationWorld {
  orgAId: string;
  orgBId: string;

  schoolA1Id: string;
  schoolA2Id: string;
  schoolB1Id: string;

  closedYearAId: string;
  currentYearAId: string;
  currentYearBId: string; // belongs to school A2

  class6Id: string;
  class7Id: string; // same branch, NO grants anywhere — the discriminator
  classA2Id: string; // foreign BRANCH parent
  classB1Id: string; // foreign ORG parent

  section6aId: string;
  section6bId: string;

  users: {
    adminA: string;
    principalA1: string;
    teacherC6: string;
    subjectS6A: string;
    dual: string;
    expiredT: string;
    revokedT: string;
    adminB: string;
    parent: string;
  };
  ownedStudentId: string;
  ungrantedStudentId: string;
}

let cached: IntegrationWorld | null = null;

export async function buildWorld(): Promise<IntegrationWorld> {
  if (cached) return cached;

  // --- Org A: the full world -------------------------------------------------
  const orgA = await findOrCreateOrganization(ORG_A_SLUG, "Authz Integration Trust A");
  await syncDefaultPermissions(orgA.id);

  const schoolA1 = await findOrCreateSchool(orgA.id, "ITG-A1", "Integration School A1");
  const schoolA2 = await findOrCreateSchool(orgA.id, "ITG-A2", "Integration School A2");

  const scopeA1: SchoolScope = {
    organizationId: orgA.id,
    schoolId: schoolA1.id,
    classId: null,
    sectionId: null,
  };
  const scopeA2: SchoolScope = {
    organizationId: orgA.id,
    schoolId: schoolA2.id,
    classId: null,
    sectionId: null,
  };

  const closedYearA = await findOrCreateYear(scopeA1, {
    name: "ITG 2024-25",
    startDate: "2024-04-01",
    endDate: "2025-03-31",
  });
  const currentYearA = await findOrCreateYear(scopeA1, {
    name: "ITG 2025-26",
    startDate: "2025-04-01",
    endDate: "2026-03-31",
  });
  if (!currentYearA.isCurrent) {
    await academicService.setCurrentAcademicYear(scopeA1, currentYearA.id);
  }
  const currentYearB = await findOrCreateYear(scopeA2, {
    name: "ITG 2025-26",
    startDate: "2025-04-01",
    endDate: "2026-03-31",
  });
  if (!currentYearB.isCurrent) {
    await academicService.setCurrentAcademicYear(scopeA2, currentYearB.id);
  }

  const class6 = await findOrCreateClass(scopeA1, "ITG Class 6", 6);
  const class7 = await findOrCreateClass(scopeA1, "ITG Class 7", 7);
  const classA2 = await findOrCreateClass(scopeA2, "ITG Class 6", 6);

  const section6a = await findOrCreateSection(scopeA1, currentYearA.id, class6.id, "A");
  const section6b = await findOrCreateSection(scopeA1, currentYearA.id, class6.id, "B");

  // --- Personas ---------------------------------------------------------------
  const adminA = await findOrCreateUser("admin-a");
  const principalA1 = await findOrCreateUser("principal-a1");
  const teacherC6 = await findOrCreateUser("teacher-c6");
  const subjectS6A = await findOrCreateUser("subject-s6a");
  const dual = await findOrCreateUser("dual");
  const expiredT = await findOrCreateUser("expired-t");
  const revokedT = await findOrCreateUser("revoked-t");

  await findOrCreateAssignment({
    userId: adminA.id, organizationId: orgA.id,
    roleType: "org_admin", scopeType: "org", scopeId: orgA.id,
  });
  await findOrCreateAssignment({
    userId: principalA1.id, organizationId: orgA.id,
    roleType: "principal", scopeType: "school", scopeId: schoolA1.id,
  });
  await findOrCreateAssignment({
    userId: teacherC6.id, organizationId: orgA.id,
    roleType: "class_teacher", scopeType: "class", scopeId: class6.id,
  });
  await findOrCreateAssignment({
    userId: subjectS6A.id, organizationId: orgA.id,
    roleType: "subject_teacher", scopeType: "section", scopeId: section6a.id,
  });
  // Dual-grant union: her principal grant carries school:read; her teacher
  // grant does not. What she can list is the union of what her QUALIFYING
  // grants reach — never the union of everything she holds.
  await findOrCreateAssignment({
    userId: dual.id, organizationId: orgA.id,
    roleType: "class_teacher", scopeType: "class", scopeId: class6.id,
  });
  await findOrCreateAssignment({
    userId: dual.id, organizationId: orgA.id,
    roleType: "principal", scopeType: "school", scopeId: schoolA2.id,
  });
  // Expiry is checked per request against the live clock (ADR-016)…
  await findOrCreateAssignment({
    userId: expiredT.id, organizationId: orgA.id,
    roleType: "class_teacher", scopeType: "class", scopeId: class6.id,
    expiresAt: new Date(Date.now() - 60_000),
  });
  // …and revocation is filtered in SQL — this row exists but must be invisible.
  await findOrCreateAssignment({
    userId: revokedT.id, organizationId: orgA.id,
    roleType: "class_teacher", scopeType: "class", scopeId: class6.id,
    revokedAt: new Date(),
  });

  // --- Org B: the cross-tenant control ---------------------------------------
  const orgB = await findOrCreateOrganization(ORG_B_SLUG, "Authz Integration Trust B");
  await syncDefaultPermissions(orgB.id);
  const schoolB1 = await findOrCreateSchool(orgB.id, "ITG-B1", "Integration School B1");
  const adminB = await findOrCreateUser("admin-b");
  await findOrCreateAssignment({
    userId: adminB.id, organizationId: orgB.id,
    roleType: "org_admin", scopeType: "org", scopeId: orgB.id,
  });
  // Org B gets its own class so a cross-ORG parent rejection can be asserted,
  // not just a cross-branch one.
  const classB1 = await findOrCreateClass(
    { organizationId: orgB.id, schoolId: schoolB1.id, classId: null, sectionId: null },
    "ITG Class 9",
    9,
  );

  // --- Student track -----------------------------------------------------------
  const parent = await findOrCreateUser("parent");
  const ownedStudent = await findOrCreateStudent(orgA.id, schoolA1.id, "ITG-0001");
  const ungrantedStudent = await findOrCreateStudent(orgA.id, schoolA1.id, "ITG-0002");
  await findOrCreatePortalAccess(parent.id, ownedStudent.id, true);
  await findOrCreatePortalAccess(parent.id, ungrantedStudent.id, false);

  cached = {
    orgAId: orgA.id,
    orgBId: orgB.id,
    schoolA1Id: schoolA1.id,
    schoolA2Id: schoolA2.id,
    schoolB1Id: schoolB1.id,
    closedYearAId: closedYearA.id,
    currentYearAId: currentYearA.id,
    currentYearBId: currentYearB.id,
    class6Id: class6.id,
    class7Id: class7.id,
    classA2Id: classA2.id,
    classB1Id: classB1.id,
    section6aId: section6a.id,
    section6bId: section6b.id,
    users: {
      adminA: adminA.id,
      principalA1: principalA1.id,
      teacherC6: teacherC6.id,
      subjectS6A: subjectS6A.id,
      dual: dual.id,
      expiredT: expiredT.id,
      revokedT: revokedT.id,
      adminB: adminB.id,
      parent: parent.id,
    },
    ownedStudentId: ownedStudent.id,
    ungrantedStudentId: ungrantedStudent.id,
  };
  return cached;
}
