import { idCardTemplates } from "@repo/db/schema";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { imageRefSchema } from "./storage.contract";
import { studentRosterInput } from "./student.contract";

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
 * Full-card background image — a storage object id; template reads carry its link (ADR-063).
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
 * photo), `qr` encodes the studentId, `logo` renders the school logo
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
  /**
   * The card's BACK side — same shape as the front, fully data-driven (the
   * same binding catalog applies; a back QR binds `studentId` like any
   * front element). Absent/null = single-sided, which keeps every row saved
   * before two-sided printing existed parsing unchanged. Backs share the
   * front's orientation and card size by definition — a card is one piece
   * of stock.
   */
  back: z
    .object({
      canvas: idCardCanvasSchema,
      elements: z.array(idCardElementSchema).max(60),
    })
    .nullish(),
});
export type IdCardTemplateData = z.infer<typeof idCardTemplateDataSchema>;
/** The back side's own design document (canvas + elements only). */
export type IdCardBackSide = NonNullable<IdCardTemplateData["back"]>;
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
 * A template as the screens read it: the row plus its backgrounds and logos
 * ready to show, keyed by asset id (ADR-063). An id missing from `images`
 * renders as an empty slot.
 */
export const idCardTemplateWithImagesSchema = idCardTemplateSelectSchema.extend({
  images: z.record(z.string(), imageRefSchema),
});
export type IdCardTemplateWithImages = z.infer<typeof idCardTemplateWithImagesSchema>;

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
  // The back side arrives FLAT (canvas + elements) to match the row's
  // columns; absent = single-sided. A null backCanvas with non-null
  // backElements is refused below so the pair is always coherent.
  backCanvas: idCardCanvasSchema.nullish(),
  backElements: z.array(idCardElementSchema).max(60).nullish(),
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
  .extend({ isPublished: z.boolean().optional() })
  .superRefine((value, ctx) => {
    // The back side is a PAIR — canvas without elements (or the reverse)
    // would render a half-defined side.
    if (
      (value.backCanvas === undefined) !== (value.backElements === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "backCanvas and backElements are written together.",
        path: ["backCanvas"],
      });
    }
  });
export type UpdateIdCardTemplateInput = z.infer<typeof updateIdCardTemplateInput>;

/**
 * Soft-close (hard rule 2): the template leaves every list and picker but
 * keeps its row — already-printed cards outlive the design. The service
 * refuses to close a school's default (every school keeps one live default).
 */
export const closeIdCardTemplateInput = z.object({ id: z.uuid() });
export type CloseIdCardTemplateInput = z.infer<typeof closeIdCardTemplateInput>;

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
  // A published back side is design-only like the front — no org identity,
  // no student data.
  back: z
    .object({
      canvas: idCardCanvasSchema,
      elements: z.array(idCardElementSchema).max(60),
    })
    .nullish(),
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
  /** The student's photo, ready to print (ADR-063). */
  photo: imageRefSchema.nullable(),
  schoolName: z.string(),
});
export type IdCardStudentCard = z.infer<typeof idCardStudentCardSchema>;



// ---------------------------------------------------------------------------
// Printing from the phone: the Students list's own filters in, finished HTML out
// ---------------------------------------------------------------------------

/** The most cards one PDF holds. More is refused with wording, never cut short. */
export const ID_CARD_PRINT_LIMIT = 200;

/** A4 margin unless the school sets its own: safe on nearly every printer. */
export const ID_CARD_MARGIN_DEFAULT_MM = 8;

/**
 * What the Students list is showing: its view, search, filters and sort, without its
 * paging. The server finds every match, not only the pages the phone has loaded.
 */
export const idCardPrintListSchema = studentRosterInput.omit({ limit: true, cursor: true });
export type IdCardPrintList = z.infer<typeof idCardPrintListSchema>;

/**
 * The paper. A4 lays cards on a grid centred on the sheet, so a back printed on the
 * other side lands behind its front; `flip` says which edge the stack turns on. Card
 * size is one card per page, for a card printer or a vendor.
 */
export const idCardPrintPaperSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("a4"),
    columnGapMm: z.number().min(0).max(20).default(4),
    rowGapMm: z.number().min(0).max(20).default(4),
    /** The sheet's margin left and right, and top and bottom. The school's own call. */
    marginXMm: z.number().min(0).max(100).default(ID_CARD_MARGIN_DEFAULT_MM),
    marginYMm: z.number().min(0).max(100).default(ID_CARD_MARGIN_DEFAULT_MM),
    flip: z.enum(["long", "short"]).default("long"),
  }),
  z.object({ kind: z.literal("card") }),
]);
export type IdCardPrintPaper = z.infer<typeof idCardPrintPaperSchema>;

/** Who the list would print, before anything is drawn. */
export const idCardPrintSummarySchema = z.object({
  /** Everyone the list's filters match. */
  matched: z.number().int(),
  /** Those with a class this session, still studying: the ones that print. */
  printable: z.number().int(),
  /** Printable students without a photo; their cards print an empty photo box. */
  noPhoto: z.number().int(),
  limit: z.number().int(),
});
export type IdCardPrintSummary = z.infer<typeof idCardPrintSummarySchema>;

export const idCardDocumentInput = z.object({
  list: idCardPrintListSchema,
  /** Omitted: the school's default design. */
  templateId: z.uuid().optional(),
  paper: idCardPrintPaperSchema,
});
export type IdCardDocumentInput = z.infer<typeof idCardDocumentInput>;

/** Finished HTML and its page size in points, which expo-print turns into the PDF. */
export const idCardDocumentSchema = z.object({
  html: z.string(),
  fileName: z.string(),
  width: z.number(),
  height: z.number(),
  cardCount: z.number().int(),
});
export type IdCardDocument = z.infer<typeof idCardDocumentSchema>;
