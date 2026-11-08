import { beforeAll, describe, expect, it } from "vitest";

/**
 * STORAGE (ADR-063) against real Postgres and an in-memory bucket. What only
 * the database can vouch for:
 *
 *   - the upload flow: a handed-out link, a completed upload (re-encoded,
 *     refused when not an image), completing twice, and only the uploader
 *     completing;
 *   - attaching: only to the parent a file was uploaded for, re-linking to
 *     the same parent, and never to another organisation;
 *   - the sweeper: abandoned uploads, unattached files and deleted files go,
 *     bytes and rows; a file a record still uses is never deleted, only
 *     unmarked.
 *
 * FIXTURE ISOLATION: borrows the authz world (orgs and users) and adds its
 * own storage rows, which it owns outright (storage rows are not under hard
 * rule 2).
 */

import { db } from "@repo/db";
import {
  idCardTemplateAssets,
  orgPublicSites,
  publicSiteMedia,
  storageObjects,
  studentPhotos,
} from "@repo/db/schema";
import {
  idCardService,
  publicSiteService,
  storageService,
  storageWorkerService,
} from "@repo/services";
import { eq, sql } from "drizzle-orm";
import { TINY_PNG, useMemoryStore } from "./storage-fixtures";
import { buildWorld } from "./world";

type World = Awaited<ReturnType<typeof buildWorld>>;
let world: World;
let store: ReturnType<typeof useMemoryStore>;

const tmpKey = (id: string) => `tmp/${id}`;

async function uploadFor(parentId: string | null, userId = world.users.adminA, bytes = TINY_PNG) {
  const [ticket] = await storageService.createUploads({
    organizationId: world.orgAId,
    schoolId: world.schoolA1Id,
    purpose: "student_photo",
    parentId,
    uploadedBy: userId,
    files: [{ contentType: "image/png", sizeBytes: bytes.length }],
  });
  if (!ticket) throw new Error("no ticket");
  // What the client's PUT does.
  await store.put("private", tmpKey(ticket.objectId), bytes, {
    contentType: "image/png",
    cacheControl: "no-store",
  });
  return ticket;
}

async function age(objectId: string, column: "created_at" | "ready_at") {
  await db.execute(
    sql`UPDATE storage_objects SET ${sql.identifier(column)} = now() - interval '2 days' WHERE id = ${objectId}`,
  );
}

beforeAll(async () => {
  store = useMemoryStore();
  world = await buildWorld();
}, 120_000);

describe("uploads", () => {
  it("hand out a link, then process the file into the purpose's versions", async () => {
    const ticket = await uploadFor(world.ownedStudentId);
    expect(ticket.method).toBe("PUT");
    expect(ticket.headers).toEqual({ "Content-Type": "image/png" });

    const [done] = await storageService.complete(world.users.adminA, [ticket.objectId]);
    expect(done?.ok).toBe(true);
    if (!done?.ok) return;
    expect(done.image.id).toBe(ticket.objectId);
    expect(done.image.url).toContain(
      `/${world.orgAId}/student_photo/${ticket.objectId}/display.webp`,
    );

    // The raw upload is gone; the processed version is what is stored.
    expect(await store.head("private", tmpKey(ticket.objectId))).toBeNull();
    const meta = await storageService.getMeta(world.orgAId, ticket.objectId);
    expect(meta).toMatchObject({ status: "ready", contentType: "image/webp" });

    // Completing twice answers the same file.
    const [again] = await storageService.complete(world.users.adminA, [ticket.objectId]);
    expect(again?.ok).toBe(true);
  });

  it("only the uploader can complete an upload", async () => {
    const ticket = await uploadFor(world.ownedStudentId);
    const [other] = await storageService.complete(world.users.adminB, [ticket.objectId]);
    expect(other?.ok).toBe(false);
    expect((await storageService.getMeta(world.orgAId, ticket.objectId))?.status).toBe("pending");
  });

  it("refuse a file that is not an image, and mark it for the sweeper", async () => {
    const ticket = await uploadFor(
      world.ownedStudentId,
      world.users.adminA,
      Buffer.from("<script>"),
    );
    const [done] = await storageService.complete(world.users.adminA, [ticket.objectId]);
    expect(done).toMatchObject({ ok: false });
    expect((await storageService.getMeta(world.orgAId, ticket.objectId))?.status).toBe("deleted");
    expect(await store.head("private", tmpKey(ticket.objectId))).toBeNull();
  });

  it("refuse a file over the purpose's size before downloading it", async () => {
    await expect(
      storageService.createUploads({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        purpose: "fee_upi_qr",
        parentId: null,
        uploadedBy: world.users.adminA,
        files: [{ contentType: "image/png", sizeBytes: 3 * 1024 * 1024 }],
      }),
    ).rejects.toThrow("larger than 2 MB");
  });
});

describe("attaching", () => {
  it("links only to the parent the file was uploaded for, and re-links to the same one", async () => {
    const ticket = await uploadFor(world.ownedStudentId);
    await storageService.complete(world.users.adminA, [ticket.objectId]);

    // Another student is refused.
    await expect(
      db.transaction((tx) =>
        storageService.attach(tx, {
          organizationId: world.orgAId,
          purpose: "student_photo",
          parentId: world.section6bStudentId,
          userId: world.users.adminA,
          objectIds: [ticket.objectId],
        }),
      ),
    ).rejects.toThrow("can't be used here");

    const link = () =>
      db.transaction((tx) =>
        storageService.attach(tx, {
          organizationId: world.orgAId,
          purpose: "student_photo",
          parentId: world.ownedStudentId,
          userId: world.users.adminA,
          objectIds: [ticket.objectId],
        }),
      );
    await link();
    // Re-saving the same record keeps its file.
    await link();

    // Another organisation can never link it.
    await expect(
      db.transaction((tx) =>
        storageService.attach(tx, {
          organizationId: world.orgBId,
          purpose: "student_photo",
          parentId: world.ownedStudentId,
          userId: world.users.adminA,
          objectIds: [ticket.objectId],
        }),
      ),
    ).rejects.toThrow("can't be used here");
  });
});

describe("the sweeper", () => {
  it("removes abandoned uploads, unattached files and deleted files — rows and bytes", async () => {
    const abandoned = await uploadFor(world.ownedStudentId);
    await age(abandoned.objectId, "created_at");

    const unattached = await uploadFor(world.ownedStudentId);
    await storageService.complete(world.users.adminA, [unattached.objectId]);
    await age(unattached.objectId, "ready_at");

    const deleted = await uploadFor(world.ownedStudentId);
    await storageService.complete(world.users.adminA, [deleted.objectId]);
    await storageService.markDeleted(db, world.orgAId, [deleted.objectId]);
    const [deletedRow] = await db
      .select({ path: storageObjects.path })
      .from(storageObjects)
      .where(eq(storageObjects.id, deleted.objectId));

    // Sweep until the backlog (other suites' rows included) is drained.
    for (let i = 0; i < 20; i++) {
      const result = await storageWorkerService.runSweep({ batch: 500 });
      if (result.abandonedUploads + result.unattachedFiles + result.deletedFiles === 0) break;
    }

    for (const id of [abandoned.objectId, unattached.objectId, deleted.objectId]) {
      expect(await storageService.getMeta(world.orgAId, id)).toBeNull();
    }
    expect(await store.head("private", tmpKey(abandoned.objectId))).toBeNull();
    expect(await store.head("private", deletedRow!.path)).toBeNull();
  }, 120_000);

  it("never deletes a file a record still uses; it clears the mark instead", async () => {
    const photoId = await idCardService.uploadStudentPhoto(
      { organizationId: world.orgAId, schoolId: world.schoolA1Id, classId: null, sectionId: null },
      world.ownedStudentId,
      TINY_PNG,
      world.users.adminA,
    );
    // A buggy flow marks the live photo deleted.
    await storageService.markDeleted(db, world.orgAId, [photoId]);

    const result = await storageWorkerService.runSweep({ batch: 500 });
    expect(result.stillInUse).toContain(photoId);

    const meta = await storageService.getMeta(world.orgAId, photoId);
    expect(meta?.status).toBe("ready");
    const [pointer] = await db
      .select({ objectId: studentPhotos.objectId })
      .from(studentPhotos)
      .where(eq(studentPhotos.studentId, world.ownedStudentId));
    expect(pointer?.objectId).toBe(photoId);
    expect(await storageService.getBytes(world.orgAId, photoId)).not.toBeNull();
  }, 120_000);
});

describe("ID-card template images", () => {
  it("a saved design links its background; dropping it lets the file go", async () => {
    const scope = {
      organizationId: world.orgAId,
      schoolId: world.schoolA1Id,
      classId: null,
      sectionId: null,
    };
    const ticket = await idCardService.templateAssetUpload(
      scope,
      { contentType: "image/png", sizeBytes: TINY_PNG.length },
      world.users.adminA,
    );
    await store.put("private", tmpKey(ticket.objectId), TINY_PNG, {
      contentType: "image/png",
      cacheControl: "no-store",
    });

    const template = await idCardService.createTemplate(
      scope,
      {
        name: `Storage ITG ${Date.now()}`,
        orientation: "landscape",
        canvas: { backgroundAssetId: ticket.objectId },
        elements: [],
        isDefault: false,
      },
      world.users.adminA,
    );
    const linked = await db
      .select()
      .from(idCardTemplateAssets)
      .where(eq(idCardTemplateAssets.templateId, template.id));
    expect(linked.map((row) => row.objectId)).toEqual([ticket.objectId]);
    const [withImages] = await idCardService.withImages([template]);
    expect(withImages?.images[ticket.objectId]?.url).toContain("/id_card_asset/");

    await idCardService.updateTemplate(
      scope,
      template.id,
      { canvas: { backgroundAssetId: null } },
      world.users.adminA,
    );
    expect(
      await db.select().from(idCardTemplateAssets).where(eq(idCardTemplateAssets.templateId, template.id)),
    ).toHaveLength(0);
    expect((await storageService.getMeta(world.orgAId, ticket.objectId))?.status).toBe("deleted");
  });
});

describe("site images", () => {
  it("are stored as tokens, read back as links, and let go once no content uses them", async () => {
    const orgScope = { organizationId: world.orgAId, schoolId: null, classId: null, sectionId: null };
    await publicSiteService.ensureForOrg(world.orgAId);

    const ticket = await publicSiteService.imageUpload(
      orgScope,
      world.orgAId,
      { contentType: "image/png", sizeBytes: TINY_PNG.length },
      world.users.adminA,
    );
    await store.put("private", tmpKey(ticket.objectId), TINY_PNG, {
      contentType: "image/png",
      cacheControl: "no-store",
    });
    const { url } = await publicSiteService.imageReady(
      orgScope,
      world.orgAId,
      ticket.objectId,
      world.users.adminA,
    );
    expect(url).toContain(`/site_media/${ticket.objectId}/`);

    // The editor saves the link; the database keeps a token, never a URL.
    const content = { sections: [], chrome: { logo: url } } as never;
    await publicSiteService.saveDraft({ scope: orgScope, organizationId: world.orgAId, content });
    const [row] = await db
      .select({ draft: orgPublicSites.draftContent, id: orgPublicSites.id })
      .from(orgPublicSites)
      .where(eq(orgPublicSites.organizationId, world.orgAId));
    expect(row?.draft).toEqual({ sections: [], chrome: { logo: `storage:${ticket.objectId}` } });

    // Reading turns the token back into the link.
    const site = await publicSiteService.getForOrg(orgScope, world.orgAId);
    expect((site?.draftContent as { chrome: { logo: string } }).chrome.logo).toBe(url);

    // A draft without the image lets it go (nothing published uses it).
    await publicSiteService.saveDraft({
      scope: orgScope,
      organizationId: world.orgAId,
      content: { sections: [], chrome: { logo: "" } } as never,
    });
    expect(
      await db.select().from(publicSiteMedia).where(eq(publicSiteMedia.siteId, row!.id)),
    ).toHaveLength(0);
    expect((await storageService.getMeta(world.orgAId, ticket.objectId))?.status).toBe("deleted");
  });
});
