import type { ImageRef, UploadRequest, UploadTicket } from "@repo/contracts";
import { db } from "@repo/db";
import { staff, staffPhotos } from "@repo/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { storageService } from "./storage.service";

/**
 * STAFF PHOTOS (ADR-068) — the student-photo shape (ADR-063) for the
 * employment record. One live `staff_photos` row per staff member; a
 * re-upload re-points it and marks the old file deleted for the sweeper.
 *
 * Two callers, both already gated by the router: the office (`staff:update`
 * on the record's branch) and the staff member themselves (their own record,
 * found by their login). Every function therefore takes the organisation and
 * the staff id and re-checks the record belongs to that organisation, so a
 * stray id from another tenant is "not found", never written.
 */

async function requireStaff(organizationId: string, staffId: string) {
  const [row] = await db
    .select({ id: staff.id, schoolId: staff.schoolId })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
  if (!row) throw new Error("Staff member not found.");
  return row;
}

export class StaffPhotoService {
  /** The staff record the signed-in user owns in this organisation, or null. */
  async ownStaffId(organizationId: string, userId: string): Promise<string | null> {
    const [row] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.organizationId, organizationId),
          eq(staff.userId, userId),
          // ADR-074: exactly one current record per login; a leaver's old one never answers.
          inArray(staff.status, ["active", "on_leave", "suspended"]),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** A link to PUT the new photo to; the client then calls `setPhoto`. */
  async upload(
    organizationId: string,
    staffId: string,
    file: UploadRequest,
    userId: string,
  ): Promise<UploadTicket> {
    const row = await requireStaff(organizationId, staffId);
    const [ticket] = await storageService.createUploads({
      organizationId,
      schoolId: row.schoolId,
      purpose: "staff_photo",
      parentId: staffId,
      uploadedBy: userId,
      files: [file],
    });
    if (!ticket) throw new Error("No upload link was created.");
    return ticket;
  }

  /** The photo, ready to show, or null. */
  async get(organizationId: string, staffId: string): Promise<ImageRef | null> {
    const map = await this.many(organizationId, [staffId]);
    return map.get(staffId) ?? null;
  }

  /**
   * Photos for many staff at once (lists, pickers): staff id → image. Staff
   * without a photo are simply absent from the map.
   */
  async many(organizationId: string, staffIds: string[]): Promise<Map<string, ImageRef>> {
    const out = new Map<string, ImageRef>();
    if (staffIds.length === 0) return out;
    const rows = await db
      .select({ staffId: staffPhotos.staffId, objectId: staffPhotos.objectId })
      .from(staffPhotos)
      .innerJoin(staff, eq(staffPhotos.staffId, staff.id))
      .where(
        and(
          inArray(staffPhotos.staffId, [...new Set(staffIds)]),
          eq(staff.organizationId, organizationId),
        ),
      );
    if (rows.length === 0) return out;
    const refs = await storageService.imageRefs(
      organizationId,
      rows.map((row) => row.objectId),
    );
    for (const row of rows) {
      const ref = refs.get(row.objectId);
      if (ref) out.set(row.staffId, ref);
    }
    return out;
  }

  /**
   * Makes an uploaded file the photo: processes it, links it to this staff
   * member (refused unless it was uploaded for them), upserts the row, and
   * marks the replaced file deleted. One transaction after processing.
   */
  async set(
    organizationId: string,
    staffId: string,
    objectId: string,
    userId: string,
  ): Promise<ImageRef | null> {
    await requireStaff(organizationId, staffId);
    await storageService.ensureReady(userId, [objectId]);

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ objectId: staffPhotos.objectId })
        .from(staffPhotos)
        .where(eq(staffPhotos.staffId, staffId))
        .for("update");

      await storageService.attach(tx, {
        organizationId,
        purpose: "staff_photo",
        parentId: staffId,
        userId,
        objectIds: [objectId],
      });

      await tx
        .insert(staffPhotos)
        .values({ staffId, objectId, uploadedBy: userId })
        .onConflictDoUpdate({
          target: staffPhotos.staffId,
          set: { objectId, uploadedBy: userId, updatedAt: new Date() },
        });

      if (existing && existing.objectId !== objectId) {
        await storageService.markDeleted(tx, organizationId, [existing.objectId]);
      }
    });

    return this.get(organizationId, staffId);
  }

  /** Removes the photo; the file is marked deleted for the sweeper. */
  async remove(organizationId: string, staffId: string): Promise<boolean> {
    await requireStaff(organizationId, staffId);
    const [photo] = await db
      .select({ objectId: staffPhotos.objectId })
      .from(staffPhotos)
      .where(eq(staffPhotos.staffId, staffId));
    if (!photo) return false;
    await db.transaction(async (tx) => {
      await tx.delete(staffPhotos).where(eq(staffPhotos.staffId, staffId));
      await storageService.markDeleted(tx, organizationId, [photo.objectId]);
    });
    return true;
  }
}

export const staffPhotoService = new StaffPhotoService();
