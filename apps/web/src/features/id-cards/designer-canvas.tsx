"use client";

import { useRef } from "react";

import type {
  IdCardStudentCard,
  IdCardTemplateData,
} from "@repo/contracts";

import { copy } from "@/lib/copy";

import { ElementContent } from "./card-canvas";
import { cardSizeMm, MM_PX } from "./template";

/**
 * THE INTERACTIVE CANVAS (slice 2b) — the card surface with pointers on it.
 * Rendering comes from the shared `ElementContent` (the print pathway), so a
 * drag moves exactly the thing that prints. Geometry stays in
 * percent-of-card: the pointer delta is converted with the card's rendered
 * pixel size, and the designer state clamps the result.
 *
 * Accessibility: the canvas is focusable and answers the arrow keys — each
 * press nudges the selected element by 1% (Shift = 5%) — and Escape clears
 * the selection. Delete is deliberately NOT bound: removing an element is a
 * property-panel action, not a stray keystroke away from a layout someone
 * spent an hour on.
 */

type Corner = "nw" | "ne" | "sw" | "se";
type DragMode = "move" | Corner;
type Geometry = { x: number; y: number; width: number; height: number };

const CLAMP = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const r2 = (value: number) => Math.round(value * 100) / 100;

/** The geometry a drag produces, computed from the drag's ORIGINAL box. */
function draggedGeometry(
  mode: DragMode,
  start: Geometry,
  dxPct: number,
  dyPct: number,
): Geometry {
  if (mode === "move") {
    return {
      x: CLAMP(start.x + dxPct, 0, 100 - start.width),
      y: CLAMP(start.y + dyPct, 0, 100 - start.height),
      width: start.width,
      height: start.height,
    };
  }

  const right = start.x + start.width;
  const bottom = start.y + start.height;

  const eastWidth = CLAMP(start.width + dxPct, 1, 100 - start.x);
  const southHeight = CLAMP(start.height + dyPct, 1, 100 - start.y);
  const northY = CLAMP(start.y + dyPct, 0, bottom - 1);
  const westX = CLAMP(start.x + dxPct, 0, right - 1);

  switch (mode) {
    case "se":
      return { x: start.x, y: start.y, width: eastWidth, height: southHeight };
    case "ne":
      return {
        x: start.x,
        y: northY,
        width: eastWidth,
        height: r2(start.height - (northY - start.y)),
      };
    case "sw":
      return {
        x: westX,
        y: start.y,
        width: r2(start.width - (westX - start.x)),
        height: southHeight,
      };
    case "nw":
      return {
        x: westX,
        y: northY,
        width: r2(start.width - (westX - start.x)),
        height: r2(start.height - (northY - start.y)),
      };
  }
}

export function DesignerCanvas({
  template,
  sampleCard,
  selectedId,
  onSelect,
  onGeometry,
  scale = 4,
}: {
  template: IdCardTemplateData;
  /** Design-time sample data — see template-designer.tsx for why. */
  sampleCard: IdCardStudentCard;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onGeometry: (id: string, patch: Partial<Geometry>) => void;
  scale?: number;
}) {
  const { widthMm, heightMm } = cardSizeMm(template.orientation);
  const pxWidth = widthMm * MM_PX * scale;
  const pxHeight = heightMm * MM_PX * scale;

  const drag = useRef<{
    mode: DragMode;
    id: string;
    startX: number;
    startY: number;
    start: Geometry;
  } | null>(null);

  function beginDrag(
    event: React.PointerEvent,
    id: string,
    mode: DragMode,
    start: Geometry,
  ) {
    event.preventDefault();
    event.stopPropagation();
    onSelect(id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      id,
      startX: event.clientX,
      startY: event.clientY,
      start,
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current;
    if (!state) return;
    const dxPct = ((event.clientX - state.startX) / pxWidth) * 100;
    const dyPct = ((event.clientY - state.startY) / pxHeight) * 100;
    const next = draggedGeometry(state.mode, state.start, dxPct, dyPct);
    onGeometry(state.id, next);
  }

  function endDrag() {
    drag.current = null;
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!selectedId) return;
    const step = event.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      onNudge(selectedId, move[0], move[1]);
      return;
    }
    if (event.key === "Escape") {
      onSelect(null);
    }
  }

  // onGeometry clamps; the nudge path rides the same prop via the parent.
  const onNudge = (id: string, dx: number, dy: number) => {
    const element = template.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    onGeometry(id, { x: element.x + dx, y: element.y + dy });
  };

  return (
    <div
      role="group"
      aria-label={copy.idCards.designer.canvasAria}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="idcard-designer-canvas focus-visible:outline-ring relative rounded-md outline-2 outline-offset-2 focus-visible:outline-solid"
      style={{ width: pxWidth, height: pxHeight, touchAction: "none" }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={(event) => {
        // A click on the bare card clears the selection.
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      <div
        style={{
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
          overflow: "hidden",
          background: "#ffffff",
          color: "#111827",
          fontFamily: "var(--font-sans, sans-serif)",
        }}
      >
        {template.elements.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-center text-[8pt] text-gray-400">
            {copy.idCards.designer.emptyCanvas}
          </div>
        ) : null}

        {template.elements.map((element) => {
          const selected = element.id === selectedId;
          return (
            <div
              key={element.id}
              role="button"
              aria-label={elementAriaLabel(element)}
              tabIndex={-1}
              style={{
                position: "absolute",
                left: `${element.x}%`,
                top: `${element.y}%`,
                width: `${element.width}%`,
                height: `${element.height}%`,
                overflow: "hidden",
                cursor: "move",
                touchAction: "none",
                outline: selected
                  ? "1.5px solid #2563eb"
                  : "1px dashed rgba(37, 99, 235, 0.35)",
                outlineOffset: "-1px",
                opacity: element.visible === false ? 0.4 : 1,
              }}
              onPointerDown={(event) =>
                beginDrag(event, element.id, "move", element)
              }
            >
              <ElementContent element={element} card={sampleCard} />
              {selected
                ? (["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
                    <div
                      key={corner}
                      aria-hidden
                      style={{
                        position: "absolute",
                        width: 10,
                        height: 10,
                        background: "#ffffff",
                        border: "2px solid #2563eb",
                        borderRadius: 2,
                        cursor: `${corner}-resize`,
                        touchAction: "none",
                        ...(corner.includes("n") ? { top: -5 } : { bottom: -5 }),
                        ...(corner.includes("w") ? { left: -5 } : { right: -5 }),
                      }}
                      onPointerDown={(event) =>
                        beginDrag(event, element.id, corner, element)
                      }
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function elementAriaLabel(element: IdCardTemplateData["elements"][number]): string {
  switch (element.type) {
    case "text":
      return `${copy.idCards.designer.elementText}: ${element.binding === "custom" ? element.customText ?? "" : element.binding}`;
    case "photo":
      return copy.idCards.designer.elementPhoto;
    case "qr":
      return copy.idCards.designer.elementQr;
    case "logo":
      return copy.idCards.designer.elementLogo;
  }
}
