/**
 * The print sheet's arithmetic, kept beside the screen so the "8 cards per sheet" line
 * matches what the API lays out (packages/services id-card-documents/layout.ts): A4
 * less a 10mm margin each side, the chosen gaps, cards at their real size.
 */

export const GAP_MIN_MM = 0;
export const GAP_MAX_MM = 20;
export const GAP_DEFAULT_MM = 4;

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

export function a4Fit(card: CardSize, columnGapMm: number, rowGapMm: number) {
  const columns = Math.max(1, Math.floor((190 + columnGapMm) / (card.widthMm + columnGapMm)));
  const rows = Math.max(1, Math.floor((277 + rowGapMm) / (card.heightMm + rowGapMm)));
  return { columns, rows, perSheet: columns * rows };
}

export function sheetCount(cards: number, perSheet: number): number {
  return cards <= 0 ? 0 : Math.ceil(cards / perSheet);
}

export function clampGap(value: number): number {
  if (!Number.isFinite(value)) return GAP_DEFAULT_MM;
  return Math.min(GAP_MAX_MM, Math.max(GAP_MIN_MM, Math.round(value)));
}
