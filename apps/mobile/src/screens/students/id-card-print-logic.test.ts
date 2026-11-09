import { a4Fit, cardSizeOf, clampGap, sheetCount } from "./id-card-print-logic";

describe("id card print arithmetic", () => {
  it("fits the API's sheets", () => {
    expect(a4Fit({ widthMm: 86, heightMm: 54 }, 4, 4)).toEqual({ columns: 2, rows: 4, perSheet: 8 });
    expect(a4Fit({ widthMm: 86, heightMm: 54 }, 0, 0)).toEqual({ columns: 2, rows: 5, perSheet: 10 });
    expect(a4Fit({ widthMm: 54, heightMm: 86 }, 4, 4)).toEqual({ columns: 3, rows: 3, perSheet: 9 });
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
  });
});
