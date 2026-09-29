import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import { roleAssignments, storageObjects, studentPhotos, students } from "@repo/db/schema";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { env } from "./env";
import { PHOTO_MAX_BYTES } from "@repo/contracts";
import { requireSchoolId } from "./academic.service";

/**
 * STORAGE — the object store behind the ADR-038 driver seam.
 *
 * The interface is put / get / delete (+meta). Driver A (`postgres`) keeps the
 * bytes in `storage_objects.data`; driver B (`r2`) is DECLARED, NOT BUILT —
 * selecting it fails loudly here, at the one seam a future R2 driver replaces.
 * Nothing outside this file knows or cares where bytes live, because every
 * reference in the system stores an OBJECT ID and every URL is the stable app
 * route `GET /api/storage/:id` — a driver migration is a byte copy plus an env
 * flip, never a URL migration.
 *
 * Tenancy is structural (hard rule 1): every method takes the organizationId
 * as a REQUIRED argument and filters by it, so a wrong-tenant id and a
 * nonexistent one are the same null. The one exception proves the rule —
 * `getForUser` exists for the serving route, which knows the CALLER but not
 * the object's org yet; it resolves the org first and then verifies the
 * caller's active membership INSIDE the service, answering null unless both
 * hold. No unfiltered row ever escapes.
 */

/** The decoded-byte ceiling, restated here as the service-side backstop. */
const MAX_UPLOAD_BYTES = PHOTO_MAX_BYTES;

interface PutObjectInput {
  organizationId: string;
  contentType: string;
  bytes: Buffer;
  createdBy?: string;
}

export interface StorageObjectMeta {
  id: string;
  organizationId: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export class StorageService {
  // ── The driver seam ─────────────────────────────────────────────────────
  // Driver A is not even an object yet — the Postgres statements below ARE
  // the driver. When R2 lands: extract these bodies behind the interface,
  // key on env.STORAGE_DRIVER here, and migrate bytes out of band. The
  // public surface of this class does not change.

  private requireDriver(): "postgres" {
    if (env.STORAGE_DRIVER === "r2") {
      // Named and loud: a config flip before the driver exists must fail at
      // the first use, not silently keep writing to Postgres.
      throw new Error(
        "STORAGE_DRIVER=r2 is not built yet — the R2 driver is a declared seam (ADR-038), not shipped code.",
      );
    }
    return "postgres";
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  /**
   * Stores bytes for an organization. Duplicate detection is bookkeeping
   * (sha256 is recorded, indexed per org) but NOT deduplicated — two uploads
   * of the same image are two objects, because object identity must not
   * depend on content when rows point at ids (replacing one student's photo
   * must never disturb another's).
   */
  async putObject(input: PutObjectInput): Promise<StorageObjectMeta> {
    this.requireDriver();

    // Backstop to the contract's base64 length bound — REST callers bypass
    // no gate, but the service owns its own invariant.
    if (input.bytes.length === 0) {
      throw new Error("The file is empty — upload something.");
    }
    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        `The file is larger than ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB — resize or compress it first.`,
      );
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");

    const [row] = await db
      .insert(storageObjects)
      .values({
        organizationId: input.organizationId,
        contentType: input.contentType,
        sizeBytes: input.bytes.length,
        sha256,
        data: input.bytes,
        createdBy: input.createdBy ?? null,
      })
      .returning({
        id: storageObjects.id,
        organizationId: storageObjects.organizationId,
        contentType: storageObjects.contentType,
        sizeBytes: storageObjects.sizeBytes,
        sha256: storageObjects.sha256,
      });

    if (!row) throw new Error("Failed to store the file.");

    return row;
  }

  /**
   * Deletes an object's bytes for real. NOT a hard-rule-2 violation: storage
   * objects are blobs, not user/student/payment/attendance/result records,
   * and the only caller is the photo-replacement flow, which has already
   * re-pointed `student_photos` at the new object (the FK is
   * `onDelete: restrict`, so a still-referenced delete fails loudly rather
   * than dangling).
   */
  async deleteObject(organizationId: string, objectId: string): Promise<boolean> {
    this.requireDriver();

    const rows = await db
      .delete(storageObjects)
      .where(
        and(
          eq(storageObjects.id, objectId),
          eq(storageObjects.organizationId, organizationId),
        ),
      )
      .returning({ id: storageObjects.id });

    return rows.length > 0;
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Metadata without bytes — the template renderer's background/logo lookups. */
  async getMeta(
    organizationId: string,
    objectId: string,
  ): Promise<StorageObjectMeta | null> {
    const [row] = await db
      .select({
        id: storageObjects.id,
        organizationId: storageObjects.organizationId,
        contentType: storageObjects.contentType,
        sizeBytes: storageObjects.sizeBytes,
        sha256: storageObjects.sha256,
      })
      .from(storageObjects)
      .where(
        and(
          eq(storageObjects.id, objectId),
          eq(storageObjects.organizationId, organizationId),
        ),
      );

    return row ?? null;
  }

  /** The bytes themselves — same tenancy filter as the meta read. */
  async getBytes(
    organizationId: string,
    objectId: string,
  ): Promise<{ contentType: string; data: Buffer } | null> {
    const [row] = await db
      .select({
        contentType: storageObjects.contentType,
        data: storageObjects.data,
      })
      .from(storageObjects)
      .where(
        and(
          eq(storageObjects.id, objectId),
          eq(storageObjects.organizationId, organizationId),
        ),
      );

    return row ?? null;
  }

  /**
   * THE SERVING ROUTE'S READ — the one method that starts from the CALLER
   * instead of an org id, because `GET /api/storage/:id` learns the tenant
   * only by loading the object. It loads the org, then demands an ACTIVE
   * role assignment (not revoked, not expired) for that caller in that org;
   * anything else answers null, and a wrong-tenant probe is indistinguishable
   * from a made-up id. The unfiltered first SELECT never escapes this file —
   * only the membership-checked verdict does.
   */
  async getForUser(
    userId: string,
    objectId: string,
  ): Promise<{ contentType: string; data: Buffer } | null> {
    this.requireDriver();

    const [row] = await db
      .select({
        organizationId: storageObjects.organizationId,
        contentType: storageObjects.contentType,
        data: storageObjects.data,
      })
      .from(storageObjects)
      .where(eq(storageObjects.id, objectId));

    if (!row) return null;

    const [membership] = await db
      .select({ userId: roleAssignments.userId })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.organizationId, row.organizationId),
          isNull(roleAssignments.revokedAt),
          or(
            isNull(roleAssignments.expiresAt),
            gt(roleAssignments.expiresAt, sql`now()`),
          ),
        ),
      )
      .limit(1);

    if (!membership) return null;

    return { contentType: row.contentType, data: row.data };
  }

  /**
   * THE CLONE FLOW'S READ — a deliberate cross-org byte copy for the
   * community gallery (slice 2b). The one unfiltered SELECT in this class
   * besides `getForUser`, and it is justified the same way: the CALLER has
   * already been verified one level up. `IdCardService.clonePublishedTemplate`
   * loads the source template unfiltered ONLY after proving it is PUBLISHED,
   * and only then may call this — publishing a design is the owner's act of
   * making its imagery copyable, so the bytes move into the cloner's org as a
   * NEW object (a new id) and the cloned design references the copy. The
   * serving route's membership rule is never relaxed: org B still cannot read
   * org A's original object, before or after the clone.
   *
   * Runs OUTSIDE any transaction deliberately: the copy commits first, the
   * template row second — a failure between the two leaves an orphan object
   * in the cloner's org (the same tolerance ADR-038 §4 grants the photo
   * flow), never a template row referencing bytes that are not there.
   */
  async copyObjectToOrg(input: {
    sourceObjectId: string;
    targetOrganizationId: string;
    createdBy?: string;
  }): Promise<StorageObjectMeta> {
    this.requireDriver();

    const [source] = await db
      .select({
        contentType: storageObjects.contentType,
        sizeBytes: storageObjects.sizeBytes,
        sha256: storageObjects.sha256,
        data: storageObjects.data,
      })
      .from(storageObjects)
      .where(eq(storageObjects.id, input.sourceObjectId));

    if (!source) {
      throw new Error("The image this design references no longer exists.");
    }

    const [row] = await db
      .insert(storageObjects)
      .values({
        organizationId: input.targetOrganizationId,
        contentType: source.contentType,
        sizeBytes: source.sizeBytes,
        sha256: source.sha256,
        data: source.data,
        createdBy: input.createdBy ?? null,
      })
      .returning({
        id: storageObjects.id,
        organizationId: storageObjects.organizationId,
        contentType: storageObjects.contentType,
        sizeBytes: storageObjects.sizeBytes,
        sha256: storageObjects.sha256,
      });

    if (!row) throw new Error("Failed to copy the image into your organisation.");
    return row;
  }

  // ── The student photo (one live row per student) ────────────────────────

  /**
   * The student's current photo object id, for the detail page and the
   * card-data payload. Scoped through the STUDENT (hard rule 1 — the filter
   * rides the students table, not the photo row, which carries no org
   * columns of its own).
   */
  async getStudentPhotoObjectId(
    scope: DataScope,
    studentId: string,
  ): Promise<string | null> {
    // The photo is school-attributed through the student; an org-level scope
    // has no branch to attribute to, so it is refused like any other
    // school-scoped read (requireSchoolId words it).
    const schoolId = requireSchoolId(scope);

    const [row] = await db
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

    return row?.objectId ?? null;
  }
}

export const storageService = new StorageService();
