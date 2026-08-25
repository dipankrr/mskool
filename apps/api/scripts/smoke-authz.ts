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
  classes,
  organizations,
  roleAssignments,
  schools,
  sections,
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

  // Cross-branch read. Must not distinguish "exists elsewhere" from "absent".
  const principalReadsB = await query(principalCookie, "school.byId", {
    organizationId: orgId,
    schoolId: schoolB.id,
    id: schoolB.id,
  });
  report(
    "principal CANNOT read school B",
    !principalReadsB.ok && principalReadsB.code === "FORBIDDEN",
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

  // Addresses their OWN school node — the gate passes — but with school B's year
  // id. scopeWhere must still exclude it. This is the row-level filter, a layer
  // beneath the node gate that already 403s a direct school-B address.
  const principalReadsYearB = await query(principalCookie, "academic.year.byId", {
    organizationId: orgId,
    schoolId: schoolA.id,
    id: yearB.id,
  });
  report(
    "principal CANNOT read school B's year",
    !principalReadsYearB.ok && principalReadsYearB.code === "NOT_FOUND",
    principalReadsYearB.ok
      ? "READ SUCCEEDED — cross-branch year leak"
      : `code ${principalReadsYearB.code}`,
  );

  console.log("\nacademic years — history gate (class_teacher lacks read_history)");

  // The teacher addresses their CLASS node — their grant covers nothing wider.
  // The service widens years to school level, so reading the CURRENT year works.
  // This is the positive control: it proves the read path and node addressing,
  // so the closed-year NOT_FOUND below can only be the history gate biting.
  const teacherReadsCurrent = await query(teacherCookie, "academic.year.byId", {
    organizationId: orgId,
    classId: classA.id,
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
    classId: classA.id,
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
    schoolId: schoolA.id,
    id: closedYearA.id,
  });
  report(
    "principal (has read_history) reads the same closed year",
    principalReadsClosed.ok && principalReadsClosed.data?.id === closedYearA.id,
    principalReadsClosed.ok
      ? ""
      : `HTTP ${principalReadsClosed.status} code ${principalReadsClosed.code}`,
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
        path: "academic.class.byId",
        // ADR-027 (B4): single-resource reads address their OWN resource —
        // {organizationId, id}, no scope-node naming.
        //
        // The subject_teacher cell pins the TRANSITIONAL truth: her section
        // grant does not COVER the parent class node (coverage is downwards),
        // so strict id-addressing refuses her until B7's permissive reads
        // re-frame the question as "is this row inside one of my grants?" —
        // then this cell flips to 200 deliberately, and `useClass`'s list
        // workaround (kept, see plan B4) is what keeps her screen working
        // in the meantime.
        input: { organizationId: orgId, id: classA.id },
        method: "query",
        expect: role === "subject_teacher" ? forbidden : OK,
        dataCheck: role === "subject_teacher" ? undefined : (d) => d?.id === classA.id,
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
      input: { organizationId: orgId, schoolId: schoolA.id, id: currentYearA.id },
      method: "mutation",
      expect: OK,
      dataCheck: (d) => d?.id === currentYearA.id,
    },
    {
      role: "principal",
      cookie: principalCookie,
      path: "academic.year.setCurrent",
      input: { organizationId: orgId, schoolId: schoolA.id, id: currentYearA.id },
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
