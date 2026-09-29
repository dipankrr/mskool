"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    if (!parsed) return;
    setBaseline((current) => current ?? structuredClone(parsed));
    setDraft((current) => current ?? structuredClone(parsed));
  }, [parsed]);

  const dirty =
    draft !== null &&
    baseline !== null &&
    JSON.stringify(draft) !== JSON.stringify(baseline);

  const update = useCallback(
    (mutate: (current: DesignerDraft) => DesignerDraft) => {
      setDraft((current) => (current ? mutate(current) : current));
    },
    [],
  );

  const setGeometry = useCallback(
    (id: string, patch: GeometryPatch) => {
      update((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === id
            ? { ...element, ...clampGeometry(element, patch) }
            : element,
        ),
      }));
    },
    [update],
  );

  /** Arrow-key nudging — the same clamp as a drag, one percent at a time. */
  const nudge = useCallback(
    (id: string, dx: number, dy: number) => {
      update((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === id
            ? {
                ...element,
                ...clampGeometry(element, { x: element.x + dx, y: element.y + dy }),
              }
            : element,
        ),
      }));
    },
    [update],
  );

  /**
   * Replaces one element wholesale. The element union is discriminated, so
   * property edits compute the next element with full typing rather than
   * merging an untyped patch.
   */
  const replaceElement = useCallback(
    (next: IdCardTemplateData["elements"][number]) => {
      update((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === next.id ? next : element,
        ),
      }));
    },
    [update],
  );

  const addElement = useCallback(
    (type: NewElementType) => {
      const id = newElementId();
      update((current) => {
        const stagger = (current.elements.length % 4) * 2;
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
        return { ...current, elements: [...current.elements, element] };
      });
      setSelectedId(id);
    },
    [update],
  );

  const removeElement = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        elements: current.elements.filter((element) => element.id !== id),
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [update],
  );

  const setName = useCallback(
    (name: string) => update((current) => ({ ...current, name })),
    [update],
  );

  /**
   * Orientation change RE-ANCHORS rather than resets: percent coordinates
   * stay meaningful across the axis swap (they are shares of the card), so
   * elements keep their relative positions and the operator rearranges from
   * there. The settings panel states that consequence next to the control.
   */
  const setOrientation = useCallback(
    (orientation: IdCardTemplateData["orientation"]) =>
      update((current) => ({ ...current, orientation })),
    [update],
  );

  const setBackground = useCallback(
    (backgroundAssetId: string | null) =>
      update((current) => ({ ...current, canvas: { backgroundAssetId } })),
    [update],
  );

  const discard = useCallback(() => {
    setDraft(baseline ? structuredClone(baseline) : null);
    setSelectedId(null);
  }, [baseline]);

  const saveMutation = trpc.idCard.template.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.designer.saved);
      await utils.idCard.template.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const save = useCallback(async () => {
    const scope = writeScopeArgs();
    if (!scope || !draft || !row.data) {
      toast.error(copy.idCards.designer.saveNeedsBranch);
      return;
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
        },
      });
      // The save IS the new baseline; the byId refetch updates the row read
      // but must not re-base the draft mid-session (the ?? in the effect).
      setBaseline(saved);
      setDraft(saved);
    } catch {
      // The mutation hook toasts the worded refusal.
    }
  }, [draft, row.data, saveMutation, utils, writeScopeArgs]);

  return {
    row,
    draft,
    baseline,
    saving: saveMutation.isPending,
    dirty,
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
    discard,
    save,
  };
}

export type TemplateDesignerState = ReturnType<typeof useTemplateDesigner>;
