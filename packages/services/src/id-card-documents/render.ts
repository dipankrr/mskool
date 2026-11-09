import type {
  IdCardElement,
  IdCardPrintPaper,
  IdCardStudentCard,
  IdCardTemplateData,
} from "@repo/contracts";
import { esc } from "../fee-documents/html";
import { SPACE_GROTESK_400, SPACE_GROTESK_700 } from "./font";
import { mmToPt, placeCards, type CardSize, type Slot } from "./layout";

/**
 * ID cards as one finished HTML page, which the phone turns into a PDF (ADR-059's
 * pattern). This mirrors the web's card renderer (apps/web features/id-cards
 * card-canvas.tsx): elements are placed in percent of the card, text keeps the web's
 * size, weight, line height and wrapping, and the card font is the web's own Space
 * Grotesk, embedded. Pure: images and QR codes arrive ready to place.
 */

export type RenderCard = {
  card: IdCardStudentCard;
  /** The photo as a data URI, shrunk to print size. Null prints the grey empty box. */
  photo: string | null;
  /** The QR code as inline SVG. Null leaves the QR slot empty. */
  qrSvg: string | null;
};

export type RenderInput = {
  title: string;
  template: IdCardTemplateData;
  cards: RenderCard[];
  /** Template images (backgrounds, logos) by asset id, as data URIs. */
  assets: Map<string, string>;
  paper: IdCardPrintPaper;
};

/** The card's physical size, the web's rule: the template's own size, else CR80. */
export function cardSizeMm(template: Pick<IdCardTemplateData, "orientation" | "canvas">): CardSize {
  if (template.canvas.widthMm && template.canvas.heightMm) {
    return { widthMm: template.canvas.widthMm, heightMm: template.canvas.heightMm };
  }
  return template.orientation === "landscape"
    ? { widthMm: 86, heightMm: 54 }
    : { widthMm: 54, heightMm: 86 };
}

/** The web's one translation from a binding to the card field it reads. */
export function bindingValue(
  element: Extract<IdCardElement, { type: "text" }>,
  card: IdCardStudentCard,
): string {
  if (element.binding === "custom") return element.customText ?? "";
  const key = element.binding === "studentName" ? "name" : element.binding;
  const value: unknown = card[key as keyof IdCardStudentCard];
  return value === null || value === undefined ? "" : String(value);
}

const n = (value: number) => Number(value.toFixed(3));

export function renderIdCards(input: RenderInput): {
  html: string;
  width: number;
  height: number;
} {
  const size = cardSizeMm(input.template);
  const back = input.template.back ?? null;
  const pages = placeCards(input.cards, size, input.paper, back !== null);

  // Each template image is written once, as a CSS class, however many cards use it.
  const assetClass = new Map<string, string>();
  const classFor = (assetId: string | null | undefined): string | null => {
    if (!assetId || !input.assets.has(assetId)) return null;
    let name = assetClass.get(assetId);
    if (!name) {
      name = `a${assetClass.size}`;
      assetClass.set(assetId, name);
    }
    return name;
  };

  const side = (canvas: IdCardTemplateData["canvas"], elements: IdCardElement[], item: RenderCard) => {
    const background = classFor(canvas.backgroundAssetId);
    return [
      background ? `<div class="bg ${background}"></div>` : "",
      ...elements
        .filter((element) => element.visible !== false)
        .map((element) => elementHtml(element, item, classFor)),
    ].join("");
  };

  const cardHtml = (item: RenderCard, which: "front" | "back", slot: Slot, sheet: boolean) => {
    const design =
      which === "front" || !back
        ? { canvas: input.template.canvas, elements: input.template.elements }
        : back;
    const radius = input.template.canvas.cornerRadiusMm;
    const style = [
      `left:${n(slot.xMm)}mm`,
      `top:${n(slot.yMm)}mm`,
      `width:${n(size.widthMm)}mm`,
      `height:${n(size.heightMm)}mm`,
      radius ? `border-radius:${n(radius)}mm` : "",
    ]
      .filter(Boolean)
      .join(";");
    return `<div class="card${sheet ? " cut" : ""}" style="${style}">${side(design.canvas, design.elements, item)}</div>`;
  };

  const body = pages
    .map((page) => {
      const cards = page.cards
        .map(({ item, side: which, slot }) => cardHtml(item, which, slot, page.sheet))
        .join("");
      return `<div class="page" style="width:${n(page.widthMm)}mm;height:${n(page.heightMm)}mm">${cards}${
        page.sheet ? RULER : ""
      }</div>`;
    })
    .join("");

  const first = pages[0] ?? { widthMm: size.widthMm, heightMm: size.heightMm };
  const assetCss = [...assetClass.entries()]
    .map(([assetId, name]) => `.${name}{background-image:url("${input.assets.get(assetId)}")}`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(input.title)}</title><style>
@page{size:${n(first.widthMm)}mm ${n(first.heightMm)}mm;margin:0}
@font-face{font-family:"Space Grotesk";font-weight:400;font-style:normal;src:url(data:font/woff2;base64,${SPACE_GROTESK_400}) format("woff2")}
@font-face{font-family:"Space Grotesk";font-weight:700;font-style:normal;src:url(data:font/woff2;base64,${SPACE_GROTESK_700}) format("woff2")}
${CSS}${assetCss}
</style></head><body>${body}</body></html>`;

  return { html, width: mmToPt(first.widthMm), height: mmToPt(first.heightMm) };
}

function elementHtml(
  element: IdCardElement,
  item: RenderCard,
  classFor: (assetId: string | null | undefined) => string | null,
): string {
  const box = [
    `left:${n(element.x)}%`,
    `top:${n(element.y)}%`,
    `width:${n(element.width)}%`,
    `height:${n(element.height)}%`,
    element.borderRadius ? `border-radius:${n(element.borderRadius)}%` : "",
  ]
    .filter(Boolean)
    .join(";");

  let inner = "";
  if (element.type === "text") {
    const justify =
      element.align === "right" ? "flex-end" : element.align === "center" ? "center" : "flex-start";
    const style = [
      `justify-content:${justify}`,
      `font-size:${n(element.fontSize)}pt`,
      `font-weight:${element.fontWeight === "bold" ? 700 : 400}`,
      `color:${element.color}`,
    ].join(";");
    inner = `<div class="txt" style="${style}">${esc(bindingValue(element, item.card))}</div>`;
  } else if (element.type === "photo") {
    inner = item.photo ? `<img class="fill" src="${item.photo}" alt=""/>` : `<div class="empty"></div>`;
  } else if (element.type === "qr") {
    inner = item.qrSvg ? `<div class="qr">${item.qrSvg}</div>` : "";
  } else {
    const logo = classFor(element.assetId);
    inner = logo ? `<div class="logo ${logo}"></div>` : "";
  }
  return `<div class="el" style="${box}">${inner}</div>`;
}

/**
 * A 50mm line in the bottom margin of each A4 sheet. If it doesn't measure 50mm on
 * paper, the printer scaled the page and the cards are the wrong size too.
 */
const RULER = `<div class="ruler"><div class="ruler-line"></div><div class="ruler-label">This line is 50 mm. If it measures less or more, set the printer to actual size (100%).</div></div>`;

const CSS = `
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0;background:#fff}
.page{position:relative;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.card{position:absolute;overflow:hidden;background:#fff;color:#111827;font-family:"Space Grotesk","Noto Sans","Noto Sans Bengali","Noto Sans Devanagari",Roboto,sans-serif}
.card.cut{outline:0.2mm dashed #9ca3af;outline-offset:0.5mm}
.bg{position:absolute;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat}
.el{position:absolute;overflow:hidden}
.txt{width:100%;height:100%;display:flex;align-items:center;line-height:1.15;white-space:pre-wrap;word-break:break-word}
.fill{display:block;width:100%;height:100%;object-fit:cover}
.empty{width:100%;height:100%;background:#f3f4f6}
.qr,.qr svg{display:block;width:100%;height:100%}
.logo{width:100%;height:100%;background-size:contain;background-repeat:no-repeat;background-position:center}
.ruler{position:absolute;left:10mm;bottom:4mm;display:flex;align-items:center;gap:3mm;font-family:"Noto Sans",Roboto,sans-serif;font-size:6.5pt;color:#6b7280}
.ruler-line{width:50mm;height:2mm;border-left:0.25mm solid #6b7280;border-right:0.25mm solid #6b7280;background:linear-gradient(#6b7280,#6b7280) center/100% 0.25mm no-repeat}
`;
