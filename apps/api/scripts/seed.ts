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
  classSubjectMappings,
  classes,
  organizations,
  orgRolePermissions,
  roleAssignments,
  schools,
  sections,
  sectionTeacherAssignments,
  staff,
  studentEnrollments,
  studentPortalAccess,
  students,
  subjects,
  terms,
  user,
} from "@repo/db/schema";
import {
  academicService,
  assignmentService,
  attendanceService,
  enrollmentService,
  studentService,
  organizationService,
  subjectService,
  termService,
} from "@repo/services";
import { and, eq, isNull } from "drizzle-orm";

// Stable identifiers. The seed finds rows by these, which is what makes
// re-running it a no-op rather than a duplicate-key error.
const ORG_SLUG = "demo-trust";
const SCHOOL_A_CODE = "MAIN";
const SCHOOL_B_CODE = "NORTH";

const ADMIN_EMAIL = "admin@demo-trust.test";
const PRINCIPAL_EMAIL = "principal@demo-trust.test";
const TEACHER_EMAIL = "teacher@demo-trust.test";
const SUBJECT_TEACHER_EMAIL = "subject-teacher@demo-trust.test";
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
/**
 * A second class in school A that NOBODY is scoped to. It is the sibling the
 * B7 verification needs: a class-scoped teacher asking for it by id must get
 * NOT_FOUND (her grant does not reach it), while an org- or school-scoped
 * caller reads it fine — proof that overlap reads discriminate between rows,
 * not just between roles.
 */
const CLASS_SIBLING_NAME = "Class 7";
const CLASS_SIBLING_ORDER = 7;
/** The one section under Class 6, scoped to the subject teacher below. */
const SECTION_A_NAME = "A";

// School A's catalogue: two subjects. School B gets "Mathematics" too — the
// SAME NAME, deliberately: the unique index is per school, so a broken
// tenancy filter cannot be saved by a name-based filter, and the smoke's
// negative assertions are the only thing that notices the leak.
const SUBJECT_MATH_NAME = "Mathematics";
const SUBJECT_MATH_CODE = "MAT";
const SUBJECT_PHYSICS_NAME = "Physics";
const SUBJECT_PHYSICS_CODE = "PHY";

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

/**
 * School B's mirror of Class 6. The SAME NAME, deliberately, like the
 * subjects: classes are unique per school, so a broken tenancy filter cannot
 * be saved by a name-based filter, and the smoke's cross-branch create
 * attempts name this row and must be refused.
 */
const CLASS_B_NAME = "Class 6";
const CLASS_B_ORDER = 6;

// Terms: the current year is split (Term 1 + Term 2), the closed year and
// school B run one "Full Year" row. The closed year's term is the smoke's
// non-vacuity control — the principal's history-gated list must return a real
// row, so a teacher's empty answer is the gate biting, not an empty table.
const TERM_1_NAME = "Term 1";
const TERM_2_NAME = "Term 2";
const TERM_FULL_NAME = "Full Year";

// Students + the parent portal. Two Class 6 students — one sectioned (the
// subject teacher's roster), one admitted with no section yet (the admitted
// state, live) — and school B's own student for the cross-branch byId denial.
// The parent login owns BOTH portal-access rows but one is inactive: the
// portal list must return exactly one child's enrollments.
const STUDENT_1_ADMISSION = "DEMO-0001";
const STUDENT_2_ADMISSION = "DEMO-0002";
const STUDENT_B_ADMISSION = "DEMO-B-0001";
const PARENT_EMAIL = "parent@demo-trust.test";

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

/**
 * Find-or-create a section through the service, which verifies both parents and
 * inserts the section's scope_nodes row in the same transaction (hard rule 12).
 * The seed had NO sections at all before this — a section-scoped persona could
 * not exist, and neither could a test of what one may and may not reach. Keyed
 * on (classId, academicYearId, name).
 */
async function findOrCreateSection(
  scope: DataScope & { schoolId: string },
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

  if (existing) {
    console.log(`  = section ${name} (exists)`);
    return existing;
  }

  const section = await academicService.createSection(scope, {
    name,
    academicYearId,
    classId,
  });
  console.log(`  + section ${name}`);
  return section;
}

async function findOrCreateSubject(
  scope: DataScope & { schoolId: string },
  name: string,
  code: string,
) {
  const [existing] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.schoolId, scope.schoolId), eq(subjects.name, name)));
  if (existing) {
    console.log(`  = subject ${name} (exists)`);
    return existing;
  }

  const subject = await subjectService.createSubject(scope, { name, code });
  console.log(`  + subject ${name}`);
  return subject;
}

/**
 * Find-or-create the mapping row (which subjects a class takes this session),
 * keyed on (year, class, subject) — the unique index's own triple. Through the
 * service, which re-reads all three parents through the caller's scope inside
 * the transaction; a seed that could link cross-branch rows would seed the
 * exact hole the tests look for.
 */
async function findOrCreateClassSubjectMapping(
  scope: DataScope & { schoolId: string },
  academicYearId: string,
  classId: string,
  subjectId: string,
  sequenceNumber: number,
) {
  const [existing] = await db
    .select()
    .from(classSubjectMappings)
    .where(
      and(
        eq(classSubjectMappings.academicYearId, academicYearId),
        eq(classSubjectMappings.classId, classId),
        eq(classSubjectMappings.subjectId, subjectId),
      ),
    );
  if (existing) {
    console.log("  = class-subject mapping (exists)");
    return existing;
  }

  const mapping = await assignmentService.createClassSubjectMapping(scope, {
    academicYearId,
    classId,
    subjectId,
    sequenceNumber,
  });
  console.log("  + class-subject mapping");
  return mapping;
}

/**
 * Find-or-create the staffing fact (who teaches what where), keyed on the OPEN
 * row's natural key (section, user, role, subject). Nothing here ends rows —
 * ending is append-on-change owned by the service, and a seed has no reason
 * to close what it just opened.
 */
async function findOrCreateSectionTeacherAssignment(
  scope: DataScope & { schoolId: string },
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
  if (existing) {
    console.log(`  = ${input.role} assignment (exists)`);
    return existing;
  }

  const assignment = await assignmentService.createSectionTeacherAssignment(
    scope,
    input,
  );
  console.log(`  + ${input.role} assignment`);
  return assignment;
}

/**
 * Find-or-create a term keyed on (year, sequenceNumber) — the unique index's
 * own pair. Through the service, which re-reads the parent year inside the
 * transaction; every date below sits inside its year by construction, because
 * a fixture that tripped `terms_dates_within_year_trg` aborts the run.
 */
async function findOrCreateTerm(
  scope: DataScope & { schoolId: string },
  input: {
    academicYearId: string;
    name: string;
    sequenceNumber: number;
    startDate: string;
    endDate: string;
  },
) {
  const [existing] = await db
    .select()
    .from(terms)
    .where(
      and(
        eq(terms.academicYearId, input.academicYearId),
        eq(terms.sequenceNumber, input.sequenceNumber),
      ),
    );
  if (existing) {
    console.log(`  = term ${input.name} (exists)`);
    return existing;
  }

  const term = await termService.createTerm(scope, input);
  console.log(`  + term ${input.name}`);
  return term;
}

/**
 * Students have no service yet (the enrollment slice seeds the anchor; the
 * student CRUD surface arrives with the admission flow) — the seed inserts
 * directly, keyed on the admission number. better-auth is NOT involved:
 * students are not logins (ADR-008).
 */
async function findOrCreateStudent(
  organizationId: string,
  schoolId: string,
  admissionNumber: string,
  firstName: string,
  lastName: string,
) {
  const [existing] = await db
    .select()
    .from(students)
    .where(eq(students.admissionNumber, admissionNumber));
  if (existing) {
    console.log(`  = student ${admissionNumber} (exists)`);
    return existing;
  }

  // Through the service, like every other seeded write — hard rule 1's
  // filter comes from the scope, and a duplicate admission number is the
  // index's refusal, not the seed's.
  const created = await studentService.createStudent(
    { organizationId, schoolId, classId: null, sectionId: null },
    {
      admissionNumber,
      firstName,
      lastName,
      dateOfBirth: "2012-06-15",
      gender: "female",
    },
  );
  console.log(`  + student ${admissionNumber} (${firstName} ${lastName})`);
  return created;
}

async function findOrCreateEnrollment(
  scope: DataScope & { schoolId: string },
  input: {
    studentId: string;
    academicYearId: string;
    classId: string;
    sectionId?: string;
  },
) {
  const [existing] = await db
    .select()
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.studentId, input.studentId),
        eq(studentEnrollments.academicYearId, input.academicYearId),
      ),
    );
  if (existing) {
    console.log("  = enrollment (exists)");
    return existing;
  }

  const enrollment = await enrollmentService.createEnrollment(scope, input);
  console.log(`  + enrollment (${input.sectionId ? "sectioned" : "admitted"})`);
  return enrollment;
}

/**
 * The parent portal's ownership rows (ADR-008). One active, one inactive —
 * the portal list must return exactly the ACTIVE child's enrollments, which
 * is the smoke's ownership pin.
 */
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
  if (existing) {
    console.log(`  = portal access (${isActive ? "active" : "inactive"}) (exists)`);
    return existing;
  }

  const [created] = await db
    .insert(studentPortalAccess)
    .values({ userId, studentId, isActive })
    .returning();
  if (!created) throw new Error("Failed to create portal access.");
  console.log(`  + portal access (${isActive ? "active" : "inactive"})`);
  return created;
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

  // Its sibling: same branch, no grants anywhere. B7's discriminator.
  const classSibling = await findOrCreateClass(
    scopeA,
    CLASS_SIBLING_NAME,
    CLASS_SIBLING_ORDER,
  );

  // School A's catalogue: two subjects. No scope_nodes rows — subjects are not
  // in the authorization tree; their tenancy is the org+school columns filtered
  // by scopeWhere like every academic table.
  const subjectMathA = await findOrCreateSubject(
    scopeA,
    SUBJECT_MATH_NAME,
    SUBJECT_MATH_CODE,
  );
  const subjectPhysicsA = await findOrCreateSubject(
    scopeA,
    SUBJECT_PHYSICS_NAME,
    SUBJECT_PHYSICS_CODE,
  );

  // School B's catalogue: the SAME "Mathematics" name. Identical names across
  // branches are exactly why the smoke asserts by ID, not by name — a broken
  // filter cannot hide behind the string differing.
  const subjectMathB = await findOrCreateSubject(
    scopeB,
    SUBJECT_MATH_NAME,
    SUBJECT_MATH_CODE,
  );

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

  // --- A fourth login: a SECTION-scoped subject_teacher ----------------------
  //
  // The modal user of the real product, and until now unseedable — there was
  // not one section row in the database. Her grant sits one level deeper than
  // the class teacher's, which is what makes the permissive-read question
  // (B7) concrete: she may list Class 6, whose sections include hers, yet no
  // strict single-row endpoint can be addressed by her grant today.
  const sectionA = await findOrCreateSection(
    scopeA,
    currentYearA.id,
    classA.id,
    SECTION_A_NAME,
  );

  const subjectTeacherUser = await findOrCreateUser(
    SUBJECT_TEACHER_EMAIL,
    "Demo Subject Teacher",
  );

  await findOrCreateStaff(
    organization.id,
    schoolA.id,
    subjectTeacherUser.id,
    "EMP-SUBJECT",
    "Priya",
    "Chatterjee",
    "Subject Teacher",
  );

  // subject_teacher scoped to the section NODE (scopeId === section id) — the
  // same shape as the class_teacher grant above, one rung down the tree.
  await findOrCreateAssignment(
    subjectTeacherUser.id,
    organization.id,
    "subject_teacher",
    "section",
    sectionA.id,
    adminUser.id,
  );

  // --- The REST of the role matrix --------------------------------------------
  //
  // Four roles the default matrix defines but the smoke never exercised — a
  // wrong default for one of them would have been invisible. Granted at each
  // role's DEFAULT_SCOPE_LEVEL; their cells pin the matrix AS WRITTEN.
  const VICE_PRINCIPAL_EMAIL = "vice-principal@demo-trust.test";
  const ACCOUNTANT_EMAIL = "accountant@demo-trust.test";
  const LIBRARIAN_EMAIL = "librarian@demo-trust.test";
  const STAFF_COORDINATOR_EMAIL = "staff-coordinator@demo-trust.test";

  const extendedPersonas: Array<{
    email: string;
    name: string;
    roleType: RoleType;
    scopeType: ScopeType;
    scopeId: string;
  }> = [
    { email: VICE_PRINCIPAL_EMAIL, name: "Demo Vice Principal", roleType: "vice_principal", scopeType: "school", scopeId: schoolA.id },
    { email: ACCOUNTANT_EMAIL, name: "Demo Accountant", roleType: "accountant", scopeType: "school", scopeId: schoolA.id },
    { email: LIBRARIAN_EMAIL, name: "Demo Librarian", roleType: "librarian", scopeType: "school", scopeId: schoolA.id },
    { email: STAFF_COORDINATOR_EMAIL, name: "Demo Staff Coordinator", roleType: "staff_coordinator", scopeType: "org", scopeId: organization.id },
  ];

  for (const persona of extendedPersonas) {
    const personaUser = await findOrCreateUser(persona.email, persona.name);
    await findOrCreateAssignment(
      personaUser.id,
      organization.id,
      persona.roleType,
      persona.scopeType,
      persona.scopeId,
      adminUser.id,
    );
    await invalidateUserAuthCache(personaUser.id);
  }

  // --- The teaching-assignment layer -----------------------------------------
  //
  // Mappings say which subjects Class 6 takes this session; assignment rows
  // say who actually teaches them. The subject_teacher login has been scoped
  // to 6-A with no assignment to her name until now — the smoke's staffing
  // assertions need the fact rows to exist, and "who teaches 6-A" is two rows
  // of different roles, which is what makes exactness meaningful.
  const mappingMathA = await findOrCreateClassSubjectMapping(
    scopeA,
    currentYearA.id,
    classA.id,
    subjectMathA.id,
    1,
  );
  const mappingPhysicsA = await findOrCreateClassSubjectMapping(
    scopeA,
    currentYearA.id,
    classA.id,
    subjectPhysicsA.id,
    2,
  );

  const staSubjectTeacher = await findOrCreateSectionTeacherAssignment(scopeA, {
    sectionId: sectionA.id,
    academicYearId: currentYearA.id,
    userId: subjectTeacherUser.id,
    role: "subject_teacher",
    subjectId: subjectMathA.id,
  });
  const staHomeroom = await findOrCreateSectionTeacherAssignment(scopeA, {
    sectionId: sectionA.id,
    academicYearId: currentYearA.id,
    userId: teacherUser.id,
    role: "class_teacher",
  });

  // School B's mirror: same-named class, its own section, its own mapping —
  // but NO staff. The smoke's cross-branch create attempts name these rows and
  // must be refused; a control row that exists is what makes the refusal mean
  // something.
  const classB = await findOrCreateClass(scopeB, CLASS_B_NAME, CLASS_B_ORDER);
  const sectionB = await findOrCreateSection(scopeB, yearB.id, classB.id, SECTION_A_NAME);
  const mappingMathB = await findOrCreateClassSubjectMapping(
    scopeB,
    yearB.id,
    classB.id,
    subjectMathB.id,
    1,
  );

  // --- Terms -------------------------------------------------------------------
  // The smoke's term assertions need a split year, a closed year with a term
  // (the non-vacuity control for the read_history gate), and a foreign-org
  // same-named row for the byId denial.
  const term1A = await findOrCreateTerm(scopeA, {
    academicYearId: currentYearA.id,
    name: TERM_1_NAME,
    sequenceNumber: 1,
    startDate: "2025-04-01",
    endDate: "2025-09-30",
  });
  const term2A = await findOrCreateTerm(scopeA, {
    academicYearId: currentYearA.id,
    name: TERM_2_NAME,
    sequenceNumber: 2,
    startDate: "2025-10-01",
    endDate: "2026-03-31",
  });
  const termFullClosedA = await findOrCreateTerm(scopeA, {
    academicYearId: closedYearA.id,
    name: TERM_FULL_NAME,
    sequenceNumber: 1,
    startDate: "2024-04-01",
    endDate: "2025-03-31",
  });
  const termFullB = await findOrCreateTerm(scopeB, {
    academicYearId: yearB.id,
    name: TERM_FULL_NAME,
    sequenceNumber: 1,
    startDate: "2025-04-01",
    endDate: "2026-03-31",
  });

  // --- Students + enrollments + the parent portal ------------------------------
  //
  // The smoke's enrollment assertions and the FIRST live portal test. Two
  // Class 6 students (one sectioned, one admitted), school B's own student,
  // and a parent whose ownership list covers both children with one row
  // deliberately inactive.
  const student1 = await findOrCreateStudent(
    organization.id,
    schoolA.id,
    STUDENT_1_ADMISSION,
    "Aditi",
    "Sharma",
  );
  const student2 = await findOrCreateStudent(
    organization.id,
    schoolA.id,
    STUDENT_2_ADMISSION,
    "Rohan",
    "Verma",
  );
  const studentB = await findOrCreateStudent(
    organization.id,
    schoolB.id,
    STUDENT_B_ADMISSION,
    "Zoya",
    "Khan",
  );

  const enrollment1 = await findOrCreateEnrollment(scopeA, {
    studentId: student1.id,
    academicYearId: currentYearA.id,
    classId: classA.id,
    sectionId: sectionA.id,
  });
  const enrollment2 = await findOrCreateEnrollment(scopeA, {
    studentId: student2.id,
    academicYearId: currentYearA.id,
    classId: classA.id,
  });
  await findOrCreateEnrollment(scopeB, {
    studentId: studentB.id,
    academicYearId: yearB.id,
    classId: classB.id,
    sectionId: sectionB.id,
  });

  const parentUser = await findOrCreateUser(PARENT_EMAIL, "Demo Parent");
  await findOrCreatePortalAccess(parentUser.id, student1.id, true);
  await findOrCreatePortalAccess(parentUser.id, student2.id, false);

  // Fixture-ONLY grant, mirroring the integration world: the demo org's
  // subject teacher exercises the enrollment read in the smoke's roster
  // cell. Owner policy decides separately whether the default matrix should
  // carry it.
  await db
    .insert(orgRolePermissions)
    .values({
      organizationId: organization.id,
      roleType: "subject_teacher",
      permission: "enrollment:read",
    })
    .onConflictDoNothing();

  // --- Attendance: the marking policy and the year's calendar ------------------
  //
  // The demo school marks DAILY (the default matrix's shape), and its current
  // year's calendar is generated Mon-Fri with TWO holidays — 15 August and
  // 2 October — which is what makes the smoke's holiday-refusal cell a live
  // refusal rather than an accidental one (an ungenerated calendar would
  // refuse EVERYTHING, proving nothing about the day-type gate).
  //
  // Idempotent by construction: the policy upsert writes the same values
  // every run; the generator fills missing dates only (onConflictDoNothing);
  // the holiday upserts write the same day types every run.
  const policyA = await attendanceService.upsertPolicy(
    scopeA,
    {
      markingMode: "daily",
      dailyStatusRule: "homeroom_authoritative",
      thresholdPercentage: null,
      lateArrivalMinutes: 15,
    },
    adminUser.id,
  );
  const generated = await attendanceService.generateYearCalendar(
    scopeA,
    // Mon–Fri working, Saturday a half day — exercises the generator's
    // half-day weekday path in the seeded demo data (many Indian schools
    // run this shape), so the calendar screen shows a mixed month.
    {
      academicYearId: currentYearA.id,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      halfDayWeekdays: [6],
    },
    adminUser.id,
  );
  const holidays: { date: string; reason: string }[] = [
    { date: "2025-08-15", reason: "Independence Day" },
    { date: "2025-10-02", reason: "Gandhi Jayanti" },
  ];
  for (const holiday of holidays) {
    await attendanceService.upsertCalendarDay(
      scopeA,
      {
        academicYearId: currentYearA.id,
        date: holiday.date,
        dayType: "holiday",
        reason: holiday.reason,
      },
      adminUser.id,
    );
  }
  console.log(
    `  attendance     policy ${policyA.markingMode} (school A); calendar +${generated.generated} days, holidays: ${holidays.map((h) => h.date).join(", ")}`,
  );

  // A previous run may have left a cached snapshot that predates these grants.
  await invalidateUserAuthCache(adminUser.id);
  await invalidateUserAuthCache(principalUser.id);
  await invalidateUserAuthCache(teacherUser.id);
  await invalidateUserAuthCache(subjectTeacherUser.id);
  await invalidateUserAuthCache(parentUser.id);

  console.log(`
Done.

  organization   ${organization.id}
  school A       ${schoolA.id}  (${SCHOOL_A_CODE})
  school B       ${schoolB.id}  (${SCHOOL_B_CODE})

  school A years ${currentYearA.name} (current), ${closedYearA.name} (closed)
  school B year  ${yearB.name} (current)
  class          ${classA.name}  (${classA.id})
  class          ${classSibling.name}  (${classSibling.id})  — no grants
  section        ${sectionA.name}  (${sectionA.id})

  subjects (A)   ${subjectMathA.name}, ${subjectPhysicsA.name}
  subjects (B)   ${subjectMathB.name}  — same name as A's, by design

  mappings (A)   ${mappingMathA.sequenceNumber}. ${subjectMathA.name}, ${mappingPhysicsA.sequenceNumber}. ${subjectPhysicsA.name} → ${classA.name}
  mappings (B)   ${mappingMathB.sequenceNumber}. ${subjectMathB.name} → ${classB.name}  — same name as A's, by design
  assignments    6-A: subject_teacher (${staSubjectTeacher.userId.slice(0, 8)}…), class_teacher homeroom (${staHomeroom.userId.slice(0, 8)}…)

  terms (A)      ${term1A.name}, ${term2A.name} → ${currentYearA.name}; ${termFullClosedA.name} → ${closedYearA.name} (closed)
  terms (B)      ${termFullB.name} → ${yearB.name}  — same name as A's closed year, by design

  students (A)   ${STUDENT_1_ADMISSION} (6-A, sectioned), ${STUDENT_2_ADMISSION} (admitted, no section)
  students (B)   ${STUDENT_B_ADMISSION} (${classB.name})
  enrollments    one per student per year — the year anchor
  parent         ${PARENT_EMAIL} → owns both A students (one access row inactive)

  ${ADMIN_EMAIL}            org_admin @ org         → both schools
  ${PRINCIPAL_EMAIL}        principal @ school A    → school A only
  ${TEACHER_EMAIL}          class_teacher @ Class 6 → no read_history
  ${SUBJECT_TEACHER_EMAIL}  subject_teacher @ Class 6-A
  ${VICE_PRINCIPAL_EMAIL}   vice_principal @ school A
  ${ACCOUNTANT_EMAIL}       accountant @ school A
  ${LIBRARIAN_EMAIL}        librarian @ school A
  ${STAFF_COORDINATOR_EMAIL} staff_coordinator @ org

  password for all: ${SEED_PASSWORD}
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
