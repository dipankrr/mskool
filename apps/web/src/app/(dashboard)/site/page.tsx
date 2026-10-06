"use client";

import { GlobeIcon, PlusIcon, RocketIcon, SaveIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FieldsEditor } from "@/features/site/fields-editor";
import { useSite, useSiteMutations } from "@/features/site/use-site";
import type { PublicSiteContent, SectionKey } from "@repo/contracts";

/**
 * THE SITE EDITOR (ADR-041 Tier A). One screen over the org's draft:
 * chrome, nav, the ordered section list (reorder / remove / add), the
 * footer — each rendered by the generic fields editor — plus Save Draft and
 * Publish. Publish is the act the public site serves; saving alone never
 * changes what visitors see.
 *
 * Card/image management beyond URL strings and the drag-drop reorder are
 * Tier B — the fields editor keeps them reachable without new editor code.
 */

/** Blank content per section key, used by "+ Add section". */
const SECTION_SKELETONS: Record<SectionKey, unknown> = {
  hero: { title: "New hero", subtitle: "", images: [], ctas: [] },
  stats: { items: [{ value: "100%", label: "New stat" }] },
  about: { title: "New section", body: "", images: [], ctas: [] },
  cardGrid: { title: "New section", subtitle: "", cards: [{ title: "New card" }] },
  gallery: { title: "Gallery", images: [] },
  faculty: { title: "Faculty", members: [{ name: "Name", designation: "Designation" }] },
  faq: { title: "FAQ", items: [{ question: "Question?", answer: "Answer." }] },
  contact: {
    title: "Contact",
    address: "",
    email: "office@example.com",
    phones: ["+91 90000 00000"],
    hours: "",
  },
  ctaBanner: { title: "Admissions open", subtitle: "", ctas: [] },
};

const SECTION_LABELS: Record<SectionKey, string> = {
  hero: "Hero",
  stats: "Stats bar",
  about: "About split",
  cardGrid: "Card grid",
  gallery: "Gallery",
  faculty: "Faculty",
  faq: "FAQ",
  contact: "Contact",
  ctaBanner: "CTA banner",
};

function SectionCard({
  index,
  total,
  sectionKey,
  id,
  content,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  sectionKey: SectionKey;
  id?: string;
  content: unknown;
  onChange: (next: unknown) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{SECTION_LABELS[sectionKey]}</Badge>
            {id ? <code className="text-xs text-muted-foreground">#{id}</code> : null}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              aria-label="Move down"
            >
              ↓
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove section">
              Remove
            </Button>
          </div>
        </div>
        <Separator className="my-4" />
        <FieldsEditor value={content} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

function SiteEditor() {
  const { data: site, isLoading, error } = useSite();
  const { save, publishDraft, validate, isSaving } = useSiteMutations();

  const [draft, setDraft] = useState<PublicSiteContent | null>(null);
  const [addKey, setAddKey] = useState<SectionKey>("cardGrid");

  // Adopt the server draft into local state once; edits are local until saved.
  // (Cast: the wire type's `content` is inferred optional through the zod
  // input side; the contract guarantees it present on any stored draft.)
  const content: PublicSiteContent | null =
    draft ?? ((site?.draftContent ?? null) as PublicSiteContent | null);
  const dirty = useMemo(
    () => Boolean(draft && site?.draftContent && JSON.stringify(draft) !== JSON.stringify(site.draftContent)),
    [draft, site],
  );

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading the site draft…</p>;
  if (error) {
    return (
      <p className="p-6 text-muted-foreground">
        No site is provisioned for this organization yet. It appears here once the site
        engine seeds one ({`pnpm db:seed:site`} for now).
      </p>
    );
  }
  if (!content) {
    return <p className="p-6 text-muted-foreground">The draft is empty — seed a site first.</p>;
  }

  const mutateContent = (fn: (c: PublicSiteContent) => PublicSiteContent) =>
    setDraft((current) => fn(structuredClone(current ?? content)));

  const doSave = async (thenPublish: boolean) => {
    if (!draft) return;
    const check = validate(draft);
    if (!check.success) {
      const issue = check.error.issues[0]!;
      toast.error(`Content is invalid at "${issue.path.join(".")}" — ${issue.message}`);
      return;
    }
    try {
      if (thenPublish) {
        await publishDraft(draft);
      } else {
        await save(draft);
      }
      setDraft(null);
    } catch {
      // toasts handled in the mutations
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <PageHeader
        title="Website"
        description="Edit your public site's draft, then publish it to the live page."
        actions={
          <>
            {dirty ? <Badge>Pending changes</Badge> : null}
            {site?.publishedAt ? (
              <Badge variant="secondary">
                Live since {new Date(site.publishedAt).toLocaleDateString()}
              </Badge>
            ) : (
              <Badge variant="secondary">Never published</Badge>
            )}
            <Button variant="outline" disabled={isSaving || !dirty} onClick={() => void doSave(false)}>
              <SaveIcon className="size-4" /> Save draft
            </Button>
            <Button disabled={isSaving || !draft} onClick={() => void doSave(true)}>
              <RocketIcon className="size-4" /> Publish
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-semibold">Header &amp; footer chrome</h2>
          <p className="text-sm text-muted-foreground">
            The org name, contact strip, navigation links, and footer.
          </p>
          <Separator className="my-4" />
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold">Header</h3>
              <FieldsEditor
                value={content.chrome}
                onChange={(next) => mutateContent((c) => ({ ...c, chrome: next as PublicSiteContent["chrome"] }))}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Navigation links</h3>
              <FieldsEditor
                value={content.nav}
                onChange={(next) => mutateContent((c) => ({ ...c, nav: next as PublicSiteContent["nav"] }))}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Footer</h3>
              <FieldsEditor
                value={content.footer}
                onChange={(next) => mutateContent((c) => ({ ...c, footer: next as PublicSiteContent["footer"] }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <h2 className="font-semibold">Sections</h2>
        {content.sections.map((section, i) => (
          <SectionCard
            key={`${section.key}-${section.id ?? i}`}
            index={i}
            total={content.sections.length}
            sectionKey={section.key}
            id={section.id}
            content={section.content}
            onChange={(next) =>
              mutateContent((c) => {
                c.sections[i] = { ...c.sections[i]!, content: next };
                return c;
              })
            }
            onRemove={() =>
              mutateContent((c) => {
                c.sections.splice(i, 1);
                return c;
              })
            }
            onMove={(dir) =>
              mutateContent((c) => {
                const j = i + dir;
                [c.sections[i], c.sections[j]] = [c.sections[j]!, c.sections[i]!];
                return c;
              })
            }
          />
        ))}
      </div>

      <Card>
        <CardContent className="flex items-center gap-3 pt-6">
          <Select value={addKey} onValueChange={(v) => setAddKey(v as SectionKey)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SECTION_SKELETONS) as SectionKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SECTION_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            onClick={() =>
              mutateContent((c) => {
                c.sections.push({ key: addKey, content: structuredClone(SECTION_SKELETONS[addKey]) });
                return c;
              })
            }
          >
            <PlusIcon className="size-4" /> Add section
          </Button>
          <p className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
            <GlobeIcon className="size-4" /> The live site updates only on publish.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SitePage() {
  return (
    <PermissionGate permission="public_site:read">
      <SiteEditor />
    </PermissionGate>
  );
}
