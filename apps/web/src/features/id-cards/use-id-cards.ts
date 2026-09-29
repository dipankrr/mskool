"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { IdCardTemplateDataInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type { IdCardTemplateRow } from "@/lib/trpc/types";
import { parseTemplateData } from "./template";

/**
 * ID-CARD PRINT PASS state (slice 2a) — template resolution + the adopt
 * mutation. The roster and the card payload live on the page itself: the
 * roster is the enrollment list it already shares with the register, and
 * `idCard.cardData` is fetched for the selection exactly as picked.
 *
 * A chosen template is ONE of:
 *   - an adopted row (parsed through the contract — a row the current
 *     contract refuses is skipped, never rendered broken);
 *   - a starter constant (typed, unvalidated by definition).
 * The renderer cannot tell the two apart, which is the point: 2b's designer
 * edits adopted rows and this surface keeps rendering.
 */

export type TemplateChoice = {
  /** Picker key — an adopted row id, or the starter's public id. */
  key: string;
  name: string;
  data: IdCardTemplateDataInput;
  /** Set for ADOPTED rows — the row set-default addresses. */
  rowId?: string;
  /** Set for STARTER designs — the adopt mutation's provenance id. */
  prebuiltId?: string;
};

export function useIdCardTemplates() {
  const { organizationId } = useActiveContext();

  return trpc.idCard.template.list.useQuery(
    { organizationId },
    {
      enabled: Boolean(organizationId),
      staleTime: 30_000,
    },
  );
}

/**
 * The template picker's model: the school's adopted rows (parseable ones)
 * plus the starter gallery, flattened into one selectable list.
 */
export function useTemplateChoices(templates: IdCardTemplateRow[] | undefined) {
  return useMemo(() => {
    const adopted: TemplateChoice[] = [];
    for (const row of templates ?? []) {
      const data = parseTemplateData(row);
      if (data) {
        adopted.push({
          key: row.id,
          rowId: row.id,
          name: row.name,
          data,
        });
      }
    }
    return adopted;
  }, [templates]);
}

export function useAdoptTemplate() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mutation = trpc.idCard.template.adopt.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.adopted);
      await utils.idCard.template.list.invalidate();
    },
    // A duplicate name arrives already worded (the unique index, ADR-026).
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    ...mutation,
    submit: (prebuiltId: string, name: string, data: IdCardTemplateDataInput) => {
      const scope = writeScopeArgs();
      if (!scope) throw new Error("A branch must be chosen to adopt a design.");
      return mutation.mutateAsync({ ...scope, prebuiltId, data: { ...data, name, isDefault: false } });
    },
  };
}

export function useSetDefaultTemplate() {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mutation = trpc.idCard.template.setDefault.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.madeDefault);
      await utils.idCard.template.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    ...mutation,
    submit: (id: string) => mutation.mutateAsync({ ...scopeArgs(), id }),
  };
}

/** The selected student-id set with toggles — plain state, no server round-trip. */
export function useStudentSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  return {
    selected,
    toggle: (studentId: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(studentId)) {
          next.delete(studentId);
        } else {
          next.add(studentId);
        }
        return next;
      }),
    selectMany: (studentIds: string[]) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of studentIds) next.add(id);
        return next;
      }),
    clear: () => setSelected(new Set()),
  };
}
