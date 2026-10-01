import {
  idCardTemplateDataSchema,
  type IdCardElementInput,
  type IdCardStudentCard,
  type IdCardTemplateData,
} from "@repo/contracts";

/**
 * THE CLIENT'S RENDER MODEL (slice 2a).
 *
 * Templates arrive from two places with the same shape:
 *   - adopted rows (`idCard.template.list`) — canvas/elements are jsonb
 *     `unknown` on the wire, parsed here through the CONTRACT's zod schema
 *     (the exam snapshot's precedent: the wire shape is untyped, the parser
 *     is the type);
 *   - prebuilt starter constants (prebuilt-templates.ts) — already typed.
 *
 * The renderer is the ONLY consumer of a template, and the data it renders
 * comes from `idCard.cardData` — the server owns the truth, the browser only
 * lays it out. A binding this payload cannot satisfy renders empty, never
 * client-invented.
 */

/**
 * Resolves one text binding against the server-resolved card payload.
 * The binding catalog says `studentName`; the payload's field is `name`
 * (the registry's own word) — this is the ONE translation between the two
 * vocabularies, and every renderer goes through it.
 */
export function resolveBinding(
  element: Extract<IdCardElementInput, { type: "text" }>,
  card: IdCardStudentCard,
): string {
  if (element.binding === "custom") return element.customText ?? "";
  const key = element.binding === "studentName" ? "name" : element.binding;
  const value: unknown = card[key as keyof IdCardStudentCard];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Parses a template ROW's jsonb into the render model. Null on a shape the
 * current contract refuses (a template saved by a newer/older designer) —
 * the caller skips the row rather than rendering a broken card.
 */
export function parseTemplateData(row: {
  orientation: string;
  canvas: unknown;
  elements: unknown;
}): IdCardTemplateData | null {
  const parsed = idCardTemplateDataSchema.safeParse({
    orientation: row.orientation,
    canvas: row.canvas,
    elements: row.elements,
  });
  return parsed.success ? parsed.data : null;
}

/** CR80 in CSS px at 96dpi — the print sheet itself stays in physical mm. */
export const MM_PX = 96 / 25.4;

/**
 * The card's physical mm size: the template's own custom canvas dims when it
 * carries them, else the CR80 default for the orientation (86 × 54mm;
 * portrait swaps the axes).
 */
export function cardSizeMm(design: {
  orientation: IdCardTemplateData["orientation"];
  canvas: { widthMm?: number; heightMm?: number };
}) {
  if (design.canvas.widthMm && design.canvas.heightMm) {
    return { widthMm: design.canvas.widthMm, heightMm: design.canvas.heightMm };
  }
  return design.orientation === "landscape"
    ? { widthMm: 86, heightMm: 54 }
    : { widthMm: 54, heightMm: 86 };
}
