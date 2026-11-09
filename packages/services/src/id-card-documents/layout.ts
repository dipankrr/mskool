import type { IdCardPrintPaper } from "@repo/contracts";

/**
 * Where every card sits on the paper, in millimetres. Pure: no database, no HTML.
 *
 * A4 keeps the school's margins (left and right, top and bottom) and centres the grid on the sheet both ways. Centring is what
 * makes two-sided printing line up: turning the sheet over mirrors it about its middle,
 * so a card's back must sit at the mirror of its front, and on a centred grid that
 * mirror is exactly another grid slot. (A grid pinned to the left margin puts the backs
 * off by the unused width, 14mm for two landscape cards.)
 */

export const A4_MM = { width: 210, height: 297 } as const;

/** expo-print takes page sizes in points, 72 to the inch. */
export const mmToPt = (mm: number) => (mm * 72) / 25.4;

/** The check line and its words need this much free paper below the cards. */
export const RULER_NEEDS_MM = 6;

export type CardSize = { widthMm: number; heightMm: number };

export type Slot = { xMm: number; yMm: number };

export type SheetGrid = {
  columns: number;
  rows: number;
  perSheet: number;
  /** Front slots in reading order: row by row, left to right. */
  slots: Slot[];
  /** Free paper below the last row (equal to the space above it). */
  bottomSpaceMm: number;
};

/** How many cards fit across and down an A4 sheet, and where each one goes. */
export function a4Grid(
  card: CardSize,
  gaps: { columnGapMm: number; rowGapMm: number; marginXMm: number; marginYMm: number },
): SheetGrid {
  const { columnGapMm, rowGapMm } = gaps;
  const printableWidth = Math.max(0, A4_MM.width - 2 * gaps.marginXMm);
  const printableHeight = Math.max(0, A4_MM.height - 2 * gaps.marginYMm);
  const columns = Math.max(
    1,
    Math.floor((printableWidth + columnGapMm) / (card.widthMm + columnGapMm)),
  );
  const rows = Math.max(
    1,
    Math.floor((printableHeight + rowGapMm) / (card.heightMm + rowGapMm)),
  );
  const gridWidth = columns * card.widthMm + (columns - 1) * columnGapMm;
  const gridHeight = rows * card.heightMm + (rows - 1) * rowGapMm;
  const left = (A4_MM.width - gridWidth) / 2;
  const top = (A4_MM.height - gridHeight) / 2;

  const slots: Slot[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        xMm: left + column * (card.widthMm + columnGapMm),
        yMm: top + row * (card.heightMm + rowGapMm),
      });
    }
  }
  return { columns, rows, perSheet: columns * rows, slots, bottomSpaceMm: top };
}

/**
 * Where a card's back goes on the other side of the sheet. Turning on the long edge
 * (the usual duplex setting for a portrait A4 sheet) mirrors left and right; turning on
 * the short edge mirrors top and bottom.
 */
export function backSlot(front: Slot, card: CardSize, flip: "long" | "short"): Slot {
  return flip === "long"
    ? { xMm: A4_MM.width - front.xMm - card.widthMm, yMm: front.yMm }
    : { xMm: front.xMm, yMm: A4_MM.height - front.yMm - card.heightMm };
}

/** One printed page: its size and the cards on it, each placed and sided. */
export type PlacedPage<T> = {
  widthMm: number;
  heightMm: number;
  /** A4 sheets carry cut lines; card-size pages don't. */
  sheet: boolean;
  /** Room for the 50mm check line below the cards: the free space, or 0 when there is none. */
  rulerSpaceMm: number;
  cards: { item: T; side: "front" | "back"; slot: Slot }[];
};

/**
 * Lays the cards out page by page. On A4 each sheet of fronts is followed by its sheet
 * of backs (when the design has a back), so the printer's two-sided pass pairs them.
 * On card size each card is a page, followed by its back.
 */
export function placeCards<T>(
  items: T[],
  card: CardSize,
  paper: IdCardPrintPaper,
  twoSided: boolean,
): PlacedPage<T>[] {
  if (paper.kind === "card") {
    const pages: PlacedPage<T>[] = [];
    for (const item of items) {
      const page = (side: "front" | "back"): PlacedPage<T> => ({
        widthMm: card.widthMm,
        heightMm: card.heightMm,
        sheet: false,
        rulerSpaceMm: 0,
        cards: [{ item, side, slot: { xMm: 0, yMm: 0 } }],
      });
      pages.push(page("front"));
      if (twoSided) pages.push(page("back"));
    }
    return pages;
  }

  const grid = a4Grid(card, paper);
  const rulerSpaceMm = grid.bottomSpaceMm >= RULER_NEEDS_MM ? grid.bottomSpaceMm : 0;
  const pages: PlacedPage<T>[] = [];
  for (let start = 0; start < items.length; start += grid.perSheet) {
    const batch = items.slice(start, start + grid.perSheet);
    pages.push({
      widthMm: A4_MM.width,
      heightMm: A4_MM.height,
      sheet: true,
      rulerSpaceMm,
      cards: batch.map((item, index) => ({ item, side: "front", slot: grid.slots[index]! })),
    });
    if (twoSided) {
      pages.push({
        widthMm: A4_MM.width,
        heightMm: A4_MM.height,
        sheet: true,
        rulerSpaceMm,
        cards: batch.map((item, index) => ({
          item,
          side: "back",
          slot: backSlot(grid.slots[index]!, card, paper.flip),
        })),
      });
    }
  }
  return pages;
}
