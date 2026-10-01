"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { IdCardTemplateData } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { parseTemplateData } from "./template";

/**
 * THE DESIGNER'S STATE (slice 2b) — an adopted template's design document,
 * edited as a DRAFT. Nothing reaches the server until the dirty bar's Save:
 * every drag, resize, palette add and property edit mutates local state, and
 * Save posts the whole document through `idCard.template.update` in one
 * call. Discard rewinds to the loaded row. That is the repo's dirty-bar
 * pattern (the permission editor, the papers editor), applied to a canvas.
 *
 * The draft is the PARSED design (the contract's output shape — defaults
 * filled), so the renderer never sees a half-specified element, and the save
 * payload satisfies the write shape by construction. Geometry lives in
 * percent-of-card, so the numbers a drag produced are exactly what print.
 */

const r2 = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type Geometry = { x: number; y: number; width: number; height: number };
type GeometryPatch = Partial<Geometry>;

/** Nudge/drag deltas land inside the card: position clamps to the box. */
function clampGeometry(geometry: Geometry, patch: GeometryPatch): Geometry {
  const width = patch.width !== undefined ? clamp(patch.width, 1, 100) : geometry.width;
  const height =
    patch.height !== undefined ? clamp(patch.height, 1, 100) : geometry.height;
  const x = patch.x !== undefined ? clamp(patch.x, 0, 100 - width) : geometry.x;
  const y = patch.y !== undefined ? clamp(patch.y, 0, 100 - height) : geometry.y;
  return { x: r2(x), y: r2(y), width: r2(width), height: r2(height) };
}

const newElementId = () => `el-${crypto.randomUUID()}`;

export type NewElementType = "text" | "photo" | "qr" | "logo";

/**
 * The designer's editable document: the design (orientation, canvas,
 * elements) plus the template's name — the one row field the designer edits.
 */
export type DesignerDraft = IdCardTemplateData & { name: string };

export function useTemplateDesigner(templateId: string) {
  const { organizationId, writeScopeArgs, has } = useActiveContext();
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const row = trpc.idCard.template.byId.useQuery(
    { organizationId, id: templateId },
    { enabled: Boolean(organizationId) && has("id_card:manage"), retry: false },
  );

  /**
   * Null when the row's jsonb predates or postdates the current contract.
   * `baseline` is what Discard rewinds to and what dirty compares against;
   * it starts as the loaded row and only a successful Save moves it — so a
   * background refetch never re-bases a mid-edit draft.
   */
  const parsed: DesignerDraft | null = useMemo(
    () =>
      row.data
        ? (() => {
            const design = parseTemplateData(row.data);
            return design ? { ...design, name: row.data.name } : null;
          })()
        : null,
    [row.data],
  );

  const [baseline, setBaseline] = useState<DesignerDraft | null>(null);
  const [draft, setDraft] = useState<DesignerDraft | null>(null);
  const draftRef = useRef<DesignerDraft | null>(null);
  draftRef.current = draft;

  useEffect(() => {
    if (!parsed) return;
    setBaseline((current) => current ?? structuredClone(parsed));
    setDraft((current) => current ?? structuredClone(parsed));
  }, [parsed]);

  /**
   * UNDO/REDO — a snapshot stack with drag coalescing. Every mutation
   * pushes the PREVIOUS draft before applying; consecutive mutations of the
   * same kind within 600ms (a drag's pointermove stream, a held arrow key)
   * coalesce into ONE history entry, so undo steps are meaningful actions,
   * not frames. Stacks live in a ref (not state — updates are computed from
   * the ref, immune to StrictMode's double-invoked updaters) with depth
   * mirrored into state purely for the buttons' disabled flags.
   */
  const historyRef = useRef<{
    stack: DesignerDraft[];
    future: DesignerDraft[];
    lastKind: string | null;
    lastAt: number;
  }>({ stack: [], future: [], lastKind: null, lastAt: 0 });
  const [historyDepth, setHistoryDepth] = useState(0);
  const [futureDepth, setFutureDepth] = useState(0);

  const dirty =
    draft !== null &&
    baseline !== null &&
    JSON.stringify(draft) !== JSON.stringify(baseline);

  const update = useCallback((mutate: (current: DesignerDraft) => DesignerDraft, kind?: string) => {
    const current = draftRef.current;
    if (!current) return;
    const next = mutate(current);
    if (next === current) return;
    const history = historyRef.current;
    const now = Date.now();
    const coalesce = kind !== undefined && history.lastKind === kind && now - history.lastAt < 600;
    if (!coalesce) {
      history.stack.push(current);
      if (history.stack.length > 60) history.stack.shift();
      history.future = [];
      setFutureDepth(0);
    }
    history.lastKind = kind ?? null;
    history.lastAt = now;
    setHistoryDepth(history.stack.length);
    draftRef.current = next;
    setDraft(next);
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    const current = draftRef.current;
    const previous = history.stack.pop();
    if (!previous || !current) {
      setHistoryDepth(history.stack.length);
      return;
    }
    history.future.push(current);
    history.lastKind = null;
    draftRef.current = previous;
    setDraft(previous);
    setHistoryDepth(history.stack.length);
    setFutureDepth(history.future.length);
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const current = draftRef.current;
    const next = history.future.pop();
    if (!next || !current) {
      setFutureDepth(history.future.length);
      return;
    }
    history.stack.push(current);
    history.lastKind = null;
    draftRef.current = next;
    setDraft(next);
    setHistoryDepth(history.stack.length);
    setFutureDepth(history.future.length);
  }, []);

  /** The side being edited. Element mutators route through it (read from a
   * ref — mutators are cached callbacks and must not capture stale state). */
  const [side, setSideState] = useState<"front" | "back">("front");
  const sideRef = useRef(side);
  sideRef.current = side;
  const setSide = useCallback((next: "front" | "back") => {
    setSideState(next);
    setSelectedId(null);
  }, []);

  /** Routes an ELEMENTS mutation to the active side's array. Back mutators
   * no-op when no back side exists (the designer's Add-back creates it). */
  const updateElements = useCallback(
    (mutate: (elements: IdCardTemplateData["elements"]) => IdCardTemplateData["elements"], kind?: string) => {
      update((current) => {
        if (sideRef.current === "back") {
          if (!current.back) return current;
          return {
            ...current,
            back: { ...current.back, elements: mutate(current.back.elements) },
          };
        }
        return { ...current, elements: mutate(current.elements) };
      }, kind);
    },
    [update],
  );

  const setGeometry = useCallback(
    (id: string, patch: GeometryPatch) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id
              ? { ...element, ...clampGeometry(element, patch) }
              : element,
          ),
        `geometry:${sideRef.current}:${id}`,
      );
    },
    [updateElements],
  );

  /** Arrow-key nudging — the same clamp as a drag, one percent at a time. */
  const nudge = useCallback(
    (id: string, dx: number, dy: number) => {
      updateElements(
        (elements) =>
          elements.map((element) =>
            element.id === id
              ? {
                  ...element,
                  ...clampGeometry(element, { x: element.x + dx, y: element.y + dy }),
                }
              : element,
          ),
        `geometry:${sideRef.current}:${id}`,
      );
    },
    [updateElements],
  );

  /**
   * Replaces one element wholesale. The element union is discriminated, so
   * property edits compute the next element with full typing rather than
   * merging an untyped patch. Kind is per element AND per keystroke — every
   * property edit is its own undo step (no coalescing: undefined kind).
   */
  const replaceElement = useCallback(
    (next: IdCardTemplateData["elements"][number]) => {
      updateElements(
        (elements) =>
          elements.map((element) => (element.id === next.id ? next : element)),
      );
    },
    [updateElements],
  );

  const addElement = useCallback(
    (type: NewElementType) => {
      const id = newElementId();
      updateElements((currentElements) => {
        const stagger = (currentElements.length % 4) * 2;
        const base = {
          id,
          x: 10,
          y: 40 + stagger,
          width: 50,
          height: 12,
          visible: true,
        };
        const element =
          type === "text"
            ? {
                ...base,
                type: "text" as const,
                binding: "custom" as const,
                customText: copy.idCards.designer.newText,
                fontSize: 8,
                fontWeight: "normal" as const,
                color: "#111827",
                align: "left" as const,
              }
            : type === "photo"
              ? {
                  ...base,
                  type: "photo" as const,
                  x: 6,
                  y: 18 + stagger,
                  width: 22,
                  height: 52,
                }
              : type === "qr"
                ? {
                    ...base,
                    type: "qr" as const,
                    x: 80,
                    y: 68 + stagger,
                    width: 14,
                    height: 24,
                  }
                : {
                    ...base,
                    type: "logo" as const,
                    x: 4,
                    y: 4 + stagger,
                    width: 16,
                    height: 12,
                    assetId: null,
                  };
        return [...currentElements, element];
      });
      setSelectedId(id);
    },
    [updateElements],
  );

  const removeElement = useCallback(
    (id: string) => {
      updateElements((elements) =>
        elements.filter((element) => element.id !== id),
      );
      setSelectedId((current) => (current === id ? null : current));
    },
    [updateElements],
  );

  const setName = useCallback(
    (name: string) => update((current) => ({ ...current, name })),
    [update],
  );

  /**
   * Orientation change RE-ANCHORS rather than resets: percent coordinates
   * stay meaningful across the axis swap (they are shares of the card), so
   * elements keep their relative positions and the operator rearranges from
   * there. Custom canvas dims swap WITH the orientation on BOTH sides — a
   * 90×60 landscape card becomes a 60×90 portrait one, front and back alike
   * (a card is one piece of stock). The settings panel states that
   * consequence next to the control.
   */
  const setOrientation = useCallback(
    (orientation: IdCardTemplateData["orientation"]) =>
      update((current) => {
        const swap = (canvas: IdCardTemplateData["canvas"]) => {
          const { widthMm, heightMm } = canvas;
          return widthMm && heightMm
            ? { ...canvas, widthMm: heightMm, heightMm: widthMm }
            : canvas;
        };
        return {
          ...current,
          orientation,
          canvas: swap(current.canvas),
          ...(current.back ? { back: { ...current.back, canvas: swap(current.back.canvas) } } : {}),
        };
      }),
    [update],
  );

  // Background writes route to the ACTIVE side's canvas — each side carries
  // its own background image.
  const setBackground = useCallback(
    (backgroundAssetId: string | null) =>
      update((current) => {
        if (sideRef.current === "back") {
          if (!current.back) return current;
          return {
            ...current,
            back: { ...current.back, canvas: { ...current.back.canvas, backgroundAssetId } },
          };
        }
        return { ...current, canvas: { ...current.canvas, backgroundAssetId } };
      }),
    [update],
  );

  /**
   * Hand-set card size (mm) — the settings panel's width/height inputs. The
   * card is ONE piece of stock, so both sides take the same dims.
   */
  const setCanvasSize = useCallback(
    (widthMm: number, heightMm: number) =>
      update((current) => {
        const dims = {
          widthMm: clamp(r2(widthMm), 20, 300),
          heightMm: clamp(r2(heightMm), 20, 300),
        };
        return {
          ...current,
          canvas: { ...current.canvas, ...dims },
          ...(current.back
            ? { back: { ...current.back, canvas: { ...current.back.canvas, ...dims } } }
            : {}),
        };
      }),
    [update],
  );

  /** The printed card's corner rounding (mm) — 0 is square stock. Shared by
   * both sides: the stock's corners do not differ front to back. */
  const setCornerRadius = useCallback(
    (cornerRadiusMm: number) =>
      update((current) => {
        const radius = { cornerRadiusMm: clamp(cornerRadiusMm, 0, 20) || undefined };
        return {
          ...current,
          canvas: { ...current.canvas, ...radius },
          ...(current.back
            ? { back: { ...current.back, canvas: { ...current.back.canvas, ...radius } } }
            : {}),
        };
      }),
    [update],
  );

  /**
   * FIT TO BACKGROUND: a new background image sets the card's physical size
   * from the image's aspect — the whole point of a pre-printed sheet is that
   * the card IS the image. The long side lands on CR80's 86mm (the standard
   * card stock), the short side follows the image; the operator refines with
   * the width/height inputs after. Percent geometry means the existing
   * elements keep their relative places through the resize.
   */
  const fitBackground = useCallback(
    (backgroundAssetId: string, imageWidthPx: number, imageHeightPx: number) =>
      update((current) => {
        const scaleMm = 86 / Math.max(imageWidthPx, imageHeightPx);
        return {
          ...current,
          orientation:
            imageWidthPx >= imageHeightPx ? "landscape" : "portrait",
          canvas: {
            ...current.canvas,
            backgroundAssetId,
            widthMm: clamp(r2(imageWidthPx * scaleMm), 20, 300),
            heightMm: clamp(r2(imageHeightPx * scaleMm), 20, 300),
          },
        };
      }),
    [update],
  );

  const discard = useCallback(() => {
    // A discard is a hard rewind: both history stacks die with it, and the
    // designer returns to the front side.
    historyRef.current = { stack: [], future: [], lastKind: null, lastAt: 0 };
    setHistoryDepth(0);
    setFutureDepth(0);
    setDraft(baseline ? structuredClone(baseline) : null);
    setSideState("front");
    setSelectedId(null);
  }, [baseline]);

  /** Adds an empty back side and switches to it (own undo step). */
  const addBackSide = useCallback(() => {
    update((current) =>
      current.back
        ? current
        : { ...current, back: { canvas: { backgroundAssetId: null }, elements: [] } },
    );
    setSideState("back");
    setSelectedId(null);
  }, [update]);

  /** Removes the back side (own undo step — undo restores it). */
  const removeBackSide = useCallback(() => {
    update((current) => (current.back ? { ...current, back: null } : current));
    setSideState("front");
    setSelectedId(null);
  }, [update]);

  const saveMutation = trpc.idCard.template.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.designer.saved);
      await utils.idCard.template.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** Returns whether the draft actually saved — callers navigate on true. */
  const save = useCallback(async (): Promise<boolean> => {
    const scope = writeScopeArgs();
    if (!scope || !draft || !row.data) {
      toast.error(copy.idCards.designer.saveNeedsBranch);
      return false;
    }
    const saved: DesignerDraft = structuredClone(draft);
    try {
      await saveMutation.mutateAsync({
        ...scope,
        id: row.data.id,
        data: {
          name: saved.name,
          orientation: saved.orientation,
          canvas: saved.canvas,
          elements: saved.elements,
          // The back side rides the save as the flat column pair; an
          // explicit null pair clears it (single-sided again).
          ...(saved.back
            ? { backCanvas: saved.back.canvas, backElements: saved.back.elements }
            : { backCanvas: null, backElements: null }),
        },
      });
      // The save IS the new baseline; the byId refetch updates the row read
      // but must not re-base the draft mid-session (the ?? in the effect).
      setBaseline(saved);
      setDraft(saved);
      return true;
    } catch {
      // The mutation hook toasts the worded refusal.
      return false;
    }
  }, [draft, row.data, saveMutation, utils, writeScopeArgs]);

  return {
    row,
    draft,
    baseline,
    saving: saveMutation.isPending,
    dirty,
    canUndo: historyDepth > 0,
    canRedo: futureDepth > 0,
    undo,
    redo,
    selectedId,
    selectElement: setSelectedId,
    setGeometry,
    nudge,
    replaceElement,
    addElement,
    removeElement,
    setName,
    setOrientation,
    setBackground,
    setCanvasSize,
    setCornerRadius,
    fitBackground,
    side,
    setSide,
    addBackSide,
    removeBackSide,
    discard,
    save,
  };
}

export type TemplateDesignerState = ReturnType<typeof useTemplateDesigner>;
