/**
 * End-to-end proof that the authorization spine behaves as ADR-017 claims.
 *
 *   pnpm dev            (in another terminal — this talks to a running API)
 *   pnpm db:seed
 *   pnpm smoke:authz
 *
 * WHY THIS EXISTS ALONGSIDE THE 54 UNIT TESTS. Those are pure: they hand-build
 * a UserAuthCache and check the scope maths. Everything BETWEEN the database
 * and can() is therefore untested — buildUserAuthCache resolving each
 * assignment's DataScope, the JSON round-trip through Redis that turns
 * `expiresAt` back into a Date, scopeWhere's SQL actually selecting the right
 * rows, and resolveNode in trpc.ts. A bug in any of those leaves all 54 tests
 * green and production broken.
 *
 * So this deliberately goes over HTTP rather than through createCaller: the
 * cookie, the session lookup, Redis, and Postgres are exactly the layers under
 * test. Faking a session would skip them.
 *
 * The assertions are mostly NEGATIVE — what each caller must NOT be able to
 * reach. A tenancy filter that is too wide still returns the caller's own rows,
 * so only the forbidden cases can tell you it is broken.
 */
import { getRedis, invalidateUserAuthCache } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  classes,
  organizations,
  roleAssignments,
  schools,
  sections,
  sectionTeacherAssignments,
  subjects,
  user,
} from "@repo/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const API = process.env.SMOKE_API_URL ?? "http://localhost:4000";

/**
 * Every request carries this as its Origin, because better-auth rejects
 * state-changing calls whose origin is absent or untrusted
 * (MISSING_OR_NULL_ORIGIN / a 403 that looks exactly like bad credentials).
 * Node's fetch does not set the header on its own, so the browser's behaviour
 * has to be reproduced by hand. It must match CORS_ORIGIN, which is what
 * packages/auth passes to better-auth's `trustedOrigins`.
 */
const WEB_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

const ADMIN_EMAIL = "admin@demo-trust.test";
const PRINCIPAL_EMAIL = "principal@demo-trust.test";
const TEACHER_EMAIL = "teacher@demo-trust.test";
const SUBJECT_TEACHER_EMAIL = "subject-teacher@demo-trust.test";
const SEED_PASSWORD = "Password123!";

let failures = 0;
let checks = 0;

function report(name: string, ok: boolean, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Signs in and returns the session cookie, the way a browser would. */
async function signIn(email: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Sign-in failed for ${email} (${res.status}). Has \`pnpm db:seed\` been run?\n${body}`,
    );
  }

  const cookie = res.headers.getSetCookie?.().join("; ") ?? res.headers.get("set-cookie");
  if (!cookie) throw new Error(`No session cookie returned for ${email}.`);
  return cookie;
}

/**
 * tRPC's HTTP envelope. A success carries `result.data`; a failure carries
 * `error.data.code` — the string form of the TRPCError code, which is what the
 * assertions below compare against.
 */
type TrpcEnvelope = {
  result?: { data?: unknown };
  error?: { data?: { code?: string } };
};

type TrpcResult = {
  ok: boolean;
  status: number;
  /** School rows, when the call succeeded. */
  data?: any;
  /** e.g. "FORBIDDEN", "NOT_FOUND". Absent on success. */
  code?: string;
};

async function readEnvelope(res: Response): Promise<TrpcResult> {
  const body = (await res.json().catch(() => ({}))) as TrpcEnvelope;
  return {
    ok: res.ok,
    status: res.status,
    data: body.result?.data,
    code: body.error?.data?.code,
  };
}

async function query(cookie: string, path: string, input: unknown): Promise<TrpcResult> {
  // A z.undefined() input (me.get) must be omitted, not sent as `{}` — an
  // empty object fails the schema on the server.
  const qs =
    input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return readEnvelope(
    await fetch(`${API}/trpc/${path}${qs}`, {
      headers: { cookie, origin: WEB_ORIGIN },
    }),
  );
}

async function mutate(cookie: string, path: string, input: unknown): Promise<TrpcResult> {
  return readEnvelope(
    await fetch(`${API}/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: WEB_ORIGIN },
      body: JSON.stringify(input),
    }),
  );
}


async function main() {
  console.log(`\nSmoke-testing authorization against ${API}\n`);

  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, "demo-trust"));

  if (!organization) throw new Error("No demo-trust org. Run `pnpm db:seed` first.");

  const orgSchools = await db
    .select()
    .from(schools)
    .where(eq(schools.organizationId, organization.id));

  const schoolA = orgSchools.find((s) => s.code === "MAIN");
  const schoolB = orgSchools.find((s) => s.code === "NORTH");
  if (!schoolA || !schoolB) throw new Error("Seed is incomplete — expected MAIN and NORTH.");

  // Academic rows the assertions below address. The seed gives school A a
  // current and a closed year, school B a current year, and school A one class
  // to scope the class teacher to.
  const yearsA = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.schoolId, schoolA.id));
  const currentYearA = yearsA.find((y) => y.isCurrent);
  const closedYearA = yearsA.find((y) => !y.isCurrent);

  const [yearB] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.schoolId, schoolB.id));

  const [classA] = await db
    .select()
    .from(classes)
    .where(eq(classes.schoolId, schoolA.id));

  if (!currentYearA || !closedYearA || !yearB || !classA) {
    throw new Error(
      "Academic seed incomplete — expected a current + closed year in school A, " +
        "a year in school B, and a class in school A. Run `pnpm db:seed`.",
    );
  }

  const [sectionA] = await db
    .select()
    .from(sections)
    .where(eq(sections.classId, classA.id));

  if (!sectionA) {
    throw new Error(
      "No section under Class 6. The section-scoped subject_teacher needs it — " +
        "run `pnpm db:seed` (re-seeding is idempotent).",
    );
  }

  // The B7 sibling: same branch, deliberately unscoped to nobody.
  const [classSibling] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, schoolA.id), eq(classes.name, "Class 7")));

  if (!classSibling) {
    throw new Error(
      "No sibling class (Class 7) in school A. The overlap-read discriminator " +
        "needs it — run `pnpm db:seed` (re-seeding is idempotent).",
    );
  }

  // School A's catalogue and school B's same-named "Mathematics". The B subject
  // id is what the negative assertions address: if a tenancy filter ever leaks
  // across branches, the caller sees a row whose NAME they expected — only the
  // id betrays that it came from the wrong school.
  const subjectsA = await db.select().from(subjects).where(eq(subjects.schoolId, schoolA.id));
  const subjectMathA = subjectsA.find((s) => s.name === "Mathematics");
  const subjectPhysicsA = subjectsA.find((s) => s.name === "Physics");
  const [subjectMathB] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.schoolId, schoolB.id));

  if (!subjectMathA || !subjectPhysicsA || !subjectMathB) {
    throw new Error(
      "Subject seed incomplete — expected Mathematics + Physics in school A and " +
        "Mathematics in school B. Run `pnpm db:seed` (re-seeding is idempotent).",
    );
  }

  // The teaching-assignment layer: Class 6's subject template, the staffing
  // facts on 6-A, and school B's mirror (class, section, mapping) — the rows
  // the cross-branch create attempts below name and must be refused.
  const mappingsA = await db
    .select()
    .from(classSubjectMappings)
    .where(eq(classSubjectMappings.classId, classA.id));
  const mappingMathA = mappingsA.find((m) => m.subjectId === subjectMathA.id);
  const [classB] = await db
    .select()
    .from(classes)
    .where(eq(classes.schoolId, schoolB.id));
  const [sectionB] = await db
    .select()
    .from(sections)
    .where(eq(sections.classId, classB?.id ?? ""));
  // School B's Mathematics is mapped onto exactly one class — its own.
  const [mappingMathB] = await db
    .select()
    .from(classSubjectMappings)
    .where(eq(classSubjectMappings.subjectId, subjectMathB.id));

  const staRows = await db
    .select()
    .from(sectionTeacherAssignments)
    .where(eq(sectionTeacherAssignments.sectionId, sectionA.id));
  const staSubjectTeacher = staRows.find(
    (r) => r.role === "subject_teacher" && r.effectiveTo === null,
  );

  if (
    !mappingMathA ||
    mappingsA.length < 2 ||
    !mappingMathB ||
    !classB ||
    !sectionB ||
    staRows.length < 2 ||
    !staSubjectTeacher
  ) {
    throw new Error(
      "Assignment seed incomplete — expected Mathematics + Physics mapped onto " +
        "Class 6, two open assignments on 6-A, and a class + section + mapping in " +
        "school B. Run `pnpm db:seed` (re-seeding is idempotent).",
    );
  }

  const adminCookie = await signIn(ADMIN_EMAIL);
  const principalCookie = await signIn(PRINCIPAL_EMAIL);
  const teacherCookie = await signIn(TEACHER_EMAIL);
  const subjectTeacherCookie = await signIn(SUBJECT_TEACHER_EMAIL);
  const orgId = organization.id;

  console.log("self-registration is closed (ADR-021)");

  // The sign-in below proves /api/auth/* is mounted, so a refusal here cannot be
  // the whole auth surface being unreachable. Asserted over HTTP because the
  // block IS transport-level: `auth.api.signUpEmail()` still works by design,
  // and calling that would test the opposite of what we mean.
  const strangerEmail = "stranger@not-a-tenant.test";
  const signUp = await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({
      email: strangerEmail,
      password: SEED_PASSWORD,
      name: "Uninvited Stranger",
    }),
  });
  report(
    "public sign-up is refused",
    signUp.status === 404,
    `HTTP ${signUp.status}`,
  );

  // The status code is the contract; the absent row is the point. A future
  // refactor could return 404 from somewhere that still let the insert through.
  const [stranger] = await db.select().from(user).where(eq(user.email, strangerEmail));
  report(
    "no user row was created",
    stranger === undefined,
    stranger ? "ROW EXISTS — sign-up wrote through the block" : "",
  );

  console.log("\norg_admin — granted at org scope");


  // Exercises buildUserAuthCache → resolveAssignmentScope → can(). If the
  // org grant does not resolve, this returns 0 and everything else is moot.
  // Both seeded branches must appear; the exact count is not asserted because
  // manual UI testing may have added schools to this fixture, and an org-wide
  // caller seeing them is correct, not a leak.
  const adminList = await query(adminCookie, "school.list", { organizationId: orgId });
  report(
    "org_admin lists both schools",
    adminList.ok &&
      adminList.data?.some((s: any) => s.id === schoolA.id) &&
      adminList.data?.some((s: any) => s.id === schoolB.id),
    adminList.ok ? `got ${adminList.data?.length}` : `HTTP ${adminList.status}`,
  );

  const adminReadsB = await query(adminCookie, "school.byId", {
    organizationId: orgId,
    schoolId: schoolB.id,
    id: schoolB.id,
  });
  report("org_admin reads school B", adminReadsB.ok && adminReadsB.data?.id === schoolB.id);

  console.log("\nprincipal — granted at school A only");

  // THE central assertion. getDataScopes clips the grant to the addressed
  // subtree, so addressing the org node must still yield only school A.
  // A `2` here means scopeWhere widened and the trust's other branch leaked.
  const principalList = await query(principalCookie, "school.list", {
    organizationId: orgId,
  });
  report(
    "principal lists ONLY school A",
    principalList.ok &&
      principalList.data?.length === 1 &&
      principalList.data[0]?.id === schoolA.id,
    principalList.ok
      ? `got ${principalList.data?.length}`
      : `HTTP ${principalList.status}`,
  );

  const principalReadsA = await query(principalCookie, "school.byId", {
    organizationId: orgId,
    schoolId: schoolA.id,
    id: schoolA.id,
  });
  report("principal reads their own school", principalReadsA.ok);

  // Cross-branch read. B7 flipped this from FORBIDDEN to NOT_FOUND: under the
  // overlap read the row is outside every grant the caller holds, so it is
  // indistinguishable from absent — the wording the router itself documents.
  const principalReadsB = await query(principalCookie, "school.byId", {
    organizationId: orgId,
    id: schoolB.id,
  });
  report(
    "principal CANNOT read school B",
    !principalReadsB.ok && principalReadsB.code === "NOT_FOUND",
    principalReadsB.ok ? "READ SUCCEEDED — cross-branch leak" : `code ${principalReadsB.code}`,
  );

  // The strict builder. A school-scoped grant does not COVER the org node, so
  // creating a sibling school there must fail even though the same user's
  // grant let them list at that node a moment ago.
  const principalCreates = await mutate(principalCookie, "school.create", {
    organizationId: orgId,
    data: {
      name: "Smoke Test School",
      legalName: "Smoke Test School",
      code: "SMOKE",
      board: "cbse",
    },
  });
  report(
    "principal CANNOT create a school at org scope",
    !principalCreates.ok && principalCreates.code === "FORBIDDEN",
    principalCreates.ok ? "CREATE SUCCEEDED — strict check bypassed" : `code ${principalCreates.code}`,
  );

  console.log("\nacademic years — tenancy (principal @ school A)");

  // Principal is scoped to school A. Listing years at the org node must clip to
  // their branch: both of A's years and NONE of B's. yearB appearing here is a
  // cross-tenant leak the single-school school.list test could never catch.
  const principalYears = await query(principalCookie, "academic.year.list", {
    organizationId: orgId,
  });
  report(
    "principal lists ONLY school A's years",
    principalYears.ok &&
      Array.isArray(principalYears.data) &&
      principalYears.data.length === 2 &&
      principalYears.data.every((y: any) => y.schoolId === schoolA.id) &&
      !principalYears.data.some((y: any) => y.id === yearB.id),
    principalYears.ok
      ? `got ${principalYears.data?.length}`
      : `HTTP ${principalYears.status}`,
  );

  // B6: years are owner-resolved — {organizationId, id}, no scope-node naming.
  // The principal addresses nothing; the resolver finds school B's node, and
  // the service's scope filter must still exclude the row. This is the
  // row-level filter, a layer beneath the gate.
  const principalReadsYearB = await query(principalCookie, "academic.year.byId", {
    organizationId: orgId,
    id: yearB.id,
  });
  report(
    "principal CANNOT read school B's year",
    !principalReadsYearB.ok && principalReadsYearB.code === "NOT_FOUND",
    principalReadsYearB.ok
      ? "READ SUCCEEDED — cross-branch year leak"
      : `code ${principalReadsYearB.code}`,
  );

  // A valid-format uuid for no row that exists in this org. Same NOT_FOUND as
  // the cross-branch case above: neither confirms an id exists anywhere.
  const adminReadsNothing = await query(adminCookie, "academic.year.byId", {
    organizationId: orgId,
    id: "00000000-0000-4000-8000-000000000000",
  });
  report(
    "nonexistent year id is NOT_FOUND, not an error",
    !adminReadsNothing.ok && adminReadsNothing.code === "NOT_FOUND",
    adminReadsNothing.ok ? "READ SUCCEEDED" : `code ${adminReadsNothing.code}`,
  );

  console.log("\nacademic years — history gate (class_teacher lacks read_history)");

  // The overlap gate (ADR-028) judges the owning SCHOOL node against every
  // grant: the class-scoped teacher does not cover her school, but her grant
  // reaches into it, so reading the CURRENT year works. Positive control —
  // so the closed-year NOT_FOUND below can only be the history gate biting.
  const teacherReadsCurrent = await query(teacherCookie, "academic.year.byId", {
    organizationId: orgId,
    id: currentYearA.id,
  });
  report(
    "class_teacher reads the current year",
    teacherReadsCurrent.ok && teacherReadsCurrent.data?.id === currentYearA.id,
    teacherReadsCurrent.ok
      ? ""
      : `HTTP ${teacherReadsCurrent.status} code ${teacherReadsCurrent.code}`,
  );

  // THE assertion. Same call, closed year: without read_history the service pins
  // the query to isCurrent, so a valid id for a closed year returns nothing.
  const teacherReadsClosed = await query(teacherCookie, "academic.year.byId", {
    organizationId: orgId,
    id: closedYearA.id,
  });
  report(
    "class_teacher CANNOT read a closed year",
    !teacherReadsClosed.ok && teacherReadsClosed.code === "NOT_FOUND",
    teacherReadsClosed.ok
      ? "READ SUCCEEDED — history gate bypassed"
      : `code ${teacherReadsClosed.code}`,
  );

  // Non-vacuity control: the principal HOLDS read_history, so the SAME closed
  // year is readable for them. Without this, a bug that hid the row from
  // everyone would masquerade as a passing history gate.
  const principalReadsClosed = await query(principalCookie, "academic.year.byId", {
    organizationId: orgId,
    id: closedYearA.id,
  });
  report(
    "principal (has read_history) reads the same closed year",
    principalReadsClosed.ok && principalReadsClosed.data?.id === closedYearA.id,
    principalReadsClosed.ok
      ? ""
      : `HTTP ${principalReadsClosed.status} code ${principalReadsClosed.code}`,
  );

  // The section-scoped teacher has no grant covering ANY named node — under the
  // old addressing she needed her sectionId to reach this endpoint at all. The
  // overlap gate makes that luck unnecessary: her grant reaches into school A's
  // subtree, so the current year is hers to read. (The closed one is not —
  // history pinning below is role-independent.)
  const subjectTeacherReadsCurrent = await query(
    subjectTeacherCookie,
    "academic.year.byId",
    { organizationId: orgId, id: currentYearA.id },
  );
  report(
    "subject_teacher reads the current year (overlap gate)",
    subjectTeacherReadsCurrent.ok &&
      subjectTeacherReadsCurrent.data?.id === currentYearA.id,
    subjectTeacherReadsCurrent.ok
      ? ""
      : `HTTP ${subjectTeacherReadsCurrent.status} code ${subjectTeacherReadsCurrent.code}`,
  );

  // List-level gate: without read_history the year picker offers only the
  // current session, never the closed one.
  const teacherYears = await query(teacherCookie, "academic.year.list", {
    organizationId: orgId,
    classId: classA.id,
  });
  report(
    "class_teacher's year list omits the closed year",
    teacherYears.ok &&
      teacherYears.data?.length === 1 &&
      teacherYears.data[0]?.id === currentYearA.id,
    teacherYears.ok
      ? `got ${teacherYears.data?.length}`
      : `HTTP ${teacherYears.status}`,
  );

  console.log("\nsubjects — the school-level catalogue (no scope node)");

  // Positive control: the principal sees school A's catalogue. Property-based,
  // not exact-count: manual UI testing may have added subjects to the demo
  // school, and an admin-added row appearing is correct behaviour.
  const principalSubjects = await query(principalCookie, "subject.list", {
    organizationId: orgId,
    schoolId: schoolA.id,
  });
  report(
    "principal lists school A's subjects (both seeded rows present)",
    principalSubjects.ok &&
      principalSubjects.data?.some((s: any) => s.id === subjectMathA.id) &&
      principalSubjects.data?.some((s: any) => s.id === subjectPhysicsA.id),
    principalSubjects.ok
      ? ""
      : `HTTP ${principalSubjects.status} code ${principalSubjects.code}`,
  );

  // THE tenancy assertion, and the reason the seed gives both schools a
  // subject with the SAME NAME: school B's "Mathematics" must not appear in
  // school A's list, and only the id can betray it if it does.
  report(
    "principal's subject list omits school B's same-named subject",
    principalSubjects.ok &&
      !principalSubjects.data?.some((s: any) => s.id === subjectMathB.id),
    principalSubjects.ok
      ? ""
      : `HTTP ${principalSubjects.status} code ${principalSubjects.code}`,
  );

  // By id across the branch boundary: the B6 resolver finds the owner node,
  // the overlap gate refuses the principal's A1-only grant — NOT_FOUND, not
  // 403, indistinguishable from a fabricated id.
  const principalReadsSubjectB = await query(principalCookie, "subject.byId", {
    organizationId: orgId,
    id: subjectMathB.id,
  });
  report(
    "principal CANNOT read school B's subject by id",
    !principalReadsSubjectB.ok && principalReadsSubjectB.code === "NOT_FOUND",
    principalReadsSubjectB.ok
      ? "READ SUCCEEDED — branch tenancy leaked"
      : `code ${principalReadsSubjectB.code}`,
  );

  // The section-scoped teacher reads the catalogue widened to her school —
  // the same set the principal sees (subjects have no class dimension).
  const subjectTeacherSubjects = await query(subjectTeacherCookie, "subject.list", {
    organizationId: orgId,
    schoolId: schoolA.id,
  });
  report(
    "subject_teacher lists her school's subjects (school-level widening)",
    subjectTeacherSubjects.ok &&
      subjectTeacherSubjects.data?.some((s: any) => s.id === subjectMathA.id),
    subjectTeacherSubjects.ok
      ? ""
      : `HTTP ${subjectTeacherSubjects.status} code ${subjectTeacherSubjects.code}`,
  );

  console.log("\nthe teaching-assignment layer — template + staffing");

  // The template: which subjects Class 6 takes this session. Both staffed
  // personas read it — subject_mapping:read reaches class and section grants
  // alike, and the school-level widening is the entity-shape reasoning the
  // service documents, not an accident to be fixed.
  const mappingList = await query(principalCookie, "assignment.subjectMapping.list", {
    organizationId: orgId,
    academicYearId: currentYearA.id,
    classId: classA.id,
  });
  report(
    "principal lists Class 6's mappings",
    mappingList.ok &&
      Array.isArray(mappingList.data) &&
      mappingList.data.length === 2 &&
      mappingList.data.every((m: any) => m.schoolId === schoolA.id),
    mappingList.ok ? `got ${mappingList.data?.length}` : `code ${mappingList.code}`,
  );

  const teacherMappingList = await query(
    teacherCookie,
    "assignment.subjectMapping.list",
    {
      organizationId: orgId,
      academicYearId: currentYearA.id,
      classId: classA.id,
    },
  );
  report(
    "class_teacher lists the same two mappings",
    teacherMappingList.ok &&
      Array.isArray(teacherMappingList.data) &&
      teacherMappingList.data.length === 2 &&
      teacherMappingList.data.every((m: any) => m.schoolId === schoolA.id),
  );

  // The staffing facts: "who teaches 6-A now" is two rows of different roles,
  // and the subject teacher reads them with her section-scoped grant.
  const staList = await query(
    subjectTeacherCookie,
    "assignment.teacherAssignment.list",
    { organizationId: orgId, sectionId: sectionA.id },
  );
  report(
    "subject_teacher lists 6-A's open assignments",
    staList.ok &&
      Array.isArray(staList.data) &&
      staList.data.length === 2 &&
      staList.data.some((r: any) => r.id === staSubjectTeacher.id) &&
      staList.data.every((r: any) => r.sectionId === sectionA.id),
    staList.ok ? `got ${staList.data?.length}` : `code ${staList.code}`,
  );

  // The matrix boundary: she reads the template but not the staffing.
  const teacherStaList = await query(
    teacherCookie,
    "assignment.teacherAssignment.list",
    { organizationId: orgId, sectionId: sectionA.id },
  );
  report(
    "class_teacher holds NO teacher_assignment:read",
    teacherStaList.code === "FORBIDDEN",
    `code ${teacherStaList.code}`,
  );

  // Same pair as the subject.byId cells: the foreign row's NAME is one the
  // caller expects ("Mathematics") — only the id betrays the school.
  const principalReadsBMapping = await query(
    principalCookie,
    "assignment.subjectMapping.byId",
    { organizationId: orgId, id: mappingMathB.id },
  );
  report(
    "principal CANNOT read school B's mapping",
    principalReadsBMapping.code === "NOT_FOUND",
    `code ${principalReadsBMapping.code}`,
  );
  const adminReadsBMapping = await query(
    adminCookie,
    "assignment.subjectMapping.byId",
    { organizationId: orgId, id: mappingMathB.id },
  );
  report(
    "org_admin reads school B's mapping (non-vacuity)",
    adminReadsBMapping.ok && adminReadsBMapping.data?.id === mappingMathB.id,
  );

  // Cross-branch creates. The create input names its parent top-level, so the
  // builder addresses that node and the GATE refuses before the service runs.
  // School B belongs to this org, so the node resolves — the refusal is the
  // strict coverage test, not an unresolvable id.
  const createIntoB = await mutate(
    principalCookie,
    "assignment.subjectMapping.create",
    {
      organizationId: orgId,
      schoolId: schoolA.id,
      academicYearId: currentYearA.id,
      classId: classB.id,
      subjectId: subjectMathA.id,
      data: {},
    },
  );
  report(
    "principal CANNOT map a subject onto school B's class",
    createIntoB.code === "FORBIDDEN",
    `code ${createIntoB.code}`,
  );

  const assignIntoB = await mutate(
    principalCookie,
    "assignment.teacherAssignment.create",
    {
      organizationId: orgId,
      schoolId: schoolA.id,
      sectionId: sectionB.id,
      academicYearId: yearB.id,
      // The gate refuses before any row is written, so the user id is never
      // validated — a marker string keeps the intent obvious if that changes.
      userId: "smoke-no-write",
      role: "class_teacher",
    },
  );
  report(
    "principal CANNOT assign a teacher into school B's section",
    assignIntoB.code === "FORBIDDEN",
    `code ${assignIntoB.code}`,
  );

  // Service-level guard the gate cannot see: the section is covered, the year
  // is in the caller's own school, but the pairing is a lie.
  const yearMismatch = await mutate(
    principalCookie,
    "assignment.teacherAssignment.create",
    {
      organizationId: orgId,
      schoolId: schoolA.id,
      sectionId: sectionA.id,
      academicYearId: closedYearA.id,
      userId: "smoke-no-write",
      role: "class_teacher",
    },
  );
  report(
    "an assignment's year must match its section's year",
    yearMismatch.code === "BAD_REQUEST",
    `code ${yearMismatch.code}`,
  );

  const teacherCreatesMapping = await mutate(
    subjectTeacherCookie,
    "assignment.subjectMapping.create",
    {
      organizationId: orgId,
      schoolId: schoolA.id,
      academicYearId: currentYearA.id,
      classId: classA.id,
      subjectId: subjectMathA.id,
      data: {},
    },
  );
  report(
    "subject_teacher holds NO subject_mapping:create",
    teacherCreatesMapping.code === "FORBIDDEN",
    `code ${teacherCreatesMapping.code}`,
  );

  console.log("\nroles × procedures — baseline matrix");

  /**
   * A PINNED OUTCOME FOR EVERY SEEDDED ROLE × THE ENDPOINTS THE WEB APP CALLS,
   * so the transport refactor (B4–B7) cannot silently change what a role may
   * reach. Each role addresses nodes the way the browser does — the org node
   * for lists, the deepest node it knows for strict reads — because that
   * assembly is the contract being frozen, not just the handler behind it.
   *
   * One cell pins the workaround the web depends on: subject_teacher ×
   * class.byId is 200 ONLY because she addresses her own section node (the
   * service widens a section scope to class level for the `classes` table) —
   * address it any other way and the strict builder refuses her. Her list cell
   * pins 200 too, which is what `useClass` actually reads. When B7 lands both
   * stay 200 deliberately, in the open.
   *
   * Mutations are chosen to leave no trace: setCurrent re-promotes the year
   * that is already current (a true no-op), and the two create attempts are
   * refused at the permission gate before any row is written.
   */
  type Expectation = { kind: "ok" } | { kind: "code"; code: string };
  const OK: Expectation = { kind: "ok" };
  const forbidden: Expectation = { kind: "code", code: "FORBIDDEN" };

  type MatrixRow = {
    role: string;
    cookie: string;
    path: string;
    input: unknown;
    /** Queries go over GET, mutations over POST — the transport is part of the pin. */
    method: "query" | "mutation";
    expect: Expectation;
    /** Extra shape check applied to a success, e.g. which rows must come back. */
    dataCheck?: (data: any) => boolean;
  };

  /**
   * Shape checks are PROPERTY-based wherever fixture drift would otherwise
   * make an exact count lie: this database carries a third school and extra
   * classes/sections from manual UI testing, so "exactly two" is false while
   * the authorization behaviour is fine. Counts stay EXACT only where the
   * count itself is the tenancy property — a clipped caller must not gain
   * rows when the fixture grows around them.
   */

  const rows: MatrixRow[] = [];
  const addQueryRows = (
    role: string,
    cookie: string,
    listInput: Record<string, unknown>,
  ) => {
    rows.push(
      { role, cookie, path: "me.get", input: undefined, method: "query", expect: OK },
      {
        role,
        cookie,
        path: "school.list",
        input: listInput,
        method: "query",
        expect: role === "org_admin" || role === "principal" ? OK : forbidden,
        dataCheck:
          role === "org_admin"
            ? // Org-wide: both seeded branches must appear, whatever else drifted in.
              (d) =>
                Array.isArray(d) &&
                d.some((s: any) => s.id === schoolA.id) &&
                d.some((s: any) => s.id === schoolB.id)
            : role === "principal"
              ? // THE clipping property: only school A, whatever exists elsewhere.
                (d) => Array.isArray(d) && d.length === 1 && d[0]?.id === schoolA.id
              : undefined,
      },
      {
        role,
        cookie,
        path: "academic.year.list",
        input: { organizationId: orgId },
        method: "query",
        expect: OK,
        dataCheck:
          role === "org_admin"
            ? (d) =>
                Array.isArray(d) &&
                d.some((y: any) => y.id === currentYearA.id) &&
                d.some((y: any) => y.id === closedYearA.id) &&
                d.some((y: any) => y.id === yearB.id)
            : role === "principal"
              ? (d) =>
                  Array.isArray(d) &&
                  d.length === 2 &&
                  d.every((y: any) => y.schoolId === schoolA.id)
              : (d) =>
                  Array.isArray(d) &&
                  d.length === 1 &&
                  d[0]?.id === currentYearA.id,
      },
      {
        role,
        cookie,
        path: "academic.year.current",
        // Org scope is refused (B2): isCurrent is per school, so an org-scoped
        // call used to return whichever school's row came first — a wrong
        // answer wearing a 200. Teachers address their own class/section node,
        // which implies the school; the strict gate passes at that node and
        // the service widens to exactly its branch.
        input:
          role === "org_admin" || role === "principal"
            ? { organizationId: orgId, schoolId: schoolA.id }
            : role === "class_teacher"
              ? { organizationId: orgId, classId: classA.id }
              : { organizationId: orgId, sectionId: sectionA.id },
        method: "query",
        expect: OK,
        dataCheck: (d) => d?.id === currentYearA.id,
      },
      {
        role,
        cookie,
        path: "academic.class.list",
        input: { organizationId: orgId },
        method: "query",
        expect: OK,
        dataCheck:
          role === "class_teacher" || role === "subject_teacher"
            ? // Clipped callers see exactly their one class even as the fixture grows.
              (d) => Array.isArray(d) && d.length === 1 && d[0]?.id === classA.id
            : (d) => Array.isArray(d) && d.some((c: any) => c.id === classA.id),
      },
      {
        role,
        cookie,
        path: "subject.list",
        input: { organizationId: orgId },
        method: "query",
        expect: OK,
        dataCheck:
          role === "org_admin"
            ? // Org-wide: school A's rows must appear, whatever else drifted in.
              (d) => Array.isArray(d) && d.some((s: any) => s.id === subjectMathA.id)
            : // Clipped callers: school A's rows present, and EVERY row from
              // school A — school B's same-named subject must never appear.
              (d) =>
                Array.isArray(d) &&
                d.some((s: any) => s.id === subjectMathA.id) &&
                d.every((s: any) => s.schoolId === schoolA.id),
      },
      {
        role,
        cookie,
        path: "academic.class.byId",
        // B7 (ADR-028): overlap read — the row asks the grants. The
        // subject_teacher cell that spent B4–B6 pinned at FORBIDDEN flips to
        // 200 exactly as planned: her section grant reaches into Class 6's
        // subtree even though it does not cover the class node.
        input: { organizationId: orgId, id: classA.id },
        method: "query",
        expect: OK,
        dataCheck: (d) => d?.id === classA.id,
      },
      // The discriminator: same branch, but a row her grant does NOT reach.
      // NOT_FOUND, not 403 — indistinguishable from a made-up id, which is
      // what stops a teacher from mapping the school's class list by probing.
      {
        role: "class_teacher",
        cookie: teacherCookie,
        path: "academic.class.byId",
        input: { organizationId: orgId, id: classSibling.id },
        method: "query",
        expect: { kind: "code", code: "NOT_FOUND" },
      },
      // Same property for the catalogue, with the extra cruelty that the
      // foreign row's NAME is one the caller expects: only the id betrays
      // which school it belongs to.
      {
        role: "principal",
        cookie: principalCookie,
        path: "subject.byId",
        input: { organizationId: orgId, id: subjectMathB.id },
        method: "query",
        expect: { kind: "code", code: "NOT_FOUND" },
      },
      // Non-vacuity control for the cell above: an org-wide caller reads the
      // SAME sibling row, so the 404 can only be the scope test biting.
      {
        role: "org_admin",
        cookie: adminCookie,
        path: "academic.class.byId",
        input: { organizationId: orgId, id: classSibling.id },
        method: "query",
        expect: OK,
        dataCheck: (d) => d?.id === classSibling.id,
      },
      {
        role,
        cookie,
        path: "academic.section.list",
        input: { organizationId: orgId, academicYearId: currentYearA.id },
        method: "query",
        expect: OK,
        dataCheck:
          role === "subject_teacher"
            ? // The strongest cell: a section grant clips the roster to ONE row.
              (d) => Array.isArray(d) && d.length === 1 && d[0]?.id === sectionA.id
            : role === "class_teacher"
              ? (d) =>
                  Array.isArray(d) &&
                  d.some((s: any) => s.id === sectionA.id) &&
                  d.every((s: any) => s.classId === classA.id)
              : (d) =>
                  Array.isArray(d) &&
                  d.some((s: any) => s.id === sectionA.id) &&
                  d.every((s: any) => s.schoolId === schoolA.id),
      },
      {
        role,
        cookie,
        path: "assignment.subjectMapping.list",
        input: {
          organizationId: orgId,
          academicYearId: currentYearA.id,
          classId: classA.id,
        },
        method: "query",
        expect: OK,
        dataCheck: (d) =>
          Array.isArray(d) &&
          d.length === 2 &&
          d.some((m: any) => m.id === mappingMathA.id) &&
          d.every((m: any) => m.schoolId === schoolA.id),
      },
      {
        role,
        cookie,
        path: "assignment.teacherAssignment.list",
        input: { organizationId: orgId, sectionId: sectionA.id },
        method: "query",
        // The matrix boundary: the class teacher reads the template but holds
        // no teacher_assignment:read — staffing is not her view.
        expect: role === "class_teacher" ? forbidden : OK,
        dataCheck:
          role === "class_teacher"
            ? undefined
            : (d) =>
                Array.isArray(d) &&
                d.length === 2 &&
                d.every((r: any) => r.sectionId === sectionA.id),
      },
    );
  };

  addQueryRows("org_admin", adminCookie, { organizationId: orgId });
  addQueryRows("principal", principalCookie, { organizationId: orgId });
  addQueryRows("class_teacher", teacherCookie, { organizationId: orgId });
  addQueryRows("subject_teacher", subjectTeacherCookie, { organizationId: orgId });

  // One mutation each, none of them leaving a row behind. Plus the B2 pin:
  // asking for "the current year" with no branch named is a validation error,
  // not an arbitrary school's answer.
  rows.push(
    {
      role: "org_admin",
      cookie: adminCookie,
      path: "academic.year.current",
      input: { organizationId: orgId },
      method: "query",
      expect: { kind: "code", code: "BAD_REQUEST" },
    },
    // A teacher naming a school she does not cover is refused by the strict
    // gate — the addressing question, not the org-scope one.
    {
      role: "class_teacher",
      cookie: teacherCookie,
      path: "academic.year.current",
      input: { organizationId: orgId, schoolId: schoolA.id },
      method: "query",
      expect: forbidden,
    },
    {
      role: "org_admin",
      cookie: adminCookie,
      path: "academic.year.setCurrent",
      // B6: owner-resolved by id; the mutation gate stays strict "cover".
      input: { organizationId: orgId, id: currentYearA.id },
      method: "mutation",
      expect: OK,
      dataCheck: (d) => d?.id === currentYearA.id,
    },
    {
      role: "principal",
      cookie: principalCookie,
      path: "academic.year.setCurrent",
      input: { organizationId: orgId, id: currentYearA.id },
      method: "mutation",
      expect: OK,
      dataCheck: (d) => d?.id === currentYearA.id,
    },
    {
      role: "class_teacher",
      cookie: teacherCookie,
      path: "academic.class.create",
      input: {
        organizationId: orgId,
        schoolId: schoolA.id,
        classId: classA.id,
        data: { name: "Smoke Class", numericOrder: 99 },
      },
      method: "mutation",
      expect: forbidden,
    },
    {
      role: "subject_teacher",
      cookie: subjectTeacherCookie,
      path: "academic.section.create",
      input: {
        organizationId: orgId,
        sectionId: sectionA.id,
        data: { name: "Smoke Section", academicYearId: currentYearA.id, classId: classA.id },
      },
      method: "mutation",
      expect: forbidden,
    },
  );

  for (const row of rows) {
    const result =
      row.method === "query"
        ? await query(row.cookie, row.path, row.input)
        : await mutate(row.cookie, row.path, row.input);
    const passed =
      row.expect.kind === "ok"
        ? result.ok && (!row.dataCheck || row.dataCheck(result.data))
        : !result.ok && result.code === row.expect.code;
    report(
      `${row.role} × ${row.path}`,
      passed,
      row.expect.kind === "ok"
        ? result.ok
          ? ""
          : `expected ok, got HTTP ${result.status} code ${result.code}`
        : `expected ${row.expect.code}, got ${result.ok ? "ok" : result.code}`,
    );
  }

  console.log("\nrevocation");

  // Revocation must bite immediately, not at the end of the 5-minute TTL.
  // This is the invalidateUserAuthCache contract, and it has never run.
  const [principalUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, PRINCIPAL_EMAIL));

  if (!principalUser) throw new Error("Principal user missing.");

  await db
    .update(roleAssignments)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(roleAssignments.userId, principalUser.id),
        isNull(roleAssignments.revokedAt),
      ),
    );
  await invalidateUserAuthCache(principalUser.id);

  const afterRevoke = await query(principalCookie, "school.list", {
    organizationId: orgId,
  });
  report(
    "revoked principal is refused",
    !afterRevoke.ok && afterRevoke.code === "FORBIDDEN",
    afterRevoke.ok ? "STILL AUTHORIZED after revoke" : `code ${afterRevoke.code}`,
  );

  // Put the seed back the way we found it, so the script stays re-runnable.
  await db
    .update(roleAssignments)
    .set({ revokedAt: null })
    .where(eq(roleAssignments.userId, principalUser.id));
  await invalidateUserAuthCache(principalUser.id);

  console.log(
    `\n${failures === 0 ? "All" : `${checks - failures}/${checks}`} checks passed${
      failures ? ` — ${failures} FAILED` : ""
    }.\n`,
  );

  getRedis().disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
