import { feesBillingService } from "./fees-billing.service";
import { storageService } from "./storage.service";
import {
  atSchoolLevel,
  requireSchoolId,
} from "./academic.service";
import { ENROLLED_STATUSES, LEFT_STATUSES, todayInIst } from "./enrollment-status";
import { escapeLike, scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  CreateStudentInput,
  StudentRosterInput,
  StudentRosterOutput,
  StudentRosterSummary,
  UpdateStudentInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  sections,
  studentEnrollments,
  studentGuardians,
  studentPhotos,
  students,
} from "@repo/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * STUDENTS — the identity registry. Written once at admission; a student's
 * class, section, and roll number live on `student_enrollments` (the year
 * anchor), never here. Phase 2's admission slice gives this service its CRUD;
 * it entered life with only the B6 resolution adapter (S4.2).
 *
 * Knows nothing about HTTP. The staff track takes a DataScope as a REQUIRED
 * argument and filters by it (hard rule 1); input types come from
 * `@repo/contracts`.
 *
 * **Scope shape: SCHOOL-level, `atSchoolLevel` widening.** The students table
 * has no class or section columns — those belong to the year anchor — so a
 * section-scoped teacher listing students is asking about the school's
 * registry, the same entity-shape reasoning as academic years (documented in
 * academic.service.ts). The ROSTER — "the students of 6-A this year" — is an
 * ENROLLMENT query (enrollment.service), where the class dimension is real
 * and no widening happens.
 *
 * NOT in the scope tree — no `scope_nodes` row (hard rule 12 names
 * school/class/section only). Carries the denormalised `organizationId` +
 * `schoolId` for `scopeWhere` like every academic table.
 *
 * Scope columns are per-TABLE (the S2.4 lesson): `scopeWhere` compiles the
 * columns it is handed into that query's SQL.
 */

const STUDENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: students.organizationId,
  schoolId: students.schoolId,
} as const;

const ROSTER_PAGE_SIZE = 50;

/**
 * The register with each student's enrollment attached: the selected year's row,
 * and their latest row for telling where they stand now. Every roster view is
 * this one query plus a filter, so the tab and its counts can't disagree.
 */
function rosterSource(scopes: DataScope[], academicYearId: string) {
  const year = alias(studentEnrollments, "year_enrollment");
  const latestRow = alias(studentEnrollments, "latest_row");
  const latest = db
    .select({
      id: latestRow.id,
      classId: latestRow.classId,
      sectionId: latestRow.sectionId,
      rollNumber: latestRow.rollNumber,
      enrollmentStatus: latestRow.enrollmentStatus,
      leftOn: latestRow.leftOn,
    })
    .from(latestRow)
    .innerJoin(academicYears, eq(academicYears.id, latestRow.academicYearId))
    .where(eq(latestRow.studentId, students.id))
    .orderBy(desc(academicYears.startDate))
    .limit(1)
    .as("latest");

  // Whole-school staff see the whole register. Anyone limited to a class or
  // section sees only the students placed in it this year.
  const broad = scopes.filter((scope) => !scope.classId && !scope.sectionId);
  const narrow = scopes.filter((scope) => scope.classId || scope.sectionId);
  const scopeFilter = or(
    broad.length > 0 ? scopeWhere(broad, STUDENT_SCOPE_COLUMNS) : undefined,
    narrow.length > 0
      ? scopeWhere(narrow, {
          organizationId: year.organizationId,
          schoolId: year.schoolId,
          classId: year.classId,
          sectionId: year.sectionId,
        })
      : undefined,
  );

  const hasGuardian = sql<boolean>`exists (select 1 from ${studentGuardians} where ${studentGuardians.studentId} = ${students.id})`;
  const views: Record<StudentRosterInput["view"], SQL | undefined> = {
    current: inArray(year.enrollmentStatus, [...ENROLLED_STATUSES]),
    notPlaced: and(eq(students.status, "active"), isNull(year.id)),
    left: and(
      eq(students.status, "inactive"),
      or(isNull(latest.id), inArray(latest.enrollmentStatus, [...LEFT_STATUSES])),
    ),
    alumni: eq(latest.enrollmentStatus, "graduated"),
    all: undefined,
  };

  return { year, latest, scopeFilter, hasGuardian, views, academicYearId };
}

type RosterSource = Omit<ReturnType<typeof rosterSource>, "academicYearId">;

/**
 * The list's conditions and order, shared by the paged list and the ID-card print,
 * so a printed list is exactly the list the screen showed. Both queries join the
 * selected year, the latest row, the class, the section and the photo the same way.
 */
function rosterQueryParts(
  { year, latest, scopeFilter, hasGuardian, views }: RosterSource,
  input: Omit<StudentRosterInput, "limit" | "cursor">,
) {
  const classId = sql<string | null>`case when ${year.id} is not null then ${year.classId} else ${latest.classId} end`;
  const sectionId = sql<string | null>`case when ${year.id} is not null then ${year.sectionId} else ${latest.sectionId} end`;
  const rollNumber = sql<string | null>`case when ${year.id} is not null then ${year.rollNumber} else ${latest.rollNumber} end`;
  const pattern = input.q ? `%${escapeLike(input.q)}%` : null;

  const orderBy: Record<StudentRosterInput["sort"], SQL[]> = {
    class: [
      sql`${classes.numericOrder} asc nulls last`,
      sql`${sections.name} asc nulls last`,
      sql`nullif(regexp_replace(${rollNumber}, '\\D', '', 'g'), '')::numeric asc nulls last`,
      asc(students.firstName),
      asc(students.lastName),
    ],
    name: [asc(students.firstName), asc(students.lastName)],
    newest: [
      sql`${students.admissionDate} desc nulls last`,
      desc(students.createdAt),
    ],
  };

  const where = and(
    scopeFilter,
    views[input.view],
    pattern
      ? or(
          ilike(students.firstName, pattern),
          ilike(students.middleName, pattern),
          ilike(students.lastName, pattern),
          ilike(students.admissionNumber, pattern),
        )
      : undefined,
    input.classId ? eq(year.classId, input.classId) : undefined,
    input.sectionId ? eq(year.sectionId, input.sectionId) : undefined,
    input.gender ? eq(students.gender, input.gender) : undefined,
    input.admissionYear
      ? sql`extract(year from ${students.admissionDate}) = ${input.admissionYear}`
      : undefined,
    input.noSection ? eq(year.enrollmentStatus, "admitted") : undefined,
    input.noGuardian ? sql`not ${hasGuardian}` : undefined,
    input.noPhoto ? isNull(studentPhotos.id) : undefined,
  );

  return { classId, sectionId, rollNumber, where, orderBy: orderBy[input.sort] };
}

export class StudentService {
  /**
   * Admits a student into the registry. No parent FKs and no scope node, so
   * no transaction and no parent re-read: both tenancy columns come from the
   * caller's scope, not the input. A duplicate admission number within the
   * school is refused by `students_school_admission_number_uq`, not
   * pre-checked (ADR-022); `translateErrors` words it.
   */
  async createStudent(scope: DataScope, input: CreateStudentInput) {
    const schoolId = requireSchoolId(scope);

    const [student] = await db
      .insert(students)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
      })
      .returning();

    if (!student) {
      throw new Error("Failed to create student.");
    }

    return student;
  }

  /**
   * The school's ACTIVE students. Takes the PLURAL scopes (a user may hold
   * grants in several branches). Active only: the registry's inactive rows
   * are history (hard rule 2), not options for tomorrow's admission form —
   * the same reasoning as the subject catalogue's list.
   *
   * `q` is an optional text search across name parts and the admission
   * number — the one lookup a front desk actually performs ("the Sharma
   * child, admission DEMO-00…"). Deactivated students stay findable by id
   * (see `getStudentById`) but not by search: a leaving student should not
   * surface in an admission officer's picker.
   */
  async listStudents(scopes: DataScope[], q?: string) {
    return db
      .select()
      .from(students)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), STUDENT_SCOPE_COLUMNS),
          eq(students.status, "active"),
          q
            ? (() => {
                // Escape wildcards first: q:"%" must match nothing, not the
                // whole register.
                const pattern = `%${escapeLike(q)}%`;
                return or(
                  ilike(students.firstName, pattern),
                  ilike(students.middleName, pattern),
                  ilike(students.lastName, pattern),
                  ilike(students.admissionNumber, pattern),
                );
              })()
            : undefined,
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName));
  }

  /**
   * The bulk-photo matcher's read: active students whose admission number is
   * in the uploaded set, with the CURRENT YEAR's enrollment facts (class,
   * section, roll) so the review grid shows who each file is about. LEFT
   * joins throughout — a student admitted but not yet enrolled/sectioned in
   * the anchor year still matches (her card facts render empty, the same
   * honesty as the print path). School-level clipped exactly like the
   * register list — a foreign branch's admission number is indistinguishable
   * from a name nobody uploaded. Bounded by the contract's 500-name cap.
   */
  async listByAdmissions(
    scope: DataScope,
    academicYearId: string,
    admissions: string[],
  ) {
    if (admissions.length === 0) return [];
    return db
      .select({
        student: students,
        rollNumber: studentEnrollments.rollNumber,
        className: classes.name,
        sectionName: sections.name,
      })
      .from(students)
      .leftJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, students.id),
          eq(studentEnrollments.academicYearId, academicYearId),
        ),
      )
      .leftJoin(classes, eq(studentEnrollments.classId, classes.id))
      .leftJoin(sections, eq(studentEnrollments.sectionId, sections.id))
      .where(
        and(
          scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
          eq(students.status, "active"),
          inArray(students.admissionNumber, admissions),
        ),
      )
      .orderBy(asc(students.admissionNumber));
  }

  /**
   * Reads one student. No active filter, unlike the list: a student who left
   * must still resolve for the enrollments, fee rows, and documents that
   * reference her (hard rule 2 — the registry is history, not a larder).
   */
  async getStudentById(scope: DataScope, studentId: string) {
    const [student] = await db
      .select()
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
        ),
      );

    return student ?? null;
  }

  /**
   * Demographics and contact details are correctable; identity is not (the
   * contract omits the admission number and the status — see its docstring).
   */
  async updateStudent(
    scope: DataScope,
    studentId: string,
    input: UpdateStudentInput,
  ) {
    const [student] = await db
      .update(students)
      .set(input)
      .where(
        and(
          eq(students.id, studentId),
          scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return student ?? null;
  }

  /**
   * The registry's soft delete (hard rule 2): the student becomes `inactive`,
   * and every enrollment, fee row, and result keeps pointing at her. An open
   * enrollment closes first, because the database refuses an inactive student
   * whose latest enrollment says otherwise (ADR-057).
   */
  async deactivateStudent(scope: DataScope, studentId: string, actorUserId: string) {
    return db.transaction(async (tx) => {
      const [found] = await tx
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.id, studentId),
            scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
          ),
        );
      if (!found) return null;

      const [latest] = await tx
        .select({
          id: studentEnrollments.id,
          enrollmentStatus: studentEnrollments.enrollmentStatus,
        })
        .from(studentEnrollments)
        .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
        .where(eq(studentEnrollments.studentId, studentId))
        .orderBy(desc(academicYears.startDate))
        .limit(1);
      if (latest && (ENROLLED_STATUSES as readonly string[]).includes(latest.enrollmentStatus)) {
        await tx
          .update(studentEnrollments)
          .set({
            enrollmentStatus: "withdrawn",
            leftOn: todayInIst(),
            leavingReason: "Student record was deactivated",
            leftBy: actorUserId,
          })
          .where(eq(studentEnrollments.id, latest.id));
      }

      const [student] = await tx
        .update(students)
        .set({ status: "inactive" })
        .where(eq(students.id, studentId))
        .returning();
      return student ?? null;
    });
  }

  /**
   * Brings back a student who left. Each student has one enrollment per session,
   * so this reopens their latest row and files the departure in its history; the
   * database moves the student back to `active`. Graduating isn't a departure
   * to undo, so it stays with the promotion flow.
   */
  async rejoinStudent(scope: DataScope, studentId: string) {
    return db.transaction(async (tx) => {
      const [found] = await tx
        .select({ status: students.status })
        .from(students)
        .where(
          and(
            eq(students.id, studentId),
            scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
          ),
        );
      if (!found) return null;
      if (found.status === "active") {
        throw new Error("This student is already with the school.");
      }

      const [latest] = await tx
        .select({ enrollment: studentEnrollments })
        .from(studentEnrollments)
        .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
        .where(eq(studentEnrollments.studentId, studentId))
        .orderBy(desc(academicYears.startDate))
        .limit(1);
      if (latest) {
        const row = latest.enrollment;
        if (row.enrollmentStatus === "graduated") {
          throw new Error("A graduated student cannot rejoin from here.");
        }
        await tx
          .update(studentEnrollments)
          .set({
            enrollmentStatus: row.sectionId ? "studying" : "admitted",
            leftOn: null,
            leavingReason: null,
            leftBy: null,
            leavingHistory: [
              ...row.leavingHistory,
              {
                status: row.enrollmentStatus,
                leftOn: row.leftOn,
                reason: row.leavingReason,
                leftBy: row.leftBy,
                rejoinedOn: todayInIst(),
              },
            ],
          })
          .where(eq(studentEnrollments.id, row.id));
      }

      const [student] = await tx
        .update(students)
        .set({ status: "active" })
        .where(eq(students.id, studentId))
        .returning();
      // Dues from today on are owed again; the months away stay cancelled.
      if (latest) {
        await feesBillingService.reopenDuesOnRejoining(tx, scope, latest.enrollment.id);
      }
      return student ?? null;
    });
  }

  /** One page of one Students tab view, for the selected year. */
  async listRoster(
    scopes: DataScope[],
    input: StudentRosterInput,
  ): Promise<StudentRosterOutput> {
    const { year, latest, scopeFilter, hasGuardian, views } = rosterSource(
      scopes,
      input.academicYearId,
    );
    const limit = input.limit ?? ROSTER_PAGE_SIZE;
    const offset = input.cursor ?? 0;
    const { classId, sectionId, rollNumber, where, orderBy } = rosterQueryParts(
      { year, latest, scopeFilter, hasGuardian, views },
      input,
    );

    const rows = await db
      .select({
        id: students.id,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
        status: students.status,
        yearStatus: year.enrollmentStatus,
        latestStatus: latest.enrollmentStatus,
        leftOn: latest.leftOn,
        classId,
        className: classes.name,
        sectionId,
        sectionName: sections.name,
        rollNumber,
        photoObjectId: studentPhotos.objectId,
        hasGuardian,
      })
      .from(students)
      .leftJoin(
        year,
        and(eq(year.studentId, students.id), eq(year.academicYearId, input.academicYearId)),
      )
      .leftJoinLateral(latest, sql`true`)
      .leftJoin(classes, eq(classes.id, classId))
      .leftJoin(sections, eq(sections.id, sectionId))
      .leftJoin(studentPhotos, eq(studentPhotos.studentId, students.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit + 1)
      .offset(offset);

    const page = rows.slice(0, limit);
    // The roster already authorised these students, so their photos may be
    // linked (ADR-063). Every scope here belongs to one organisation.
    const photos = await storageService.imageRefs(
      scopes[0]?.organizationId ?? "",
      page.map((row) => row.photoObjectId),
    );

    return {
      rows: page.map(({ yearStatus, latestStatus, photoObjectId, ...row }) => ({
        ...row,
        photo: photoObjectId ? (photos.get(photoObjectId) ?? null) : null,
        // A student who has gone is described by how they left, even in an older
        // session's list; otherwise the selected year says what's happening.
        enrollmentStatus:
          row.status === "inactive" ? latestStatus : (yearStatus ?? latestStatus),
      })),
      nextCursor: rows.length > limit ? offset + limit : null,
    };
  }

  /**
   * Every student the list shows, in the list's order, ids only: what the ID-card
   * print reads instead of the phone's loaded pages. Stops at `max` rows; the
   * caller asks for one more than it allows, to know when there are too many.
   */
  async listRosterIds(
    scopes: DataScope[],
    input: Omit<StudentRosterInput, "limit" | "cursor">,
    max: number,
  ): Promise<string[]> {
    const source = rosterSource(scopes, input.academicYearId);
    const { year, latest } = source;
    const { classId, sectionId, where, orderBy } = rosterQueryParts(source, input);

    const rows = await db
      .select({ id: students.id })
      .from(students)
      .leftJoin(
        year,
        and(eq(year.studentId, students.id), eq(year.academicYearId, input.academicYearId)),
      )
      .leftJoinLateral(latest, sql`true`)
      .leftJoin(classes, eq(classes.id, classId))
      .leftJoin(sections, eq(sections.id, sectionId))
      .leftJoin(studentPhotos, eq(studentPhotos.studentId, students.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(max);
    return rows.map((row) => row.id);
  }

  /** The counts on the Students tab: its views, and who needs attention. */
  async rosterSummary(
    scopes: DataScope[],
    academicYearId: string,
  ): Promise<StudentRosterSummary> {
    const { year, latest, scopeFilter, hasGuardian, views } = rosterSource(
      scopes,
      academicYearId,
    );
    const count = (condition: SQL | undefined) =>
      condition
        ? sql<number>`count(*) filter (where ${condition})::int`
        : sql<number>`count(*)::int`;

    const [row] = await db
      .select({
        current: count(views.current),
        notPlaced: count(views.notPlaced),
        left: count(views.left),
        alumni: count(views.alumni),
        all: count(undefined),
        noSection: count(eq(year.enrollmentStatus, "admitted")),
        noGuardian: count(and(views.current, sql`not ${hasGuardian}`)),
        noPhoto: count(and(views.current, isNull(studentPhotos.id))),
      })
      .from(students)
      .leftJoin(
        year,
        and(eq(year.studentId, students.id), eq(year.academicYearId, academicYearId)),
      )
      .leftJoinLateral(latest, sql`true`)
      .leftJoin(studentPhotos, eq(studentPhotos.studentId, students.id))
      .where(scopeFilter);

    const admissionYear = sql<number>`extract(year from ${students.admissionDate})::int`;
    const years = await db
      .selectDistinct({ year: admissionYear })
      .from(students)
      .leftJoin(
        year,
        and(eq(year.studentId, students.id), eq(year.academicYearId, academicYearId)),
      )
      .where(and(scopeFilter, isNotNull(students.admissionDate)))
      .orderBy(desc(admissionYear));

    return {
      admissionYears: years.map((row) => row.year),
      counts: {
        current: row?.current ?? 0,
        notPlaced: row?.notPlaced ?? 0,
        left: row?.left ?? 0,
        alumni: row?.alumni ?? 0,
        all: row?.all ?? 0,
      },
      attention: {
        noSection: row?.noSection ?? 0,
        noGuardian: row?.noGuardian ?? 0,
        noPhoto: row?.noPhoto ?? 0,
      },
    };
  }

  /**
   * The owning branch of a student — the B6 resolution layer's adapter, same
   * shape as `getSubjectOwnerId`. Authorization-neutral by design: this
   * answers "who owns it", never "may you see it".
   */
  async getStudentOwnerId(
    organizationId: string,
    studentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: students.schoolId })
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          eq(students.organizationId, organizationId),
        ),
      );

    return row?.schoolId ?? null;
  }
}

export const studentService = new StudentService();
