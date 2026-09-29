"use client";

import type {
  IdCardStudentCard,
  IdCardTemplateDataInput,
} from "@repo/contracts";

import { CardLayer } from "./card-canvas";
import { cardSizeMm, MM_PX } from "./template";

/**
 * THE CARD PREVIEW (slice 2a; rendering extracted into card-canvas.tsx in
 * 2b so the designer drives the identical surface — what is designed is what
 * prints).
 *
 * Lays a template's elements out over a CR80 card (86 × 54mm landscape /
 * 54 × 86mm portrait) against ONE student's server-resolved card payload.
 * Every element positions in percent-of-card, so the same template prints
 * identically on paper and previews on screen — the only difference is the
 * `scale` wrapper. The browser invents nothing: a binding the payload cannot
 * satisfy renders empty.
 */
export function IdCardPreview({
  template,
  card,
  scale = 1,
  cutGuide = false,
  className,
}: {
  /** The write shape — defaults (weight/color/align/visible) may be absent. */
  template: IdCardTemplateDataInput;
  card: IdCardStudentCard | null;
  /** Screen preview scale; print renders at 1 (physical mm) elsewhere. */
  scale?: number;
  /** Dashed cut guide around the card (print sheets use it). */
  cutGuide?: boolean;
  className?: string;
}) {
  const { widthMm, heightMm } = cardSizeMm(template);

  return (
    <div
      className={className}
      style={{
        width: widthMm * MM_PX * scale,
        height: heightMm * MM_PX * scale,
      }}
    >
      <div
        style={{
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
          overflow: "hidden",
          background: "#ffffff",
          color: "#111827",
          outline: cutGuide ? "0.2mm dashed #9ca3af" : undefined,
          outlineOffset: cutGuide ? "0.5mm" : undefined,
          fontFamily: "var(--font-sans, sans-serif)",
        }}
      >
        <CardLayer template={template} card={card} />
      </div>
    </div>
  );
}
