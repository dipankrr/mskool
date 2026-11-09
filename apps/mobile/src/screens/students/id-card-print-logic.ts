/**
 * The print sheet's arithmetic, kept beside the screen so the "8 cards per sheet" line
 * matches what the API lays out (packages/services id-card-documents/layout.ts): A4
 * less the chosen margins, the chosen gaps, cards at their real size.
 */

export const GAP_MIN_MM = 0;
export const GAP_MAX_MM = 20;
export const GAP_DEFAULT_MM = 4;
/** Margins are the school's call, up to half a sheet's width. */
export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 100;
export const MARGIN_DEFAULT_MM = 8;

export type SheetSpacing = {
  columnGapMm: number;
  rowGapMm: number;
  marginXMm: number;
  marginYMm: number;
};

export type CardSize = { widthMm: number; heightMm: number };

/** The template's own size when it has one, else a standard CR80 card. */
export function cardSizeOf(template: { orientation: string; canvas: unknown }): CardSize {
  const canvas = (template.canvas ?? {}) as { widthMm?: unknown; heightMm?: unknown };
  if (
    typeof canvas.widthMm === "number" &&
    typeof canvas.heightMm === "number" &&
    canvas.widthMm > 0 &&
    canvas.heightMm > 0
  ) {
    return { widthMm: canvas.widthMm, heightMm: canvas.heightMm };
  }
  return template.orientation === "portrait"
    ? { widthMm: 54, heightMm: 86 }
    : { widthMm: 86, heightMm: 54 };
}

export function a4Fit(card: CardSize, spacing: SheetSpacing) {
  const { columnGapMm, rowGapMm } = spacing;
  const width = Math.max(0, 210 - 2 * spacing.marginXMm);
  const height = Math.max(0, 297 - 2 * spacing.marginYMm);
  const columns = Math.max(1, Math.floor((width + columnGapMm) / (card.widthMm + columnGapMm)));
  const rows = Math.max(1, Math.floor((height + rowGapMm) / (card.heightMm + rowGapMm)));
  return { columns, rows, perSheet: columns * rows };
}

export function sheetCount(cards: number, perSheet: number): number {
  return cards <= 0 ? 0 : Math.ceil(cards / perSheet);
}

export function clampGap(value: number): number {
  if (!Number.isFinite(value)) return GAP_DEFAULT_MM;
  return Math.min(GAP_MAX_MM, Math.max(GAP_MIN_MM, Math.round(value)));
}

export function clampMargin(value: number): number {
  if (!Number.isFinite(value)) return MARGIN_DEFAULT_MM;
  return Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, Math.round(value)));
}
