import { db } from "@repo/db";
import { students } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * STUDENTS — the people the whole product revolves around. Phase 2 slice 4
 * seeds this service with the B6 resolution adapter; the full staff/portal
 * surface arrives with the enrollment slice (S5), whose rows anchor a student
 * to a section for the year.
 *
 * No HTTP awareness. Every query is org-filtered, so a cross-tenant id and a
 * nonexistent one are indistinguishable downstream — the property that makes
 * cross-tenant probing useless.
 */
export class StudentService {
  /**
   * The owning branch of a student — the B6 resolution layer's adapter, same
   * shape as `getSubjectOwnerId`. A student is not a scope node; her owning
   * node is her school, read from the denormalised schoolId column.
   *
   * Authorization-neutral by design: this answers "who owns it", never "may
   * you see it".
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
