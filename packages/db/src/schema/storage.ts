import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations, schools } from "./organization";
import { students } from "./people";

/**
 * STORAGE — metadata for files whose bytes live in an S3-compatible bucket
 * (ADR-063). Postgres never holds the bytes.
 *
 * A row is created when an upload is handed out (`pending`), becomes `ready`
 * once the server has checked and re-encoded the file, gets `attached_at`
 * when a record links it, and is marked `deleted` when nothing should use it
 * any more; the storage sweeper then removes the row and the bytes. Every
 * column that points at a file is a foreign key here with `restrict`, so the
 * sweeper can never remove a file a record still uses.
 */

/**
 * The kind of file and the rules that go with it (size, versions, bucket,
 * retention). Named for what the file IS, never for the table that points at
 * it, so a domain redesign does not rename purposes. Values are only ever
 * added; removing one means rebuilding the type.
 */
export const storagePurposeEnum = pgEnum("storage_purpose", [
  "student_photo",
  "staff_photo",
  "id_card_asset",
  "fee_print_logo",
  "fee_upi_qr",
  "site_media",
  "homework_teacher_file",
  "homework_student_file",
]);

export const storageObjectStatusEnum = pgEnum("storage_object_status", [
  "pending",
  "ready",
  "deleted",
]);

/**
 * Which bucket the file lives in. Public files (site media) are served from
 * the public bucket's own domain with no signature; everything else is
 * private and reached only through a signed link the API hands out with the
 * record that authorises it.
 */
export const objectVisibilityEnum = pgEnum("object_visibility", ["private", "public"]);

/** One stored version of a file, as the processor wrote it. */
export type StorageVariant = {
  name: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
};

export const storageObjects = pgTable(
  "storage_objects",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    // Empty for organisation-level files (site media).
    schoolId: uuid().references(() => schools.id),

    purpose: storagePurposeEnum().notNull(),
    visibility: objectVisibilityEnum().notNull(),
    status: storageObjectStatusEnum().notNull().default("pending"),

    // The record the file was uploaded for (a student, an assignment, a
    // template). Attaching checks it, so re-saving a record keeps its files
    // and nobody can link a file uploaded for someone else.
    parentId: uuid(),

    // The display version's path in the bucket. Stored, never recomputed, so
    // a later path layout leaves old rows valid.
    path: varchar({ length: 300 }).notNull(),
    variants: jsonb().$type<StorageVariant[]>().notNull().default([]),

    // Detected from the bytes by the server, never the client's claim. Empty
    // until the file is processed.
    contentType: varchar({ length: 100 }),
    // Every version together, so usage matches what the bucket bills.
    sizeBytes: integer().notNull().default(0),
    width: integer(),
    height: integer(),

    uploadedBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp({ withTimezone: true }),
    attachedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("storage_objects_org_purpose_idx").on(t.organizationId, t.purpose),
    index("storage_objects_status_created_idx").on(t.status, t.createdAt),
    index("storage_objects_unattached_idx")
      .on(t.readyAt)
      .where(sql`status = 'ready' AND attached_at IS NULL`),
  ],
);

/**
 * THE STUDENT'S PHOTO — exactly one live row per student (hard unique), so
 * "the photo of this child" is a lookup, never a "latest of" query. A
 * re-upload re-points this row and marks the replaced file deleted; history
 * is not kept — the printed card is the record.
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
    index("student_photos_object_idx").on(t.objectId),
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
