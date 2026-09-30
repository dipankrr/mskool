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
  gapMm,
  scale = 0.55,
}: {
  pages: IdCardStudentCard[][];
  template: IdCardTemplateDataInput;
  /** Columns per sheet — the same value the print sheet computes. */
  columns: number;
  cardWidthMm: number;
  gapMm: number;
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
                  gap: `${gapMm}mm`,
                }}
              >
                {pageCards.map((card) => (
                  <IdCardPreview
                    key={card.studentId}
                    template={template}
                    card={card}
                    cutGuide
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
