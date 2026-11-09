import type { IdCardStudentCard, IdCardTemplateData } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { a4Grid, backSlot, mmToPt, placeCards } from "./layout";
import { bindingValue, cardSizeMm, renderIdCards, type RenderCard } from "./render";

const g = (columnGapMm: number, rowGapMm: number, marginMm = 8) => ({
  columnGapMm,
  rowGapMm,
  marginXMm: marginMm,
  marginYMm: marginMm,
});

const landscape = { widthMm: 86, heightMm: 54 };
const portrait = { widthMm: 54, heightMm: 86 };

const card = (overrides: Partial<IdCardStudentCard> = {}): IdCardStudentCard => ({
  studentId: "00000000-0000-4000-8000-000000000001",
  name: "Asha Roy",
  admissionNumber: "A-001",
  rollNumber: "7",
  className: "Class 8",
  sectionName: "A",
  academicYear: "2026-27",
  dateOfBirth: "2013-04-02",
  bloodGroup: null,
  address: null,
  guardianName: "Ravi Roy",
  motherName: null,
  validTill: "2027-03-31",
  photo: null,
  schoolName: "Green Field School",
  ...overrides,
});

const template = (overrides: Partial<IdCardTemplateData> = {}): IdCardTemplateData => ({
  orientation: "landscape",
  canvas: { backgroundAssetId: null },
  elements: [
    {
      id: "name",
      type: "text",
      binding: "studentName",
      x: 40,
      y: 10,
      width: 55,
      height: 12,
      visible: true,
      fontSize: 10,
      fontWeight: "bold",
      color: "#112233",
      align: "center",
    },
    { id: "photo", type: "photo", x: 5, y: 10, width: 30, height: 60, visible: true },
    { id: "qr", type: "qr", x: 75, y: 60, width: 20, height: 32, visible: true },
    {
      id: "hidden",
      type: "text",
      binding: "custom",
      customText: "SECRET",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      visible: false,
      fontSize: 8,
      fontWeight: "normal",
      color: "#000000",
      align: "left",
    },
  ],
  back: null,
  ...overrides,
});

const item = (overrides: Partial<RenderCard> = {}): RenderCard => ({
  card: card(),
  photo: null,
  qrSvg: null,
  ...overrides,
});

describe("a4Grid", () => {
  it("fits the web's sheets at the default 4mm gaps", () => {
    expect(a4Grid(landscape, g(4, 4))).toMatchObject({ columns: 2, rows: 4, perSheet: 8 });
    expect(a4Grid(portrait, g(4, 4))).toMatchObject({ columns: 3, rows: 3, perSheet: 9 });
  });

  it("fits a fifth row of landscape cards with no row gap", () => {
    expect(a4Grid(landscape, g(0, 0))).toMatchObject({ columns: 2, rows: 5, perSheet: 10 });
  });

  it("fits five rows at a 2mm gap with the 8mm default margin, four with 10mm", () => {
    expect(a4Grid(landscape, g(2, 2)).rows).toBe(5);
    expect(a4Grid(landscape, g(2, 2, 10)).rows).toBe(4);
  });

  it("takes side and top margins separately", () => {
    const grid = a4Grid(landscape, { columnGapMm: 4, rowGapMm: 4, marginXMm: 0, marginYMm: 30 });
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(4);
  });

  it("centres the grid on the sheet", () => {
    const grid = a4Grid(landscape, g(4, 4));
    const first = grid.slots[0]!;
    const last = grid.slots[grid.slots.length - 1]!;
    expect(first.xMm).toBeCloseTo(210 - (last.xMm + 86));
    expect(first.yMm).toBeCloseTo(297 - (last.yMm + 54));
    expect(first.xMm).toBeGreaterThanOrEqual(8);
  });
});

describe("backSlot", () => {
  it("puts each back behind its own front when the sheet turns on the long edge", () => {
    const grid = a4Grid(landscape, g(4, 4));
    // Row 0: the left card's back is the right slot on the other side, and vice versa.
    expect(backSlot(grid.slots[0]!, landscape, "long")).toEqual(grid.slots[1]);
    expect(backSlot(grid.slots[1]!, landscape, "long")).toEqual(grid.slots[0]);
  });

  it("swaps rows when the sheet turns on the short edge", () => {
    const grid = a4Grid(landscape, g(4, 4));
    const back = backSlot(grid.slots[0]!, landscape, "short");
    expect(back.xMm).toBeCloseTo(grid.slots[6]!.xMm);
    expect(back.yMm).toBeCloseTo(grid.slots[6]!.yMm);
  });

  it("lines up for portrait cards too, whatever the gap", () => {
    const grid = a4Grid(portrait, g(7, 2));
    const back = backSlot(grid.slots[0]!, portrait, "long");
    expect(back.xMm).toBeCloseTo(grid.slots[grid.columns - 1]!.xMm);
  });
});

describe("placeCards", () => {
  it("follows each A4 sheet of fronts with its sheet of backs", () => {
    const pages = placeCards([1, 2, 3, 4, 5, 6, 7, 8, 9], landscape, { kind: "a4", ...g(4, 4), flip: "long" }, true);
    expect(pages.map((page) => page.cards[0]!.side)).toEqual(["front", "back", "front", "back"]);
    expect(pages[0]!.cards).toHaveLength(8);
    expect(pages[2]!.cards).toHaveLength(1);
    expect(pages.every((page) => page.sheet)).toBe(true);
  });

  it("makes one card-size page per side, with no cut lines", () => {
    const pages = placeCards([1, 2], landscape, { kind: "card" }, true);
    expect(pages).toHaveLength(4);
    expect(pages[0]).toMatchObject({ widthMm: 86, heightMm: 54, sheet: false });
  });
});

describe("renderIdCards", () => {
  const a4 = { kind: "a4" as const, ...g(4, 4), flip: "long" as const };

  it("sizes the PDF to A4 exactly and draws cards at their real size", () => {
    const out = renderIdCards({ title: "ID cards", template: template(), cards: [item()], assets: new Map(), paper: a4 });
    expect(out.width).toBeCloseTo(mmToPt(210));
    expect(out.height).toBeCloseTo(mmToPt(297));
    expect(out.html).toContain("@page{size:210mm 297mm;margin:0}");
    expect(out.html).toContain("width:86mm;height:54mm");
    expect(out.html).toContain("This line is 50 mm");
  });

  it("leaves the check line out when the cards use the whole sheet", () => {
    // Three 99mm-tall cards fill 297mm exactly: no room left below.
    const full = renderIdCards({
      title: "t",
      template: template({ canvas: { backgroundAssetId: null, widthMm: 86, heightMm: 99 } }),
      cards: [item()],
      assets: new Map(),
      paper: { kind: "a4", columnGapMm: 0, rowGapMm: 0, marginXMm: 0, marginYMm: 0, flip: "long" },
    });
    expect(full.html).not.toContain("This line is 50 mm");
  });

  it("sizes card-size pages to the card, without the ruler or cut lines", () => {
    const out = renderIdCards({ title: "ID cards", template: template(), cards: [item()], assets: new Map(), paper: { kind: "card" } });
    expect(out.width).toBeCloseTo(mmToPt(86));
    expect(out.html).toContain("@page{size:86mm 54mm;margin:0}");
    expect(out.html).not.toContain("This line is 50 mm");
    expect(out.html).not.toContain('class="card cut"');
  });

  it("escapes what people typed and skips hidden elements", () => {
    const out = renderIdCards({
      title: "ID cards",
      template: template(),
      cards: [item({ card: card({ name: '<b>Asha</b> "R"' }) })],
      assets: new Map(),
      paper: a4,
    });
    expect(out.html).toContain("&lt;b&gt;Asha&lt;/b&gt; &quot;R&quot;");
    expect(out.html).not.toContain("SECRET");
    expect(out.html).toContain("font-size:10pt;font-weight:700;color:#112233");
  });

  it("prints the grey box for a missing photo and the photo when there is one", () => {
    const without = renderIdCards({ title: "t", template: template(), cards: [item()], assets: new Map(), paper: a4 });
    expect(without.html).toContain('<div class="empty"></div>');
    const withPhoto = renderIdCards({
      title: "t",
      template: template(),
      cards: [item({ photo: "data:image/jpeg;base64,AAAA" })],
      assets: new Map(),
      paper: a4,
    });
    expect(withPhoto.html).toContain('src="data:image/jpeg;base64,AAAA"');
  });

  it("writes a shared background once however many cards use it", () => {
    const bg = "11111111-1111-4111-8111-111111111111";
    const out = renderIdCards({
      title: "t",
      template: template({ canvas: { backgroundAssetId: bg } }),
      cards: [item(), item(), item()],
      assets: new Map([[bg, "data:image/png;base64,BGBG"]]),
      paper: a4,
    });
    expect(out.html.split("BGBG")).toHaveLength(2);
    expect(out.html.split('class="bg a0"')).toHaveLength(4);
  });

  it("embeds the web's card font", () => {
    const out = renderIdCards({ title: "t", template: template(), cards: [item()], assets: new Map(), paper: a4 });
    expect(out.html).toContain('font-family:"Space Grotesk"');
    expect(out.html).toContain("data:font/woff2;base64,");
  });
});

describe("bindingValue and cardSizeMm", () => {
  it("reads the card field each binding names, empty when missing", () => {
    const element = template().elements[0] as Extract<IdCardTemplateData["elements"][number], { type: "text" }>;
    expect(bindingValue(element, card())).toBe("Asha Roy");
    expect(bindingValue({ ...element, binding: "bloodGroup" }, card())).toBe("");
    expect(bindingValue({ ...element, binding: "custom", customText: "Motto" }, card())).toBe("Motto");
  });

  it("uses the template's own size, else CR80 for the orientation", () => {
    expect(cardSizeMm({ orientation: "portrait", canvas: {} })).toEqual(portrait);
    expect(cardSizeMm({ orientation: "landscape", canvas: { widthMm: 90, heightMm: 60 } })).toEqual({ widthMm: 90, heightMm: 60 });
  });
});
