import { idCardTemplates } from "@repo/db/schema";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * ID CARDS — the template vocabulary and the card-data payload (slice 2a).
 *
 * Two halves:
 *
 * 1. THE TEMPLATE DOCUMENT — hand-written zod (like the exam snapshot): an
 *    orientation, an optional background storage object, and positioned
 *    ELEMENTS. Geometry is percent-of-card so any orientation/arrangement is
 *    representable and print output is resolution-independent. The DB stores
 *    canvas/elements as jsonb; these schemas are the only writers and readers
 *    of that shape. The client renders the JSON against server-resolved card
 *    data and never invents data itself — the fees principle.
 * 2. THE CARD DATA PAYLOAD — what `id_card.cardData` returns per student.
 *    Bindings name fields of this payload; `custom` is literal text. The
 *    binding list IS the payload's public surface — adding a field to the
 *    payload without adding a binding is how drift starts.
 */

// ---------------------------------------------------------------------------
// The template document
// ---------------------------------------------------------------------------

export const idCardOrientationSchema = z.enum(["landscape", "portrait"]);
export type IdCardOrientation = z.infer<typeof idCardOrientationSchema>;

/**
 * Full-card background image — a storage object id, served by /api/storage.
 *
 * `widthMm`/`heightMm` are the CARD's physical size when the school departs
 * from CR80 (an ID card built around a pre-printed background sheet, say).
 * Absent = the CR80 default for the orientation, so rows saved before this
 * field existed parse unchanged — jsonb needs no migration. Elements are
 * positioned in percent-of-card, so a resize never orphans their geometry.
 */
export const idCardCanvasSchema = z.object({
  backgroundAssetId: z.uuid().nullish(),
  widthMm: z.number().positive().max(300).optional(),
  heightMm: z.number().positive().max(300).optional(),
  /** The printed card's corner rounding, in mm (0 = square stock). */
  cornerRadiusMm: z.number().min(0).max(20).optional(),
});
export type IdCardCanvas = z.infer<typeof idCardCanvasSchema>;

/**
 * Every card-data field a text element can bind to. `custom` renders the
 * element's own `customText` (a literal — a school motto, a header line).
 */
export const ID_CARD_BINDINGS = [
  "studentName",
  "admissionNumber",
  "rollNumber",
  "className",
  "sectionName",
  "academicYear",
  "dateOfBirth",
  "bloodGroup",
  "address",
  "guardianName",
  "motherName",
  "validTill",
  "schoolName",
  "custom",
] as const;
export const idCardBindingSchema = z.enum(ID_CARD_BINDINGS);
export type IdCardBinding = z.infer<typeof idCardBindingSchema>;

export const idCardTextAlignSchema = z.enum(["left", "center", "right"]);
export const idCardFontWeightSchema = z.enum(["normal", "bold"]);

const elementBase = {
  /** Stable within one template — the designer's drag key. Not a DB id. */
  id: z.string().min(1).max(64),
  /** Percent of card, origin top-left. */
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  visible: z.boolean().default(true),
  /**
   * Element corner rounding as a percent of the element's box — 50 makes a
   * photo/logo a circle or pill. Absent = square corners.
   */
  borderRadius: z.number().min(0).max(50).optional(),
};

/**
 * The element union. `photo` renders the student's photo (cardData's
 * photoObjectId), `qr` encodes the studentId, `logo` renders the school logo
 * (assetId if the school uploaded one — a 2b+ surface; the renderer shows
 * nothing when absent rather than breaking the card).
 */
export const idCardElementSchema = z.discriminatedUnion("type", [
  z.object({
    ...elementBase,
    type: z.literal("text"),
    binding: idCardBindingSchema,
    customText: z.string().max(200).optional(),
    fontSize: z.number().min(4).max(48),
    fontWeight: idCardFontWeightSchema.default("normal"),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb hex color.")
      .default("#111827"),
    align: idCardTextAlignSchema.default("left"),
  }),
  z.object({
    ...elementBase,
    type: z.literal("photo"),
  }),
  z.object({
    ...elementBase,
    type: z.literal("qr"),
  }),
  z.object({
    ...elementBase,
    type: z.literal("logo"),
    assetId: z.uuid().nullish(),
  }),
]);
export type IdCardElement = z.infer<typeof idCardElementSchema>;

export const idCardTemplateDataSchema = z.object({
  orientation: idCardOrientationSchema,
  canvas: idCardCanvasSchema,
  elements: z.array(idCardElementSchema).max(60),
});
export type IdCardTemplateData = z.infer<typeof idCardTemplateDataSchema>;
/** The WRITE shape — fields with defaults (`fontWeight`, `color`, `align`, `visible`) are optional. */
export type IdCardTemplateDataInput = z.input<typeof idCardTemplateDataSchema>;
/** One element in the write shape — the renderer's element type. */
export type IdCardElementInput = IdCardTemplateDataInput["elements"][number];

// ---------------------------------------------------------------------------
// Template rows + write inputs
// ---------------------------------------------------------------------------

export const idCardTemplateSelectSchema = createSelectSchema(idCardTemplates);
export type IdCardTemplateRow = z.infer<typeof idCardTemplateSelectSchema>;

/**
 * Creates and adopts share one shape — adopting IS creating, from a starter
 * design's constants instead of a designer session. `isDefault` on create
 * moves the default (the service clears the old one in the same transaction;
 * the DB's partial unique index is the backstop).
 */
export const createIdCardTemplateInput = z.object({
  name: z.string().min(1).max(150),
  orientation: idCardOrientationSchema,
  canvas: idCardCanvasSchema,
  elements: z.array(idCardElementSchema).max(60),
  isDefault: z.boolean().default(false),
});
export type CreateIdCardTemplateInput = z.infer<typeof createIdCardTemplateInput>;

/**
 * Labels and the design document are editable; tenancy and status are not.
 * `isPublished` (2b) is the publish-to-gallery switch: setting it stamps
 * `publishedAt`, clearing it nulls the stamp — the service owns both, the
 * caller sends only the intent.
 */
export const updateIdCardTemplateInput = createIdCardTemplateInput
  .partial()
  .extend({ isPublished: z.boolean().optional() });
export type UpdateIdCardTemplateInput = z.infer<typeof updateIdCardTemplateInput>;

// ---------------------------------------------------------------------------
// The community gallery (slice 2b)
// ---------------------------------------------------------------------------

/**
 * ONE row of the cross-school gallery. This is the DELIBERATE platform-level
 * read (the tenancy exception of the whole id-card surface): a published
 * template's design is tenant-agnostic — name, orientation, canvas, elements
 * — and the payload carries NO org identity (no organizationId, no schoolId,
 * no audit columns) and NO student data. Asset ids inside the design (a
 * background, a logo) are uuids only: the serving route answers bytes to
 * members of the OWNING org, so a listed id leaks nothing to another org —
 * and `gallery.clone` byte-copies any referenced asset into the cloner's org
 * rather than ever pointing a cross-org reader at them.
 */
export const publishedIdCardTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  orientation: idCardOrientationSchema,
  canvas: idCardCanvasSchema,
  elements: z.array(idCardElementSchema).max(60),
  publishedAt: z.string(),
});
export type PublishedIdCardTemplate = z.infer<typeof publishedIdCardTemplateSchema>;

/**
 * Clones a PUBLISHED template (any org's) into the caller's school as a new
 * owned row. The name is optional — defaulting to the source's — so a school
 * that already adopted a design under the same name can rename on the way in
 * instead of being refused by the per-school unique index.
 */
export const cloneIdCardTemplateInput = z.object({
  templateId: z.uuid(),
  name: z.string().min(1).max(150).optional(),
});
export type CloneIdCardTemplateInput = z.infer<typeof cloneIdCardTemplateInput>;

// ---------------------------------------------------------------------------
// Card data — the payload text elements bind into
// ---------------------------------------------------------------------------

/** The plain shape — the router spreads it into its own input object. */
export const idCardDataRequestShape = {
  academicYearId: z.uuid(),
  classId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  /** An explicit selection; omitted means the whole roster of the filters. */
  studentIds: z.array(z.uuid()).max(200).optional(),
};

export const idCardDataRequestInput = z
  .object(idCardDataRequestShape)
  .refine(
    (input) =>
      Boolean(input.classId || input.sectionId || input.studentIds?.length),
    "Pick a class, a section, or at least one student.",
  );
export type IdCardDataRequestInput = z.infer<typeof idCardDataRequestInput>;

export const idCardStudentCardSchema = z.object({
  studentId: z.uuid(),
  name: z.string(),
  admissionNumber: z.string(),
  rollNumber: z.string().nullable(),
  className: z.string(),
  sectionName: z.string().nullable(),
  academicYear: z.string(),
  dateOfBirth: z.string(),
  bloodGroup: z.string().nullable(),
  address: z.string().nullable(),
  guardianName: z.string().nullable(),
  motherName: z.string().nullable(),
  /** The session's end date (ISO) — the card expires with the session. */
  validTill: z.string(),
  photoObjectId: z.string().uuid().nullable(),
  schoolName: z.string(),
});
export type IdCardStudentCard = z.infer<typeof idCardStudentCardSchema>;

// ---------------------------------------------------------------------------
// Photo upload (on the student surface)
// ---------------------------------------------------------------------------

/**
 * Decoded-byte ceiling. Deliberately INSIDE the API's 1 MB JSON body limit
 * even after base64 inflation (~4/3): 512 KB decoded → ~683 KB encoded, which
 * fits with room for the envelope. A 300×400 JPEG lands far below this.
 */
export const PHOTO_MAX_BYTES = 512 * 1024;

export const PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const base64Shape = /^[A-Za-z0-9+/]*={0,2}$/;

export const uploadStudentPhotoInput = z.object({
  contentType: z.enum(PHOTO_CONTENT_TYPES),
  // Length bound first (base64 is ~4/3 of decoded), then the alphabet — a
  // misencoded payload should fail as "not an image encoding", not pass
  // length and die at decode.
  dataBase64: z
    .string()
    .max(Math.ceil(PHOTO_MAX_BYTES / 3) * 4)
    .regex(base64Shape, "The photo data is not valid base64."),
});
export type UploadStudentPhotoInput = z.infer<typeof uploadStudentPhotoInput>;

/**
 * THE TEMPLATE'S OWN ASSETS (slice 2b) — a card background, a school logo.
 * Same cap and allowlist as the photo (they share the 512 KB ceiling and the
 * API's 1 MB body), and the client is again the only place bytes are
 * resized. The designer re-points `canvas.backgroundAssetId` / a logo
 * element's `assetId` at the returned object id; removing the reference
 * deliberately does NOT delete the bytes (reference-checking every other
 * template's jsonb before a delete is not worth it — orphan objects are an
 * accepted cost, ADR-038 §4's tolerance).
 */
export const uploadTemplateAssetInput = uploadStudentPhotoInput;
export type UploadTemplateAssetInput = z.infer<typeof uploadTemplateAssetInput>;

export const uploadedTemplateAssetSchema = z.object({
  objectId: z.uuid(),
});
export type UploadedTemplateAsset = z.infer<typeof uploadedTemplateAssetSchema>;
