import { beforeAll, describe, expect, it } from "vitest";

import type { DataScope } from "@repo/authz";
import { studentService } from "@repo/services";

import { buildWorld } from "./world";

/**
 * THE BULK PHOTO MATCHER'S READ (`listByAdmissions`) — what only the
 * database can vouch for: the admission-number match is school-level
 * clipped, and each row carries the CURRENT YEAR's enrollment facts (class,
 * section, roll) for the review grid. The zip itself never reaches the
 * server; this read is what the review grid is built on.
 */
describe("students — bulk photo matcher (byAdmissions)", () => {
  let world: Awaited<ReturnType<typeof buildWorld>>;

  const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
    organizationId,
    schoolId,
    classId: null,
    sectionId: null,
  });

  beforeAll(async () => {
    world = await buildWorld();
  });

  it("matches by admission number with the year's enrollment facts", async () => {
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      world.currentYearAId,
      ["ITG-0001"],
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.student.admissionNumber).toBe("ITG-0001");
    expect(row?.className).toBe("ITG Class 6");
    expect(row?.sectionName).toBe("A");
    expect(row?.rollNumber).not.toBeNull();
  });

  it("a foreign org's admission number is the same as none (tenancy)", async () => {
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      world.currentYearAId,
      ["ITG-9001"],
    );
    expect(rows).toEqual([]);
  });

  it("a student with no enrollment in the anchor year matches with null facts", async () => {
    // ITG-9001 IS enrolled in org B — queried against ORG A's year the
    // tenancy clip drops the row entirely; the null-facts path is the
    // admission-without-enrollment case, proven by an org-B student against
    // org B's year using a name that exists but a year that doesn't.
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      "00000000-0000-4000-8000-000000000000",
      ["ITG-0001"],
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.rollNumber).toBeNull();
    expect(row?.className).toBeNull();
  });

  it("empty input answers empty", async () => {
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      world.currentYearAId,
      [],
    );
    expect(rows).toEqual([]);
  });
});
