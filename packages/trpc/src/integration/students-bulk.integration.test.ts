import { beforeAll, describe, expect, it } from "vitest";

import type { DataScope } from "@repo/authz";
import { studentService } from "@repo/services";

import { buildWorld } from "./world";

/**
 * THE BULK PHOTO MATCHER'S READ (`listByAdmissions`) — what only the
 * database can vouch for: the admission-number match is school-level
 * clipped, so a foreign org's admission number is indistinguishable from a
 * name nobody uploaded. The zip itself never reaches the server; this read
 * is what the review grid is built on.
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

  it("matches by admission number inside the caller's org", async () => {
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      ["ITG-0001"],
    );
    expect(rows.map((row) => row.admissionNumber)).toEqual(["ITG-0001"]);
  });

  it("a foreign org's admission number is the same as none (tenancy)", async () => {
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      ["ITG-9001"],
    );
    expect(rows).toEqual([]);
  });

  it("empty input answers empty", async () => {
    const rows = await studentService.listByAdmissions(
      schoolScope(world.orgAId, world.schoolA1Id),
      [],
    );
    expect(rows).toEqual([]);
  });
});
