"use client";

import { publicSiteContentSchema, type PublicSiteContent } from "@repo/contracts";
import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * The site editor's data layer (ADR-041). Everything the page does rides the
 * draft: read it, save it whole, publish it. The server re-validates the
 * content against the same contract this file exports, so the editor cannot
 * write something the public renderer would reject.
 */

export function useSite() {
  const { scopeArgs } = useActiveContext();
  // publicSite.* is org-level: only the org node is addressed, so a
  // school-scoped principal correctly cannot open this screen.
  const args = { organizationId: scopeArgs().organizationId };

  return trpc.publicSite.draft.useQuery(args, {
    retry: false,
    staleTime: 30 * 1000,
  });
}

export function useSiteMutations() {
  const { scopeArgs } = useActiveContext();
  const args = { organizationId: scopeArgs().organizationId };
  const utils = trpc.useUtils();

  const invalidate = () => {
    void utils.publicSite.draft.invalidate();
  };

  const saveDraft = trpc.publicSite.saveDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft saved.");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const publish = trpc.publicSite.publish.useMutation({
    onSuccess: () => {
      toast.success("Published — the live site is updated.");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const save = (content: PublicSiteContent) =>
    saveDraft.mutateAsync({ ...args, content });

  const publishDraft = async (content: PublicSiteContent) => {
    await save(content);
    await publish.mutateAsync(args);
  };

  /** Client-side gate before anything is sent: same schema as the server. */
  const validate = (content: PublicSiteContent) =>
    publicSiteContentSchema.safeParse(content);

  return {
    save,
    publishDraft,
    validate,
    isSaving: saveDraft.isPending || publish.isPending,
  };
}
