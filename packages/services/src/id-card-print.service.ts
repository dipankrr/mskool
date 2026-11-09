import {
  ID_CARD_PRINT_LIMIT,
  idCardTemplateDataSchema,
  type IdCardDocument,
  type IdCardDocumentInput,
  type IdCardPrintList,
  type IdCardPrintSummary,
  type IdCardTemplateData,
} from "@repo/contracts";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import { db } from "@repo/db";
import { idCardTemplates, studentEnrollments, studentPhotos, students } from "@repo/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import sharp from "sharp";
import { atSchoolLevel, requireSchoolId } from "./academic.service";
import { ENROLLED_STATUSES } from "./enrollment-status";
import { env } from "./env";
import { fileNameOf } from "./fee-documents/html";
import { renderIdCards, type RenderCard } from "./id-card-documents/render";
import { idCardService } from "./idcard.service";
import { refuse } from "./service-error";
import { storageService } from "./storage.service";
import { studentService } from "./student.service";

/**
 * PRINTING ID CARDS FROM THE PHONE. The Students list's own filters come in; the
 * cards of everyone it shows come out as finished HTML the phone turns into a PDF
 * (ADR-059's pattern).
 *
 * Who prints: the list's matches (read through the roster's own conditions, never
 * the phone's loaded pages) narrowed to students still studying with a class in the
 * list's session, which is who `cardData` can describe. Both reads take the
 * caller's `id_card:print` scope, so the list can't reach further than printing can.
 */

/** Far more than any branch has; only a guard against an unbounded read. */
const MATCH_CAP = 20_000;

const ENROLLMENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
};

/** Photos are shrunk to this before embedding: a 25mm photo box at about 350 dpi. */
const PHOTO_MAX_PX = { width: 360, height: 480 };
/** Backgrounds and logos: a full CR80 card at about 350 dpi. */
const ASSET_MAX_PX = 1200;

export class IdCardPrintService {
  async summary(scope: DataScope, list: IdCardPrintList): Promise<IdCardPrintSummary> {
    const matched = await studentService.listRosterIds([scope], list, MATCH_CAP);
    const printable = await this.printable(scope, list.academicYearId, matched);
    return {
      matched: matched.length,
      printable: printable.length,
      noPhoto: printable.filter((row) => !row.hasPhoto).length,
      limit: ID_CARD_PRINT_LIMIT,
    };
  }

  async document(scope: DataScope, input: IdCardDocumentInput): Promise<IdCardDocument> {
    const template = await this.template(scope, input.templateId);

    const matched = await studentService.listRosterIds([scope], input.list, MATCH_CAP);
    const printable = await this.printable(scope, input.list.academicYearId, matched);
    if (printable.length === 0) {
      throw refuse(
        "BAD_REQUEST",
        "No one on this list can get a card. Cards print for students who have a class this session.",
      );
    }
    if (printable.length > ID_CARD_PRINT_LIMIT) {
      throw refuse(
        "BAD_REQUEST",
        `This list has ${printable.length} cards. Print up to ${ID_CARD_PRINT_LIMIT} at a time, for example one class.`,
      );
    }

    // In the list's order: the order the screen showed, ready to hand out.
    const position = new Map(matched.map((id, index) => [id, index]));
    const cards = (
      await idCardService.cardData(scope, {
        academicYearId: input.list.academicYearId,
        studentIds: printable.map((row) => row.studentId),
      })
    ).sort((a, b) => (position.get(a.studentId) ?? 0) - (position.get(b.studentId) ?? 0));

    const [assets, renderCards] = await Promise.all([
      this.templateImages(scope.organizationId, template.data),
      inBatches(cards, 8, async (card): Promise<RenderCard> => ({
        card,
        photo: card.photo
          ? await this.dataUri(scope.organizationId, card.photo.id, "photo")
          : null,
        qrSvg: await studentQr(card.studentId),
      })),
    ]);

    const { html, width, height } = renderIdCards({
      title: "ID cards",
      template: template.data,
      cards: renderCards,
      assets,
      paper: input.paper,
    });

    return {
      html,
      width,
      height,
      fileName: fileNameOf("ID cards", oneClassName(cards), `${cards.length}`),
      cardCount: cards.length,
    };
  }

  /** Of these students, the ones still studying with a class in this session. */
  private async printable(scope: DataScope, academicYearId: string, studentIds: string[]) {
    if (studentIds.length === 0) return [];
    const rows = await db
      .select({ studentId: studentEnrollments.studentId, photoId: studentPhotos.id })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .leftJoin(studentPhotos, eq(studentPhotos.studentId, students.id))
      .where(
        and(
          eq(studentEnrollments.academicYearId, academicYearId),
          inArray(studentEnrollments.studentId, studentIds),
          eq(students.status, "active"),
          inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          scopeWhere(scope, ENROLLMENT_SCOPE_COLUMNS),
        ),
      );
    return rows.map((row) => ({ studentId: row.studentId, hasPhoto: row.photoId !== null }));
  }

  /** The named design, or the school's default. Closed or foreign is the same not found. */
  private async template(scope: DataScope, templateId: string | undefined) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .select()
      .from(idCardTemplates)
      .where(
        and(
          templateId ? eq(idCardTemplates.id, templateId) : eq(idCardTemplates.isDefault, true),
          eq(idCardTemplates.schoolId, schoolId),
          eq(idCardTemplates.status, "active"),
          scopeWhere(atSchoolLevel(scope), {
            organizationId: idCardTemplates.organizationId,
            schoolId: idCardTemplates.schoolId,
          }),
        ),
      )
      .limit(1);
    if (!row) {
      throw refuse(
        "NOT_FOUND",
        templateId
          ? "That ID card design is no longer available. Pick another."
          : "This branch has no ID card design yet. Set one up on the web first.",
      );
    }
    const parsed = idCardTemplateDataSchema.safeParse({
      orientation: row.orientation,
      canvas: row.canvas,
      elements: row.elements,
      ...(row.backCanvas != null && row.backElements != null
        ? { back: { canvas: row.backCanvas, elements: row.backElements } }
        : {}),
    });
    if (!parsed.success) {
      throw refuse("CONFLICT", "This ID card design can't be printed. Open it on the web and save it again.");
    }
    return { row, data: parsed.data };
  }

  /** Backgrounds and logos the design uses, each fetched once. A missing one is an empty slot. */
  private async templateImages(organizationId: string, design: IdCardTemplateData) {
    const sides = [design, ...(design.back ? [design.back] : [])];
    const ids = new Set<string>();
    for (const side of sides) {
      if (side.canvas.backgroundAssetId) ids.add(side.canvas.backgroundAssetId);
      for (const element of side.elements) {
        if (element.type === "logo" && element.assetId) ids.add(element.assetId);
      }
    }
    const images = new Map<string, string>();
    await Promise.all(
      [...ids].map(async (id) => {
        const uri = await this.dataUri(organizationId, id, "asset");
        if (uri) images.set(id, uri);
      }),
    );
    return images;
  }

  /**
   * A stored image, shrunk to print size, as a data URI. Embedding means the PDF never
   * waits on a link. Photos become JPEG; template images keep transparency as PNG.
   */
  private async dataUri(
    organizationId: string,
    objectId: string,
    kind: "photo" | "asset",
  ): Promise<string | null> {
    const file = await storageService.getBytes(organizationId, objectId);
    if (!file) return null;
    try {
      const image = sharp(file.data).rotate();
      if (kind === "photo") {
        const data = await image
          .resize({ ...PHOTO_MAX_PX, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        return `data:image/jpeg;base64,${data.toString("base64")}`;
      }
      const { hasAlpha } = await image.metadata();
      const resized = image.resize({
        width: ASSET_MAX_PX,
        height: ASSET_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      });
      const data = hasAlpha
        ? await resized.png().toBuffer()
        : await resized.jpeg({ quality: 85 }).toBuffer();
      return `data:image/${hasAlpha ? "png" : "jpeg"};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  }
}

/**
 * The web's QR: a link to the student's page on the staff web app, so a scan lands on
 * the record. Without WEB_APP_URL there is no address to print, and the slot stays empty.
 */
async function studentQr(studentId: string): Promise<string | null> {
  if (!env.WEB_APP_URL) return null;
  const base = env.WEB_APP_URL.replace(/\/+$/, "");
  return QRCode.toString(`${base}/students/${studentId}`, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
  });
}

/** "8-A" when every card is from one class and section; nothing otherwise. */
function oneClassName(cards: { className: string; sectionName: string | null }[]): string | null {
  const names = new Set(
    cards.map((card) => (card.sectionName ? `${card.className}-${card.sectionName}` : card.className)),
  );
  return names.size === 1 ? [...names][0]! : null;
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return out;
}

export const idCardPrintService = new IdCardPrintService();
