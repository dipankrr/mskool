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
  classSubjectMappings,
  classes,
  organizations,
  orgRolePermissions,
  roleAssignments,
  schools,
  sections,
  sectionTeacherAssignments,
  studentPortalAccess,
  students,
  subjects,
  user,
} from "@repo/db/schema";
import {
  academicService,
  assignmentService,
  organizationService,
  subjectService,
} from "@repo/services";
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

async function findOrCreateSubject(scope: SchoolScope, name: string, code: string) {
  const [existing] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.schoolId, scope.schoolId), eq(subjects.name, name)));
  if (existing) return existing;

  return subjectService.createSubject(scope, { name, code });
}

async function findOrCreateClassSubjectMapping(
  scope: SchoolScope,
  input: {
    academicYearId: string;
    classId: string;
    subjectId: string;
    isElective?: boolean;
    sequenceNumber?: number;
  },
) {
  const [existing] = await db
    .select()
    .from(classSubjectMappings)
    .where(
      and(
        eq(classSubjectMappings.academicYearId, input.academicYearId),
        eq(classSubjectMappings.classId, input.classId),
        eq(classSubjectMappings.subjectId, input.subjectId),
      ),
    );
  if (existing) return existing;

  return assignmentService.createClassSubjectMapping(scope, input);
}

/**
 * Keyed on the OPEN row's natural key (section, user, role, subject). Ending an
 * assignment closes the row, so a re-run finds no open one and creates it —
 * the same philosophy as the revoked grant above: the fixture guarantees the
 * state the assertions need, and history accumulates rather than being deleted.
 */
async function findOrCreateSectionTeacherAssignment(
  scope: SchoolScope,
  input: {
    sectionId: string;
    academicYearId: string;
    userId: string;
    role: "class_teacher" | "subject_teacher" | "co_teacher" | "activity_teacher";
    subjectId?: string | null;
  },
) {
  const [existing] = await db
    .select()
    .from(sectionTeacherAssignments)
    .where(
      and(
        eq(sectionTeacherAssignments.sectionId, input.sectionId),
        eq(sectionTeacherAssignments.userId, input.userId),
        eq(sectionTeacherAssignments.role, input.role),
        isNull(sectionTeacherAssignments.effectiveTo),
        input.subjectId
          ? eq(sectionTeacherAssignments.subjectId, input.subjectId)
          : isNull(sectionTeacherAssignments.subjectId),
      ),
    );
  if (existing) return existing;

  return assignmentService.createSectionTeacherAssignment(scope, input);
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

  subjectA1MathId: string;
  subjectA1PhysicsId: string;
  subjectA2MathId: string; // same name, sibling branch — the per-school unique index
  subjectB1MathId: string; // same name, foreign org — the cross-tenant control

  yearB1Id: string;
  sectionB1Id: string;

  mappingA1MathId: string;
  mappingA1PhysicsId: string;
  mappingA2MathId: string; // sibling branch — never in an A1 list
  mappingB1MathId: string; // foreign org — the byId control

  staMath6aId: string;
  staHomeroom6aId: string;
  /** Closed by the end test; the fixture re-opens it on the next run. */
  staScratch6bId: string;
  staB1Id: string;

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

  // --- Subjects: the catalogue, school-level (not scope nodes) -----------------
  // "ITG Mathematics" is created THREE times — once per school — deliberately:
  // the unique index is per school, so the same name is legal everywhere, and
  // the scope filter is the only thing keeping a foreign row out of a list.
  // That collision is the leak the subject assertions pin.
  const subjectMathA1 = await findOrCreateSubject(scopeA1, "ITG Mathematics", "MAT");
  const subjectPhysicsA1 = await findOrCreateSubject(scopeA1, "ITG Physics", "PHY");
  const subjectMathA2 = await findOrCreateSubject(scopeA2, "ITG Mathematics", "MAT");
  const subjectMathB1 = await findOrCreateSubject(
    { organizationId: orgB.id, schoolId: schoolB1.id, classId: null, sectionId: null },
    "ITG Mathematics",
    "MAT",
  );

  // --- The teaching-assignment layer ------------------------------------------
  // Mappings are the template (which subjects a class takes); assignments are
  // the staffing facts (who teaches what where). Org B gets the same skeleton
  // minus staff, because a cross-tenant denial is only interesting when the
  // foreign row EXISTS — a refusal against nothing proves nothing.
  const scopeB1: SchoolScope = {
    organizationId: orgB.id,
    schoolId: schoolB1.id,
    classId: null,
    sectionId: null,
  };
  const yearB1 = await findOrCreateYear(scopeB1, {
    name: "ITG 2025-26",
    startDate: "2025-04-01",
    endDate: "2026-03-31",
  });
  const sectionB1 = await findOrCreateSection(scopeB1, yearB1.id, classB1.id, "A");
  // A staffing fact needs a user, not a grant — B1's teacher never signs in.
  const teacherB1 = await findOrCreateUser("teacher-b1");

  const mappingMathA1 = await findOrCreateClassSubjectMapping(scopeA1, {
    academicYearId: currentYearA.id,
    classId: class6.id,
    subjectId: subjectMathA1.id,
    sequenceNumber: 1,
  });
  const mappingPhysicsA1 = await findOrCreateClassSubjectMapping(scopeA1, {
    academicYearId: currentYearA.id,
    classId: class6.id,
    subjectId: subjectPhysicsA1.id,
    sequenceNumber: 2,
  });
  const mappingMathA2 = await findOrCreateClassSubjectMapping(scopeA2, {
    academicYearId: currentYearB.id,
    classId: classA2.id,
    subjectId: subjectMathA2.id,
    sequenceNumber: 1,
  });
  const mappingMathB1 = await findOrCreateClassSubjectMapping(scopeB1, {
    academicYearId: yearB1.id,
    classId: classB1.id,
    subjectId: subjectMathB1.id,
    sequenceNumber: 1,
  });

  // Her subject fact and the homeroom fact on the same section — the exact
  // "who teaches 6-A now" answer is TWO rows of different roles.
  const staMath6a = await findOrCreateSectionTeacherAssignment(scopeA1, {
    sectionId: section6a.id,
    academicYearId: currentYearA.id,
    userId: subjectS6A.id,
    role: "subject_teacher",
    subjectId: subjectMathA1.id,
  });
  const staHomeroom6a = await findOrCreateSectionTeacherAssignment(scopeA1, {
    sectionId: section6a.id,
    academicYearId: currentYearA.id,
    userId: teacherC6.id,
    role: "class_teacher",
  });
  // The end-test's scratch row. The test closes it and the fixture re-opens it
  // on the next run, so the end assertions always have an open row to close.
  const staScratch6b = await findOrCreateSectionTeacherAssignment(scopeA1, {
    sectionId: section6b.id,
    academicYearId: currentYearA.id,
    userId: subjectS6A.id,
    role: "subject_teacher",
    subjectId: subjectPhysicsA1.id,
  });
  const staB1 = await findOrCreateSectionTeacherAssignment(scopeB1, {
    sectionId: sectionB1.id,
    academicYearId: yearB1.id,
    userId: teacherB1.id,
    role: "subject_teacher",
    subjectId: subjectMathB1.id,
  });

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
    subjectA1MathId: subjectMathA1.id,
    subjectA1PhysicsId: subjectPhysicsA1.id,
    subjectA2MathId: subjectMathA2.id,
    subjectB1MathId: subjectMathB1.id,
    yearB1Id: yearB1.id,
    sectionB1Id: sectionB1.id,
    mappingA1MathId: mappingMathA1.id,
    mappingA1PhysicsId: mappingPhysicsA1.id,
    mappingA2MathId: mappingMathA2.id,
    mappingB1MathId: mappingMathB1.id,
    staMath6aId: staMath6a.id,
    staHomeroom6aId: staHomeroom6a.id,
    staScratch6bId: staScratch6b.id,
    staB1Id: staB1.id,
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
