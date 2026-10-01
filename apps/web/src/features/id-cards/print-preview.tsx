"use client";

import type { IdCardStudentCard, IdCardTemplateDataInput } from "@repo/contracts";

import { IdCardPreview } from "./id-card-preview";
import { copy } from "@/lib/copy";

/**
 * THE LIVE PRINT PREVIEW — full A4 sheets exactly as the printer will lay
 * them out (same grid math, same gap, same cut guides), rendered on screen
 * at a reduced scale, LIVE: it re-flows as the operator picks students,
 * changes the template, or edits the gap. This is the same geometry as
 * .idcard-print-page / .idcard-print-grid — the preview is the contract,
 * not an approximation.
 */
export function A4Sheets({
  pages,
  template,
  columns,
  cardWidthMm,
  cardHeightMm,
  columnGapMm,
  rowGapMm,
  scale = 0.55,
}: {
  /** One page per entry; null = an empty card slot (backs of a partial
   * final row still occupy their grid position for duplex alignment). */
  pages: (IdCardStudentCard | null)[][];
  template: IdCardTemplateDataInput;
  /** Columns per sheet — the same value the print sheet computes. */
  columns: number;
  cardWidthMm: number;
  cardHeightMm: number;
  /** Horizontal spacing between cards (mm). */
  columnGapMm: number;
  /** Vertical spacing between card rows (mm). */
  rowGapMm: number;
  /** On-screen reduction — the sheet itself stays in physical mm. */
  scale?: number;
}) {
  return (
    <div className="flex flex-col items-start gap-6">
      {pages.map((pageCards, pageIndex) => (
        <div key={pageIndex} className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            {copy.idCards.pdfPreview.sheetLabel(pageIndex + 1, pages.length)}
          </span>
          <div
            style={{
              width: `${210 * scale}mm`,
              height: `${297 * scale}mm`,
              overflow: "hidden",
              boxShadow: "0 1px 8px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                width: "210mm",
                height: "297mm",
                padding: "10mm",
                background: "#ffffff",
                color: "#111827",
                boxSizing: "border-box",
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <div
                style={{
                  // IDENTICAL to .idcard-print-grid + the page's inline
                  // gridTemplateColumns — the preview is the contract.
                  display: "grid",
                  gridTemplateColumns: `repeat(${columns}, ${cardWidthMm}mm)`,
                  gap: `${rowGapMm}mm ${columnGapMm}mm`,
                }}
              >
                {pageCards.map((card, index) =>
                  card ? (
                    <IdCardPreview
                      key={card.studentId}
                      template={template}
                      card={card}
                      cutGuide
                    />
                  ) : (
                    // An empty slot keeps its grid position — duplex backs
                    // align against the fronts by POSITION, not by content.
                    <div
                      key={`empty-${index}`}
                      aria-hidden
                      style={{
                        width: `${cardWidthMm}mm`,
                        height: `${cardHeightMm}mm`,
                        outline: "0.2mm dashed #9ca3af",
                        outlineOffset: "0.5mm",
                      }}
                    />
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
