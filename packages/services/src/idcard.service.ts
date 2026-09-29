import type {
  CreateIdCardTemplateInput,
  IdCardStudentCard,
  UpdateIdCardTemplateInput,
} from "@repo/contracts";
import type { DataScope, ScopeColumns } from "@repo/authz";
import { atSchoolLevel, requireSchoolId } from "./academic.service";
import { scopeWhere } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  guardians,
  idCardTemplates,
  schools,
  sections,
  storageObjects,
  studentEnrollments,
  studentGuardians,
  studentPhotos,
  students,
} from "@repo/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

/**
 * ID CARDS — template CRUD, the starter-design adopt, and the card-data
 * resolver (slice 2a). The design document itself (canvas/elements) is a
 * CONTRACT concern (`id_card.contract.ts`); this service owns tenancy, the
 * one-default invariant, and the payload the client renders against.
 *
 * The client never invents card data — same principle as fees: the server
 * owns the truth, the browser only lays it out. `cardData` is therefore a
 * first-class read with its own permission (`id_card:print`), not a
 * client-side join the print page improvises.
 *
 * Tenancy (hard rule 1): templates filter by the SCHOOL scope (school-level
 * entity — an `atSchoolLevel`-widened read like years and subjects); card
 * data filters by the ENROLLMENT columns, where the class/section dimensions
 * are real and NO widening happens (the roster precedent).
 */

const TEMPLATE_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: idCardTemplates.organizationId,
  schoolId: idCardTemplates.schoolId,
};

/** The enrollment table expresses all four levels — the roster query's filter. */
const CARD_ENROLLMENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
};

export class IdCardService {
  // ── Templates ───────────────────────────────────────────────────────────

  /**
   * The school's templates — every status, because 2b's management surface
   * must list closed designs to re-open them; consumers that only render
   * filter client-side on `status`/`isPublished`. Default first, then name.
   */
  async listTemplates(scopes: DataScope[]) {
    return db
      .select()
      .from(idCardTemplates)
      .where(
        scopeWhere(scopes.map(atSchoolLevel), TEMPLATE_SCOPE_COLUMNS),
      )
      .orderBy(desc(idCardTemplates.isDefault), asc(idCardTemplates.name));
  }

  async getTemplateById(scope: DataScope, templateId: string) {
    const [row] = await db
      .select()
      .from(idCardTemplates)
      .where(
        and(
          eq(idCardTemplates.id, templateId),
          scopeWhere(atSchoolLevel(scope), TEMPLATE_SCOPE_COLUMNS),
        ),
      );

    return row ?? null;
  }

  /**
   * Creates a template (designer save, or an adopt — adopting IS creating,
   * from a starter constant instead of a designer session). Setting
   * `isDefault` clears the previous default in the SAME transaction; the
   * partial unique index `id_card_templates_school_default_uq` is the
   * concurrency backstop. A duplicate name is refused by
   * `id_card_templates_school_name_uq`, not pre-checked (ADR-022).
   */
  async createTemplate(
    scope: DataScope,
    input: CreateIdCardTemplateInput,
    userId: string,
  ) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      if (input.isDefault) {
        await tx
          .update(idCardTemplates)
          .set({ isDefault: false })
          .where(
            and(
              eq(idCardTemplates.schoolId, schoolId),
              eq(idCardTemplates.organizationId, scope.organizationId),
            ),
          );
      }

      const [row] = await tx
        .insert(idCardTemplates)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          name: input.name,
          orientation: input.orientation,
          canvas: input.canvas,
          elements: input.elements,
          isDefault: input.isDefault,
          createdBy: userId,
        })
        .returning();

      if (!row) throw new Error("Failed to create the template.");
      return row;
    });
  }

  /**
   * Design edits and the default flag. Same default-clearing transaction as
   * create; a null return is the router's NOT_FOUND (a foreign-branch id and
   * a made-up one are the same miss).
   */
  async updateTemplate(
    scope: DataScope,
    templateId: string,
    input: UpdateIdCardTemplateInput,
  ) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      if (input.isDefault) {
        await tx
          .update(idCardTemplates)
          .set({ isDefault: false })
          .where(
            and(
              eq(idCardTemplates.schoolId, schoolId),
              eq(idCardTemplates.organizationId, scope.organizationId),
            ),
          );
      }

      const [row] = await tx
        .update(idCardTemplates)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.orientation !== undefined
            ? { orientation: input.orientation }
            : {}),
          ...(input.canvas !== undefined ? { canvas: input.canvas } : {}),
          ...(input.elements !== undefined ? { elements: input.elements } : {}),
          ...(input.isDefault !== undefined
            ? { isDefault: input.isDefault }
            : {}),
        })
        .where(
          and(
            eq(idCardTemplates.id, templateId),
            eq(idCardTemplates.schoolId, schoolId),
            eq(idCardTemplates.organizationId, scope.organizationId),
          ),
        )
        .returning();

      return row ?? null;
    });
  }

  /**
   * Moves the school's default flag. Refuses a foreign or closed template
   * with the same null the other id-addressed reads use.
   */
  async setDefault(scope: DataScope, templateId: string) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: idCardTemplates.id, status: idCardTemplates.status })
        .from(idCardTemplates)
        .where(
          and(
            eq(idCardTemplates.id, templateId),
            eq(idCardTemplates.schoolId, schoolId),
            eq(idCardTemplates.organizationId, scope.organizationId),
          ),
        );

      if (!existing || existing.status !== "active") return null;

      await tx
        .update(idCardTemplates)
        .set({ isDefault: false })
        .where(
          and(
            eq(idCardTemplates.schoolId, schoolId),
            eq(idCardTemplates.organizationId, scope.organizationId),
          ),
        );

      const [row] = await tx
        .update(idCardTemplates)
        .set({ isDefault: true })
        .where(eq(idCardTemplates.id, templateId))
        .returning();

      return row ?? null;
    });
  }

  // ── Card data ───────────────────────────────────────────────────────────

  /**
   * THE PAYLOAD. Given a session, an optional class/section narrowing, and an
   * optional explicit selection, resolves everything a card can bind to:
   * identity (registry), the year anchor (class/section/roll), guardians
   * (father-or-primary + mother), the photo object, and the two contextual
   * fields (school name, session end date as validTill). Missing facts render
   * as null — the CARD shows an empty slot, the request never fails for one
   * student's missing blood group.
   *
   * Active students only (hard rule 2's registry semantics — a leaving child
   * is not printed). Roster filter is NO-widening: each caller sees exactly
   * the enrollments their grant reaches.
   */
  async cardData(
    scope: DataScope,
    input: {
      academicYearId: string;
      classId?: string;
      sectionId?: string;
      studentIds?: string[];
    },
  ): Promise<IdCardStudentCard[]> {
    const schoolId = requireSchoolId(scope);

    // Both contextual rows are re-read INSIDE the school's own columns — a
    // foreign year id or school id is the same empty result as a bad one.
    const [school] = await db
      .select({ name: schools.name })
      .from(schools)
      .where(
        and(
          eq(schools.id, schoolId),
          eq(schools.organizationId, scope.organizationId),
        ),
      );
    if (!school) {
      throw new Error("School not found in this organisation.");
    }

    const [year] = await db
      .select({ name: academicYears.name, endDate: academicYears.endDate })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, input.academicYearId),
          eq(academicYears.schoolId, schoolId),
          eq(academicYears.organizationId, scope.organizationId),
        ),
      );
    if (!year) {
      throw new Error("Academic year not found in this school.");
    }

    const rows = await db
      .select({
        student: students,
        enrollment: {
          rollNumber: studentEnrollments.rollNumber,
          classId: studentEnrollments.classId,
          sectionId: studentEnrollments.sectionId,
        },
        className: classes.name,
        sectionName: sections.name,
        photoObjectId: studentPhotos.objectId,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(studentEnrollments.studentId, students.id))
      .innerJoin(classes, eq(studentEnrollments.classId, classes.id))
      .innerJoin(sections, eq(studentEnrollments.sectionId, sections.id))
      .leftJoin(studentPhotos, eq(studentPhotos.studentId, students.id))
      .where(
        and(
          eq(studentEnrollments.academicYearId, input.academicYearId),
          input.classId
            ? eq(studentEnrollments.classId, input.classId)
            : undefined,
          input.sectionId
            ? eq(studentEnrollments.sectionId, input.sectionId)
            : undefined,
          input.studentIds?.length
            ? inArray(studentEnrollments.studentId, input.studentIds)
            : undefined,
          eq(students.status, "active"),
          scopeWhere(scope, CARD_ENROLLMENT_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(classes.numericOrder), asc(sections.name), asc(students.lastName));

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.student.id);
    const guardianRows = await db
      .select({
        studentId: studentGuardians.studentId,
        relation: studentGuardians.relation,
        isPrimary: studentGuardians.isPrimary,
        firstName: guardians.firstName,
        lastName: guardians.lastName,
      })
      .from(studentGuardians)
      .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
      .where(
        and(
          inArray(studentGuardians.studentId, ids),
          // Open links only — a closed custody row is not who collects the
          // child today.
          isNull(studentGuardians.endedOn),
        ),
      );

    const fullName = (first: string, last: string | null) =>
      last ? `${first} ${last}` : first;

    const byStudent = new Map<string, IdCardStudentCard>();
    for (const row of rows) {
      const links = guardianRows.filter((g) => g.studentId === row.student.id);
      const father = links.find((g) => g.relation === "father");
      const mother = links.find((g) => g.relation === "mother");
      const primary =
        links.find((g) => g.isPrimary) ?? father ?? links[0] ?? null;

      const addressParts = [
        row.student.addressLine1,
        row.student.addressLine2,
        row.student.city,
        row.student.state,
        row.student.pincode,
      ].filter((part): part is string => Boolean(part));

      byStudent.set(row.student.id, {
        studentId: row.student.id,
        name: fullName(row.student.firstName, row.student.lastName),
        admissionNumber: row.student.admissionNumber,
        rollNumber: row.enrollment.rollNumber,
        className: row.className,
        sectionName: row.sectionName,
        academicYear: year.name,
        dateOfBirth: row.student.dateOfBirth,
        bloodGroup: row.student.bloodGroup,
        address: addressParts.length > 0 ? addressParts.join(", ") : null,
        guardianName: primary ? fullName(primary.firstName, primary.lastName) : null,
        motherName: mother ? fullName(mother.firstName, mother.lastName) : null,
        validTill: year.endDate,
        photoObjectId: row.photoObjectId ?? null,
        schoolName: school.name,
      });
    }

    // Return in the roster order the query produced.
    return rows
      .map((r) => byStudent.get(r.student.id))
      .filter((card): card is IdCardStudentCard => card !== undefined);
  }

  // ── The student photo ───────────────────────────────────────────────────

  /**
   * Points `student_photos` at a fresh object (the upload flow's write half).
   * One transaction: upsert the row (the unique student index makes this an
   * update for a re-upload), then delete the REPLACED object's bytes — never
   * before the pointer moved, so a crash mid-flow leaves two objects and one
   * pointer, never a pointer with no bytes.
   */
  async setStudentPhoto(
    scope: DataScope,
    studentId: string,
    objectId: string,
    userId: string,
  ): Promise<void> {
    const schoolId = requireSchoolId(scope);

    // The student must exist INSIDE this school — the FK proves existence,
    // never tenancy.
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          eq(students.organizationId, scope.organizationId),
          eq(students.schoolId, schoolId),
        ),
      );
    if (!student) {
      throw new Error("Student not found in this school.");
    }

    // The replaced pointer, read BEFORE the upsert — after it, the old id is
    // gone. (One live row per student, so this is at most one.)
    const [existing] = await db
      .select({ objectId: studentPhotos.objectId })
      .from(studentPhotos)
      .where(eq(studentPhotos.studentId, studentId));

    await db.transaction(async (tx) => {
      await tx
        .insert(studentPhotos)
        .values({ studentId, objectId, uploadedBy: userId })
        .onConflictDoUpdate({
          target: studentPhotos.studentId,
          set: { objectId, uploadedBy: userId, updatedAt: new Date() },
        });

      // Bytes of the REPLACED object go only after the pointer moved, inside
      // the same transaction — a crash mid-flow leaves two objects and one
      // pointer, never a pointer with no bytes. The new object (the just-set
      // pointer) is exempt by the id comparison.
      if (existing && existing.objectId !== objectId) {
        await tx
          .delete(storageObjects)
          .where(
            and(
              eq(storageObjects.id, existing.objectId),
              eq(storageObjects.organizationId, scope.organizationId),
            ),
          );
      }
    });
  }

  /**
   * Removes the student's photo: the pointer row goes and the bytes go with
   * it. Hard rule 2 does not cover photo blobs (ADR-038 §4) — the printed
   * card is the record.
   */
  async removeStudentPhoto(scope: DataScope, studentId: string): Promise<boolean> {
    const schoolId = requireSchoolId(scope);

    const [photo] = await db
      .select({ objectId: studentPhotos.objectId })
      .from(studentPhotos)
      .innerJoin(students, eq(studentPhotos.studentId, students.id))
      .where(
        and(
          eq(studentPhotos.studentId, studentId),
          eq(students.organizationId, scope.organizationId),
          eq(students.schoolId, schoolId),
        ),
      );

    if (!photo) return false;

    await db.transaction(async (tx) => {
      await tx
        .delete(studentPhotos)
        .where(eq(studentPhotos.studentId, studentId));
      await tx
        .delete(storageObjects)
        .where(
          and(
            eq(storageObjects.id, photo.objectId),
            eq(storageObjects.organizationId, scope.organizationId),
          ),
        );
    });

    return true;
  }
}

export const idCardService = new IdCardService();
