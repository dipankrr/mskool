import { relations } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations } from "./organization";
import { students } from "./people";

/**
 * STORAGE — binary objects and the student photo that points at one (ADR-038).
 *
 * The driver seam lives in `@repo/services` (storage.service.ts): v1 keeps the
 * bytes right here in Postgres, and the R2 driver later changes WHERE bytes
 * live without touching anything else, because every reference in the system
 * stores an OBJECT ID, never a URL. URLs are always the stable app route
 * `GET /api/storage/:id`, served by apps/api with a session + tenancy check —
 * so a driver migration is a byte copy plus an env flip.
 *
 * Uploads arrive through tRPC as base64 with a hard cap and an image
 * content-type allowlist (contract side); the service re-checks the decoded
 * size. Nothing here is under hard rule 2's protected list — an object's bytes
 * are a blob, and `deleteObject` is a real DELETE that only ever fires on an
 * object no row references any more (a replaced photo).
 */

/**
 * Postgres `bytea`. Drizzle has no builtin for it; postgres.js hands bytea
 * back as a Node Buffer in both directions, so the data/driver types match.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const storageObjects = pgTable(
  "storage_objects",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    // Allowlist lives in the contract; stored verbatim so the serving route
    // can answer with the exact type uploaded.
    contentType: varchar({ length: 100 }).notNull(),
    sizeBytes: integer().notNull(),
    // Content fingerprint — duplicate-detection bookkeeping, not addressing.
    // Objects are addressed by their uuid id (hard rule 10).
    sha256: varchar({ length: 64 }).notNull(),

    data: bytea().notNull(),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("storage_objects_org_idx").on(t.organizationId),
    index("storage_objects_org_sha_idx").on(t.organizationId, t.sha256),
  ],
);

/**
 * THE STUDENT'S PHOTO — exactly one live row per student (hard unique), so
 * "the photo of this child" is a lookup, never a "latest of" query. A
 * re-upload upserts this row and deletes the replaced object's bytes; history
 * of what was printed before is NOT kept here deliberately — the printed card
 * is the record, and ID cards expire yearly.
 */
export const studentPhotos = pgTable(
  "student_photos",
  {
    id: uuid().primaryKey().defaultRandom(),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    objectId: uuid()
      .notNull()
      .references(() => storageObjects.id, { onDelete: "restrict" }),

    uploadedBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One photo per student. The upsert path keys on this.
    uniqueIndex("student_photos_student_uq").on(t.studentId),
  ],
);

export const storageRelations = relations(storageObjects, ({ one }) => ({
  organization: one(organizations, {
    fields: [storageObjects.organizationId],
    references: [organizations.id],
  }),
}));

export const studentPhotoRelations = relations(studentPhotos, ({ one }) => ({
  student: one(students, {
    fields: [studentPhotos.studentId],
    references: [students.id],
  }),
  object: one(storageObjects, {
    fields: [studentPhotos.objectId],
    references: [storageObjects.id],
  }),
}));
