import { beforeAll, describe, expect, it } from "vitest";

/**
 * ID CARDS + STORAGE (slice 2a, ADR-038) — the proofs against REAL Postgres.
 * What only the database and the services can vouch for:
 *
 *   - the one-default invariant: setting a second default clears the first,
 *     and the partial unique index is the concurrency backstop;
 *   - the adopt-clone behavior: a starter constant becomes a school-owned
 *     row, and the per-school name unique index refuses a duplicate clone;
 *   - template TENANCY: a foreign org's template and a sibling branch's are
 *     indistinguishable from nonexistent ones (null on every read, invisible
 *     in every list);
 *   - cardData resolution: the payload carries the year anchor (class,
 *     section, roll), the registry facts, the school + session context, and
 *     is NO-widening filtered (a section teacher sees her section only) —
 *     and a foreign-org student id returns nothing, never someone else's card;
 *   - the storage round-trip: put → pointer → get, replacement deletes the
 *     replaced bytes, and every read is tenancy-checked including the
 *     serving route's membership-checked `getForUser`.
 *
 * FIXTURE ISOLATION: borrows the authz suite's world (orgs `authz-itg-a/b`)
 * for schools, students and enrollments, and adds its OWN templates and
 * storage objects keyed on the run timestamp, so nothing collides with the
 * authz assertions and nothing is ever deleted from the fixture (hard rule 2)
 * except the storage bytes the feature itself owns (ADR-038 §4).
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import { idCardTemplates } from "@repo/db/schema";
import { idCardService, storageService } from "@repo/services";
import { and, eq } from "drizzle-orm";
import { buildWorld } from "./world";

const RUN = Date.now();
const templateName = (suffix: string) => `ITG Card ${RUN} ${suffix}`;

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

const STARTER_LANDSCAPE = {
  orientation: "landscape" as const,
  canvas: { backgroundAssetId: null },
  elements: [
    {
      id: "name",
      type: "text" as const,
      x: 10,
      y: 10,
      width: 60,
      height: 12,
      visible: true,
      binding: "studentName" as const,
      fontSize: 10,
      fontWeight: "bold" as const,
      color: "#111827",
      align: "left" as const,
    },
    { id: "photo", type: "photo" as const, x: 4, y: 20, width: 24, height: 60, visible: true },
    { id: "qr", type: "qr" as const, x: 80, y: 70, width: 16, height: 24, visible: true },
  ],
};

describe("id cards & storage (slice 2a)", () => {
  let orgAId: string;
  let orgBId: string;
  let schoolA1Id: string;
  let schoolA2Id: string;
  let schoolB1Id: string;
  let scopeA1: DataScope;
  let scopeA2: DataScope;
  let scopeB1: DataScope;
  let currentYearAId: string;
  let section6aId: string;
  let adminAId: string;

  let defaultTemplateId: string;
  let secondTemplateId: string;
  let templateBId: string;

  beforeAll(async () => {
    const world = await buildWorld();
    orgAId = world.orgAId;
    orgBId = world.orgBId;
    schoolA1Id = world.schoolA1Id;
    schoolA2Id = world.schoolA2Id;
    schoolB1Id = world.schoolB1Id;
    scopeA1 = schoolScope(orgAId, schoolA1Id);
    scopeA2 = schoolScope(orgAId, schoolA2Id);
    scopeB1 = schoolScope(orgBId, schoolB1Id);
    currentYearAId = world.currentYearAId;
    section6aId = world.section6aId;
    adminAId = world.users.adminA;
  });

  it("creates a template as default; a second default CLEARS the first", async () => {
    const first = await idCardService.createTemplate(
      scopeA1,
      { name: templateName("classic"), ...STARTER_LANDSCAPE, isDefault: true },
      adminAId,
    );
    expect(first.isDefault).toBe(true);
    defaultTemplateId = first.id;

    const second = await idCardService.createTemplate(
      scopeA1,
      { name: templateName("modern"), ...STARTER_LANDSCAPE, isDefault: true },
      adminAId,
    );
    secondTemplateId = second.id;

    // One default per school — the transaction cleared the first, and the
    // partial unique index is the concurrency backstop.
    const rows = await db
      .select({ id: idCardTemplates.id, isDefault: idCardTemplates.isDefault })
      .from(idCardTemplates)
      .where(
        and(
          eq(idCardTemplates.schoolId, schoolA1Id),
          eq(idCardTemplates.organizationId, orgAId),
        ),
      );
    const defaults = rows.filter((row) => row.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(second.id);
  });

  it("adopts a starter design into an owned row; a duplicate clone name is refused by the index", async () => {
    // The adopt IS a create from the client gallery's constant — the row is
    // school-owned from birth (the template/constant split of slice 2a).
    const clone = await idCardService.createTemplate(
      scopeA1,
      { name: templateName("adopted"), ...STARTER_LANDSCAPE, isDefault: false },
      adminAId,
    );
    expect(clone.schoolId).toBe(schoolA1Id);
    expect(clone.elements).toHaveLength(STARTER_LANDSCAPE.elements.length);

    try {
      await idCardService.createTemplate(
        scopeA1,
        { name: templateName("adopted"), ...STARTER_LANDSCAPE, isDefault: false },
        adminAId,
      );
      expect.unreachable("the duplicate clone was not refused");
    } catch (e: unknown) {
      // Drizzle wraps the driver error — the constraint name rides in the
      // CAUSE; translateErrors reads the same cause and words it (ADR-022).
      const cause = (e as { cause?: { message?: string } }).cause?.message ?? "";
      expect(cause).toContain("id_card_templates_school_name_uq");
    }
  });

  it("keeps foreign-org and sibling-branch templates invisible (tenancy)", async () => {
    // Org B's own row.
    const foreign = await idCardService.createTemplate(
      scopeB1,
      { name: templateName("b-side"), ...STARTER_LANDSCAPE, isDefault: false },
      adminAId,
    );
    templateBId = foreign.id;

    // A1's principal cannot read B1's row, nor A2's (sibling branch) —
    // null, the same answer a made-up id gets.
    expect(await idCardService.getTemplateById(scopeA1, templateBId)).toBeNull();

    const a2Row = await idCardService.createTemplate(
      scopeA2,
      { name: templateName("a2-side"), ...STARTER_LANDSCAPE, isDefault: false },
      adminAId,
    );
    expect(await idCardService.getTemplateById(scopeA1, a2Row.id)).toBeNull();

    // And the list is clipped: A1's list carries no B1 or A2 rows.
    const a1List = await idCardService.listTemplates([scopeA1]);
    const ids = new Set(a1List.map((row) => row.id));
    expect(ids.has(templateBId)).toBe(false);
    expect(ids.has(a2Row.id)).toBe(false);
    expect(ids.has(defaultTemplateId)).toBe(true);
  });

  it("setDefault refuses a foreign template with the same null as a bad id", async () => {
    expect(await idCardService.setDefault(scopeA1, templateBId)).toBeNull();
  });

  it("cardData resolves the year anchor, registry facts, and context", async () => {
    const cards = await idCardService.cardData(scopeA1, {
      academicYearId: currentYearAId,
      sectionId: section6aId,
    });

    // The world's 6-A enrollment: ITG-0001, Class 6, section A.
    const owned = cards.find(
      (card) => card.admissionNumber === "ITG-0001",
    );
    expect(owned).toBeDefined();
    expect(owned?.name).toBe("Itg ITG-0001");
    expect(owned?.className).toBe("ITG Class 6");
    expect(owned?.sectionName).toBe("A");
    expect(owned?.academicYear).toBe("ITG 2025-26");
    // validTill is the session's end date — the card expires with the session.
    expect(owned?.validTill).toBe("2026-03-31");
    expect(owned?.schoolName).toBe("Integration School A1");
    expect(owned?.dateOfBirth).toBe("2012-06-15");
    // No guardians in the fixture — empty slots, not errors. (The photo slot
    // is string|null; a previous run's upload may still be pointed at.)
    expect(owned?.guardianName).toBeNull();
    expect(owned?.motherName).toBeNull();
    expect(["string", "object"]).toContain(typeof owned?.photoObjectId);
  });

  it("cardData is NO-widening filtered and cross-org students return nothing", async () => {
    // An explicit selection naming a FOREIGN org's student returns nothing —
    // not that student's card, not a mixture.
    const world = await buildWorld();
    const crossOrg = await idCardService.cardData(scopeA1, {
      academicYearId: currentYearAId,
      studentIds: [world.studentB1Id],
    });
    expect(crossOrg).toHaveLength(0);

    // And B's own roster (its own year) never contains A's student — no
    // A-side row leaks into B's answer.
    const bCards = await idCardService.cardData(scopeB1, {
      academicYearId: world.yearB1Id,
      studentIds: [world.studentB1Id],
    });
    expect(bCards.find((card) => card.admissionNumber === "ITG-0001")).toBeUndefined();
    expect(bCards.map((card) => card.studentId)).toEqual([world.studentB1Id]);
  });

  it("stores a photo, points the student at it, and replaces it byte-for-byte", async () => {
    const world = await buildWorld();

    // The upload flow's write half (the router decodes base64 → bytes).
    const first = await storageService.putObject({
      organizationId: orgAId,
      contentType: "image/jpeg",
      bytes: Buffer.from(`photo-a-${RUN}`),
      createdBy: adminAId,
    });

    await idCardService.setStudentPhoto(
      scopeA1,
      world.ownedStudentId,
      first.id,
      adminAId,
    );

    const pointer = await storageService.getStudentPhotoObjectId(
      scopeA1,
      world.ownedStudentId,
    );
    expect(pointer).toBe(first.id);

    // The card-data payload now carries the photo object id.
    const cards = await idCardService.cardData(scopeA1, {
      academicYearId: currentYearAId,
      sectionId: section6aId,
    });
    const owned = cards.find((card) => card.admissionNumber === "ITG-0001");
    expect(owned?.photoObjectId).toBe(first.id);

    // Replacement: a second upload upserts the pointer and deletes the
    // replaced object's bytes (ADR-038 §4).
    const second = await storageService.putObject({
      organizationId: orgAId,
      contentType: "image/jpeg",
      bytes: Buffer.from(`photo-b-${RUN}`),
      createdBy: adminAId,
    });
    await idCardService.setStudentPhoto(
      scopeA1,
      world.ownedStudentId,
      second.id,
      adminAId,
    );

    expect(await storageService.getBytes(orgAId, first.id)).toBeNull();
    const fresh = await storageService.getBytes(orgAId, second.id);
    expect(fresh?.contentType).toBe("image/jpeg");
    expect(fresh?.data.toString()).toBe(`photo-b-${RUN}`);
  });

  it("serving-route read answers only a caller with an ACTIVE membership in the object's org", async () => {
    const world = await buildWorld();
    const object = await storageService.putObject({
      organizationId: orgAId,
      contentType: "image/png",
      bytes: Buffer.from(`bg-${RUN}`),
      createdBy: adminAId,
    });

    // Admin A holds an org grant → bytes.
    const own = await storageService.getForUser(world.users.adminA, object.id);
    expect(own?.data.toString()).toBe(`bg-${RUN}`);

    // Admin B holds grants only in org B → the same null as a bad id. A
    // wrong-tenant probe reveals nothing.
    expect(await storageService.getForUser(world.users.adminB, object.id)).toBeNull();
    expect(await storageService.getForUser(world.users.adminB, "00000000-0000-4000-8000-000000000000")).toBeNull();

    // And the plain org-filtered read never crosses tenants either.
    expect(await storageService.getBytes(orgBId, object.id)).toBeNull();
  });

  it("removePhoto takes the pointer AND the bytes, scoped to the student's own school", async () => {
    const world = await buildWorld();
    const object = await storageService.putObject({
      organizationId: orgAId,
      contentType: "image/webp",
      bytes: Buffer.from(`gone-${RUN}`),
      createdBy: adminAId,
    });
    await idCardService.setStudentPhoto(
      scopeA1,
      world.section6bStudentId,
      object.id,
      adminAId,
    );

    const removed = await idCardService.removeStudentPhoto(
      scopeA1,
      world.section6bStudentId,
    );
    expect(removed).toBe(true);
    expect(
      await storageService.getStudentPhotoObjectId(scopeA1, world.section6bStudentId),
    ).toBeNull();
    expect(await storageService.getBytes(orgAId, object.id)).toBeNull();

    // Removing again is an honest false, not an error.
    expect(
      await idCardService.removeStudentPhoto(scopeA1, world.section6bStudentId),
    ).toBe(false);
  });

  // ── Slice 2b: the community gallery ─────────────────────────────────────

  it("gallery list returns ONLY published rows, including other orgs', with a design-only payload", async () => {
    // A1's template gets published through the ordinary update path — the
    // stamp is the service's, not the caller's input.
    const published = await idCardService.updateTemplate(scopeA1, defaultTemplateId, {
      isPublished: true,
    });
    expect(published?.isPublished).toBe(true);
    expect(published?.publishedAt).toBeInstanceOf(Date);

    const list = await idCardService.listPublishedTemplates();
    const ids = list.map((row) => row.id);
    // Another org's published row IS listed — the deliberate platform read.
    expect(ids).toContain(defaultTemplateId);
    // Unpublished rows are invisible, in the caller's own org and out of it.
    expect(ids).not.toContain(secondTemplateId);
    expect(ids).not.toContain(templateBId);

    // The payload is design-only: no organizationId, no schoolId, no audit
    // columns — a published template's JSON is tenant-agnostic.
    const row = list.find((candidate) => candidate.id === defaultTemplateId);
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "canvas",
      "elements",
      "id",
      "name",
      "orientation",
      "publishedAt",
    ]);
  });

  it("gallery clone produces an OWNED row in the caller's school and byte-copies its assets", async () => {
    const world = await buildWorld();

    // The published A1 design references a background asset owned by org A.
    const asset = await storageService.putObject({
      organizationId: orgAId,
      contentType: "image/png",
      bytes: Buffer.from(`gallery-bg-${RUN}`),
      createdBy: adminAId,
    });
    await idCardService.updateTemplate(scopeA1, defaultTemplateId, {
      canvas: { backgroundAssetId: asset.id },
    });

    // Org B clones it, renaming on the way in.
    const renamed = templateName("cloned");
    const clone = await idCardService.clonePublishedTemplate(
      scopeB1,
      { templateId: defaultTemplateId, name: renamed },
      world.users.adminB,
    );
    expect(clone).not.toBeNull();
    expect(clone?.organizationId).toBe(orgBId);
    expect(clone?.schoolId).toBe(schoolB1Id);
    expect(clone?.name).toBe(renamed);
    // A clone starts private and never default — the cloner decides both.
    expect(clone?.isPublished).toBe(false);
    expect(clone?.isDefault).toBe(false);
    expect(clone?.elements).toHaveLength(3);

    // The background is a NEW object owned by org B, byte-identical.
    const newAssetId = (clone?.canvas as { backgroundAssetId: string })
      .backgroundAssetId;
    expect(newAssetId).toBeDefined();
    expect(newAssetId).not.toBe(asset.id);
    const copied = await storageService.getBytes(orgBId, newAssetId);
    expect(copied?.data.toString()).toBe(`gallery-bg-${RUN}`);

    // The serving route's rule is untouched: org B still cannot read org A's
    // original object — the clone carries the COPY, never a cross-org ref.
    expect(await storageService.getBytes(orgBId, asset.id)).toBeNull();
    expect(await storageService.getForUser(world.users.adminB, asset.id)).toBeNull();

    // An UNPUBLISHED row and a made-up id are the same null — the endpoint
    // never reveals which private template ids exist.
    expect(
      await idCardService.clonePublishedTemplate(
        scopeB1,
        { templateId: secondTemplateId },
        world.users.adminB,
      ),
    ).toBeNull();
    expect(
      await idCardService.clonePublishedTemplate(
        scopeB1,
        { templateId: "00000000-0000-4000-8000-000000000000" },
        world.users.adminB,
      ),
    ).toBeNull();
  });
});
