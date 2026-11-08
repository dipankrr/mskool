"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { IdCardTemplateDataInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type { IdCardTemplateRow } from "@/lib/trpc/types";
import { prepareImage, putToUploadLink } from "@/lib/image-upload";

import { rememberImages } from "./asset-images";
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

  const query = trpc.idCard.template.list.useQuery(
    { organizationId },
    {
      enabled: Boolean(organizationId),
      staleTime: 30_000,
    },
  );
  // Each template carries its backgrounds' and logos' links (ADR-063).
  useEffect(() => {
    for (const row of query.data ?? []) rememberImages(row.images);
  }, [query.data]);
  return query;
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

/** Soft-close a template (hard rule 2): status inactive, never a delete. */
export function useCloseTemplate() {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mutation = trpc.idCard.template.close.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.closedTemplate);
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

// ── Slice 2b — designer, publish, gallery ──────────────────────────────────

/**
 * A background or logo's image as sent: no more than 2000px on its long side
 * (a CR80 card at well over 300dpi), PNG kept lossless so line art and logos
 * stay sharp. The server re-encodes it either way (ADR-063).
 */
function prepareTemplateAsset(file: File) {
  return prepareImage(file, 2000, file.type === "image/png" ? "png" : "jpeg");
}

/**
 * THE TEMPLATE'S OWN ASSET UPLOAD (background, logo), straight to the bucket
 * (ADR-063): an upload link, the PUT, then `storage.complete` so the
 * designer can show it at once. Answers the asset id; the caller re-points
 * the design ref with an ordinary draft edit, and saving the template links
 * the file. A branch must be chosen (the gate is `id_card:manage` at school
 * level).
 */
export function useUploadTemplateAsset() {
  const { writeScopeArgs } = useActiveContext();
  const link = trpc.idCard.template.assetUpload.useMutation();
  const complete = trpc.storage.complete.useMutation();

  return {
    submit: async (file: File): Promise<string | null> => {
      const scope = writeScopeArgs();
      if (!scope) throw new Error("A branch must be chosen first.");
      const image = await prepareTemplateAsset(file);
      if (!image) {
        toast.error(copy.idCards.photo.unreadable);
        return null;
      }
      try {
        const ticket = await link.mutateAsync({
          ...scope,
          file: { contentType: image.contentType, sizeBytes: image.sizeBytes },
        });
        await putToUploadLink(ticket, image);
        const [result] = await complete.mutateAsync({ objectIds: [ticket.objectId] });
        if (!result?.ok) {
          toast.error(result?.reason ?? copy.idCards.photo.unreadable);
          return null;
        }
        rememberImages([result.image]);
        return ticket.objectId;
      } catch (error) {
        toast.error(errorMessage(error));
        return null;
      }
    },
  };
}

/** The Publish/Unpublish switch — one `template.update` carrying the intent. */
export function usePublishTemplate() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mutation = trpc.idCard.template.update.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.data.isPublished
          ? copy.idCards.gallery.published
          : copy.idCards.gallery.unpublished,
      );
      await utils.idCard.template.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    ...mutation,
    submit: (id: string, isPublished: boolean) => {
      const scope = writeScopeArgs();
      if (!scope) throw new Error("A branch must be chosen first.");
      return mutation.mutateAsync({ ...scope, id, data: { isPublished } });
    },
  };
}

/** Build-from-blank: creates the row from a minimal skeleton, opens it. */
export function useCreateTemplate() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mutation = trpc.idCard.template.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.newTemplate.created);
      await utils.idCard.template.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    ...mutation,
    submit: (name: string, orientation: "landscape" | "portrait") => {
      const scope = writeScopeArgs();
      if (!scope) throw new Error("A branch must be chosen first.");
      return mutation.mutateAsync({
        ...scope,
        data: {
          name,
          orientation,
          canvas: { backgroundAssetId: null },
          elements: skeletonElements(orientation),
          isDefault: false,
        },
      });
    },
  };
}

/** The new template's starting point — a minimal photo + QR + name skeleton. */
function skeletonElements(orientation: "landscape" | "portrait") {
  return orientation === "landscape"
    ? [
        {
          id: "el-school",
          type: "text" as const,
          x: 0,
          y: 0,
          width: 100,
          height: 16,
          visible: true,
          binding: "schoolName" as const,
          fontSize: 10,
          fontWeight: "bold" as const,
          color: "#111827",
          align: "center" as const,
        },
        { id: "el-photo", type: "photo" as const, x: 5, y: 24, width: 22, height: 58, visible: true },
        {
          id: "el-name",
          type: "text" as const,
          x: 32,
          y: 30,
          width: 60,
          height: 14,
          visible: true,
          binding: "studentName" as const,
          fontSize: 10,
          fontWeight: "bold" as const,
          color: "#111827",
          align: "left" as const,
        },
        { id: "el-qr", type: "qr" as const, x: 82, y: 72, width: 12, height: 22, visible: true },
      ]
    : [
        {
          id: "el-school",
          type: "text" as const,
          x: 0,
          y: 3,
          width: 100,
          height: 10,
          visible: true,
          binding: "schoolName" as const,
          fontSize: 9,
          fontWeight: "bold" as const,
          color: "#111827",
          align: "center" as const,
        },
        { id: "el-photo", type: "photo" as const, x: 27, y: 16, width: 46, height: 32, visible: true },
        {
          id: "el-name",
          type: "text" as const,
          x: 6,
          y: 52,
          width: 88,
          height: 10,
          visible: true,
          binding: "studentName" as const,
          fontSize: 9,
          fontWeight: "bold" as const,
          color: "#111827",
          align: "center" as const,
        },
        { id: "el-qr", type: "qr" as const, x: 62, y: 84, width: 30, height: 13, visible: true },
      ];
}

/**
 * THE COMMUNITY GALLERY (2b) — every org's published designs. This is the
 * one deliberate platform-level read (see the router's warning comment):
 * the payload is tenant-agnostic design data, gated `id_card:manage`.
 */
export function useGalleryTemplates() {
  const { organizationId, has } = useActiveContext();

  return trpc.idCard.gallery.list.useQuery(
    { organizationId },
    {
      enabled: Boolean(organizationId) && has("id_card:manage"),
      staleTime: 30_000,
    },
  );
}

/** Clones a published design into the caller's school as a new owned row. */
export function useCloneGalleryTemplate() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mutation = trpc.idCard.gallery.clone.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.gallery.cloned);
      await utils.idCard.template.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    ...mutation,
    submit: (templateId: string, name?: string) => {
      const scope = writeScopeArgs();
      if (!scope) throw new Error("A branch must be chosen first.");
      return mutation.mutateAsync({
        ...scope,
        templateId,
        ...(name ? { name } : {}),
      });
    },
  };
}
