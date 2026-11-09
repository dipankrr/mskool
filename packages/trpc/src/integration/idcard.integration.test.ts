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
 *   - the photo round-trip (ADR-063, in-memory bucket): store → pointer →
 *     link, replacement marks the replaced file deleted, and every read is
 *     tenancy-checked.
 *
 * FIXTURE ISOLATION: borrows the authz suite's world (orgs `authz-itg-a/b`)
 * for schools, students and enrollments, and adds its OWN templates and
 * storage objects keyed on the run timestamp, so nothing collides with the
 * authz assertions and nothing is ever deleted from the fixture (hard rule 2)
 * except the storage files the feature itself owns (ADR-063).
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import { idCardTemplates } from "@repo/db/schema";
import { idCardPrintService, idCardService, storageService } from "@repo/services";
import { and, eq } from "drizzle-orm";
import { TINY_PNG, useMemoryStore } from "./storage-fixtures";
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
    expect(["object"]).toContain(typeof owned?.photo);
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

  it("stores a photo, points the student at it, and lets the replaced one go", async () => {
    useMemoryStore();
    const world = await buildWorld();

    const firstId = await idCardService.uploadStudentPhoto(
      scopeA1,
      world.ownedStudentId,
      TINY_PNG,
      adminAId,
    );
    expect(await storageService.getStudentPhotoObjectId(scopeA1, world.ownedStudentId)).toBe(firstId);

    // The card-data payload now carries the photo object id.
    const cards = await idCardService.cardData(scopeA1, {
      academicYearId: currentYearAId,
      sectionId: section6aId,
    });
    const owned = cards.find((card) => card.admissionNumber === "ITG-0001");
    expect(owned?.photo?.id).toBe(firstId);
    expect(owned?.photo?.url).toContain(`/student_photo/${firstId}/display.webp`);

    // Replacement re-points the row and marks the replaced file deleted;
    // the sweeper removes its bytes later.
    const secondId = await idCardService.uploadStudentPhoto(
      scopeA1,
      world.ownedStudentId,
      TINY_PNG,
      adminAId,
    );
    expect((await storageService.getMeta(orgAId, firstId))?.status).toBe("deleted");
    expect(await storageService.getBytes(orgAId, firstId)).toBeNull();
    const fresh = await storageService.getBytes(orgAId, secondId);
    // Re-encoded, never served as uploaded.
    expect(fresh?.contentType).toBe("image/webp");
  });

  it("refuses a photo uploaded for another student", async () => {
    useMemoryStore();
    const world = await buildWorld();
    const forOwned = await storageService.ingest({
      organizationId: orgAId,
      schoolId: world.schoolA1Id,
      purpose: "student_photo",
      parentId: world.ownedStudentId,
      uploadedBy: adminAId,
      bytes: TINY_PNG,
    });
    await expect(
      idCardService.setStudentPhoto(scopeA1, world.section6bStudentId, forOwned.id, adminAId),
    ).rejects.toThrow("can't be used here");
  });

  it("removePhoto takes the pointer and lets the file go, scoped to the student's own school", async () => {
    useMemoryStore();
    const world = await buildWorld();
    const objectId = await idCardService.uploadStudentPhoto(
      scopeA1,
      world.section6bStudentId,
      TINY_PNG,
      adminAId,
    );

    const removed = await idCardService.removeStudentPhoto(scopeA1, world.section6bStudentId);
    expect(removed).toBe(true);
    expect(
      await storageService.getStudentPhotoObjectId(scopeA1, world.section6bStudentId),
    ).toBeNull();
    expect((await storageService.getMeta(orgAId, objectId))?.status).toBe("deleted");

    // Removing again is an honest false, not an error.
    expect(
      await idCardService.removeStudentPhoto(scopeA1, world.section6bStudentId),
    ).toBe(false);
  });

  // ── Slice 2b: the community gallery ─────────────────────────────────────

  it("gallery list returns ONLY published rows, including other orgs', with a design-only payload", async () => {
    // A1's template gets published through the ordinary update path — the
    // stamp is the service's, not the caller's input.
    const published = await idCardService.updateTemplate(
      scopeA1,
      defaultTemplateId,
      { isPublished: true },
      adminAId,
    );
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

  it("gallery clone produces an OWNED row in the caller's school and copies its assets", async () => {
    useMemoryStore();
    const world = await buildWorld();

    // The published A1 design references a background asset owned by org A.
    const asset = await storageService.ingest({
      organizationId: orgAId,
      schoolId: world.schoolA1Id,
      purpose: "id_card_asset",
      parentId: null,
      uploadedBy: adminAId,
      bytes: TINY_PNG,
    });
    // Saving the design links the file to the template (ADR-063).
    await idCardService.updateTemplate(
      scopeA1,
      defaultTemplateId,
      { canvas: { backgroundAssetId: asset.id } },
      adminAId,
    );
    const [withImages] = await idCardService.withImages([
      (await idCardService.getTemplateById(scopeA1, defaultTemplateId))!,
    ]);
    expect(withImages?.images[asset.id]?.url).toContain(`/id_card_asset/${asset.id}/`);

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

    // The background is a NEW file owned by org B, identical to the source.
    const newAssetId = (clone?.canvas as { backgroundAssetId: string })
      .backgroundAssetId;
    expect(newAssetId).toBeDefined();
    expect(newAssetId).not.toBe(asset.id);
    const copied = await storageService.getBytes(orgBId, newAssetId);
    const original = await storageService.getBytes(orgAId, asset.id);
    expect(copied?.data.equals(original?.data ?? Buffer.alloc(0))).toBe(true);

    // Tenancy is untouched: org B still cannot read org A's original file —
    // the clone carries the COPY, never a cross-org ref.
    expect(await storageService.getBytes(orgBId, asset.id)).toBeNull();

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

  // ── Printing from the phone: the Students list in, finished HTML out ──────

  const sectionList = (academicYearId: string, sectionId: string) => ({
    academicYearId,
    sectionId,
    view: "current" as const,
    sort: "class" as const,
  });

  it("print summary counts the list's matches and who of them gets a card", async () => {
    const summary = await idCardPrintService.summary(scopeA1, sectionList(currentYearAId, section6aId));
    const cards = await idCardService.cardData(scopeA1, {
      academicYearId: currentYearAId,
      sectionId: section6aId,
    });
    expect(summary.printable).toBe(cards.length);
    expect(summary.matched).toBeGreaterThanOrEqual(summary.printable);
    expect(summary.limit).toBe(200);

    // The "left" view lists students who have gone: none of them print.
    const left = await idCardPrintService.summary(scopeA1, {
      academicYearId: currentYearAId,
      view: "left",
      sort: "name",
    });
    expect(left.printable).toBe(0);

    // The profile prints one card: the list narrowed to one student.
    const { ownedStudentId } = await buildWorld();
    const one = await idCardPrintService.summary(scopeA1, {
      ...sectionList(currentYearAId, section6aId),
      studentId: ownedStudentId,
    });
    expect(one.matched).toBe(1);
  });

  it("print document draws the list's cards on exact A4 with the default design", async () => {
    const document = await idCardPrintService.document(scopeA1, {
      list: sectionList(currentYearAId, section6aId),
      paper: { kind: "a4", columnGapMm: 4, rowGapMm: 4, marginXMm: 8, marginYMm: 8, flip: "long" },
    });
    expect(document.cardCount).toBeGreaterThan(0);
    expect(document.html).toContain("Itg ITG-0001");
    expect(document.html).toContain("@page{size:210mm 297mm;margin:0}");
    expect(document.width).toBeCloseTo((210 * 72) / 25.4);
    expect(document.fileName).toMatch(/^ID-cards-.*\.pdf$/);

    const cardSize = await idCardPrintService.document(scopeA1, {
      list: sectionList(currentYearAId, section6aId),
      templateId: defaultTemplateId,
      paper: { kind: "card" },
    });
    expect(cardSize.html).toContain("@page{size:86mm 54mm;margin:0}");
  });

  it("print never reaches past the caller's scope or another org's design", async () => {
    const world = await buildWorld();
    // A teacher held to 6-B asking for 6-A's list prints no one.
    const sixB: DataScope = {
      organizationId: orgAId,
      schoolId: schoolA1Id,
      classId: world.class6Id,
      sectionId: world.section6bId,
    };
    await expect(
      idCardPrintService.document(sixB, {
        list: sectionList(currentYearAId, section6aId),
        paper: { kind: "card" },
      }),
    ).rejects.toMatchObject({ name: "ServiceRefusal", code: "BAD_REQUEST" });

    // Org B naming org A's session and section finds no one either.
    const foreign = await idCardPrintService.summary(scopeB1, sectionList(currentYearAId, section6aId));
    expect(foreign.printable).toBe(0);

    // Another org's design is the same not found as a made-up one.
    await expect(
      idCardPrintService.document(scopeA1, {
        list: sectionList(currentYearAId, section6aId),
        templateId: templateBId,
        paper: { kind: "card" },
      }),
    ).rejects.toMatchObject({ name: "ServiceRefusal", code: "NOT_FOUND" });
  });
});
