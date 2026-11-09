import { a4Fit, cardSizeOf, clampGap, clampMargin, sheetCount } from "./id-card-print-logic";

const sp = (columnGapMm: number, rowGapMm: number, margin = 8) => ({
  columnGapMm,
  rowGapMm,
  marginXMm: margin,
  marginYMm: margin,
});

describe("id card print arithmetic", () => {
  it("fits five landscape rows at a 2mm gap with the default margin", () => {
    expect(a4Fit({ widthMm: 86, heightMm: 54 }, sp(2, 2)).rows).toBe(5);
    expect(a4Fit({ widthMm: 86, heightMm: 54 }, sp(2, 2, 10)).rows).toBe(4);
  });

  it("fits the API's sheets", () => {
    expect(a4Fit({ widthMm: 86, heightMm: 54 }, sp(4, 4))).toEqual({ columns: 2, rows: 4, perSheet: 8 });
    expect(a4Fit({ widthMm: 86, heightMm: 54 }, sp(0, 0))).toEqual({ columns: 2, rows: 5, perSheet: 10 });
    expect(a4Fit({ widthMm: 54, heightMm: 86 }, sp(4, 4))).toEqual({ columns: 3, rows: 3, perSheet: 9 });
  });

  it("reads the template's size, else CR80", () => {
    expect(cardSizeOf({ orientation: "portrait", canvas: {} })).toEqual({ widthMm: 54, heightMm: 86 });
    expect(cardSizeOf({ orientation: "landscape", canvas: null })).toEqual({ widthMm: 86, heightMm: 54 });
    expect(cardSizeOf({ orientation: "landscape", canvas: { widthMm: 90, heightMm: 60 } })).toEqual({
      widthMm: 90,
      heightMm: 60,
    });
  });

  it("counts sheets and keeps gaps in range", () => {
    expect(sheetCount(0, 8)).toBe(0);
    expect(sheetCount(17, 8)).toBe(3);
    expect(clampGap(-3)).toBe(0);
    expect(clampGap(25)).toBe(20);
    expect(clampGap(Number.NaN)).toBe(4);
    expect(clampMargin(-1)).toBe(0);
    expect(clampMargin(150)).toBe(100);
    expect(clampMargin(Number.NaN)).toBe(8);
  });
});
