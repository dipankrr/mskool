"use client";

import { GlobeIcon, LayersIcon, MonitorIcon, PlusIcon, RocketIcon, SaveIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { FieldsEditor } from "@/features/site/fields-editor";
import { useSite, useSiteMutations } from "@/features/site/use-site";
import type { PublicSiteContent, SectionKey } from "@repo/contracts";

/**
 * THE SITE EDITOR (ADR-041 Tier A). Two panes: an OUTLINE of everything the
 * site is made of (chrome, nav, footer, the ordered sections) on the left;
 * the selected node's fields on the right. Save Draft writes the whole
 * draft; Publish is the only act that changes the live site. Drag-drop and
 * an image picker are Tier B — reorder buttons and URL fields with previews
 * carry those jobs until then.
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

type Selection = { kind: "chrome" } | { kind: "nav" } | { kind: "footer" } | { kind: "section"; index: number };

function OutlineRow({
  label,
  hint,
  active,
  onClick,
  trailing,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    // A row container, not a <button>: section rows carry real buttons
    // (reorder) and HTML forbids nesting interactive elements.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={cn(
        "group flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-muted",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="ml-2 flex shrink-0 items-center gap-1">
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        {trailing}
      </span>
    </div>
  );
}

function SiteEditor() {
  const { data: site, isLoading, error } = useSite();
  const { save, publishDraft, validate, isSaving } = useSiteMutations();

  const [draft, setDraft] = useState<PublicSiteContent | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "chrome" });
  const [addKey, setAddKey] = useState<SectionKey>("cardGrid");
  const [previewWide, setPreviewWide] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Adopt the server draft into local state once; edits are local until saved.
  // (Cast: the wire type's `content` is inferred optional through the zod
  // input side; the contract guarantees it present on any stored draft.)
  const content: PublicSiteContent | null =
    draft ?? ((site?.draftContent ?? null) as PublicSiteContent | null);
  const dirty = useMemo(
    () => Boolean(draft && site?.draftContent && JSON.stringify(draft) !== JSON.stringify(site.draftContent)),
    [draft, site],
  );

  // ── The live preview handshake (the on-screen editor) ─────────────────────
  // The iframe renders the REAL site renderer fed the draft: post it on every
  // edit (debounced — the payload includes the whole content tree), receive
  // clicks back as section selections. Same-origin only, both directions.
  const postDraft = useCallback(() => {
    // Posts the EFFECTIVE content (the server draft until the first local
    // edit), so the preview renders immediately — not only after an edit.
    if (content && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "mskool:draft", content },
        window.location.origin,
      );
    }
  }, [content]);

  useEffect(() => {
    if (!content) return;
    const t = setTimeout(postDraft, 350);
    return () => clearTimeout(t);
  }, [content, postDraft]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "mskool:preview-ready") {
        postDraft();
        return;
      }
      if (e.data?.type === "mskool:select" && Number.isFinite(e.data.index)) {
        setSelection({ kind: "section", index: e.data.index });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postDraft]);

  // Edits live in local state until saved — warn before losing them.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Scaled viewport: the preview iframe runs at a REAL desktop (1280px) or
  // mobile (390px) viewport and is scaled down to fit the pane. Media queries
  // respond to the true width, so the desktop toggle shows the desktop
  // layout — the previous version let the pane's ~400px width decide, which
  // made "desktop" render mobile.
  const VIEWPORT_W = previewWide ? 1280 : 390;
  const VIEWPORT_H = 900;
  const paneRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / VIEWPORT_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [VIEWPORT_W]);

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

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading the site draft…</p>;
  if (error) {
    return (
      <p className="p-6 text-muted-foreground">
        You don't have access to a site editor for this organization, or none has been
        provisioned yet.
      </p>
    );
  }
  if (!content) {
    return <p className="p-6 text-muted-foreground">The draft is empty — seed a site first.</p>;
  }

  const mutateContent = (fn: (c: PublicSiteContent) => PublicSiteContent) =>
    setDraft((current) => fn(structuredClone(current ?? content)));

  const sections = content.sections;
  const selectedSection = selection.kind === "section" ? sections[selection.index] : undefined;

  const editorForSelection = () => {
    switch (selection.kind) {
      case "chrome":
        return (
          <FieldsEditor
            value={content.chrome}
            onChange={(next) => mutateContent((c) => ({ ...c, chrome: next as PublicSiteContent["chrome"] }))}
          />
        );
      case "nav":
        return (
          <FieldsEditor
            value={content.nav}
            onChange={(next) => mutateContent((c) => ({ ...c, nav: next as PublicSiteContent["nav"] }))}
          />
        );
      case "footer":
        return (
          <FieldsEditor
            value={content.footer}
            onChange={(next) => mutateContent((c) => ({ ...c, footer: next as PublicSiteContent["footer"] }))}
          />
        );
      case "section":
        return selectedSection ? (
          <FieldsEditor
            key={`${selectedSection.key}-${selection.index}`}
            value={selectedSection.content}
            onChange={(next) =>
              mutateContent((c) => {
                c.sections[selection.index] = { ...c.sections[selection.index]!, content: next };
                return c;
              })
            }
          />
        ) : null;
    }
  };

  const titleForSelection = () => {
    switch (selection.kind) {
      case "chrome":
        return "Header";
      case "nav":
        return "Navigation links";
      case "footer":
        return "Footer";
      case "section": {
        const s = sections[selection.index]!;
        return SECTION_LABELS[s.key] + (s.id ? ` · #${s.id}` : "");
      }
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Website"
        description="Edit your public site's draft, then publish it to the live page."
        actions={
          <>
            {dirty ? <Badge>Pending changes</Badge> : null}
            {site?.publishedAt ? (
              <Badge variant="secondary">Live since {new Date(site.publishedAt).toLocaleDateString()}</Badge>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,0.85fr)_minmax(0,1.15fr)]">
        {/* ── Outline ─────────────────────────────────────────────────────── */}
        <Card className="h-fit lg:sticky lg:top-6">
          <CardContent className="p-3">
            <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Site outline
            </p>
            <OutlineRow
              label="Header"
              hint="chrome"
              active={selection.kind === "chrome"}
              onClick={() => setSelection({ kind: "chrome" })}
            />
            <OutlineRow
              label="Navigation"
              hint={`${content.nav.length} links`}
              active={selection.kind === "nav"}
              onClick={() => setSelection({ kind: "nav" })}
            />
            <OutlineRow
              label="Footer"
              active={selection.kind === "footer"}
              onClick={() => setSelection({ kind: "footer" })}
            />

            <Separator className="my-3" />
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sections · top to bottom
            </p>

            {sections.map((section, i) => {
              // The outline speaks the section's own title when it has one;
              // the type label becomes the hint. "3. Card grid" seven times
              // told an editor nothing.
              const title =
                section.key === "hero" || section.key === "ctaBanner" || section.key === "about" ||
                section.key === "cardGrid" || section.key === "gallery" || section.key === "faculty" || section.key === "faq" || section.key === "contact"
                  ? typeof (section.content as { title?: unknown })?.title === "string"
                    ? ((section.content as { title: string }).title as string)
                    : SECTION_LABELS[section.key]
                  : SECTION_LABELS[section.key];
              const hint =
                section.key === "stats"
                  ? "stats"
                  : SECTION_LABELS[section.key] === title
                    ? section.id
                      ? `#${section.id}`
                      : undefined
                    : section.id
                      ? `${SECTION_LABELS[section.key]} · #${section.id}`
                      : SECTION_LABELS[section.key];
              return (
              <OutlineRow
                key={`${section.key}-${section.id ?? i}`}
                label={`${i + 1}. ${title}`}
                hint={hint}
                active={selection.kind === "section" && selection.index === i}
                onClick={() => setSelection({ kind: "section", index: i })}
                trailing={
                  <span
                    className="hidden items-center gap-0.5 group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() =>
                        mutateContent((c) => {
                          [c.sections[i], c.sections[i - 1]] = [c.sections[i - 1]!, c.sections[i]!];
                          return c;
                        })
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Move down"
                      disabled={i === sections.length - 1}
                      onClick={() =>
                        mutateContent((c) => {
                          [c.sections[i], c.sections[i + 1]] = [c.sections[i + 1]!, c.sections[i]!];
                          return c;
                        })
                      }
                    >
                      ↓
                    </Button>
                  </span>
                }
              />
              );
            })}

            <Separator className="my-3" />
            <div className="flex items-center gap-2 px-1">
              <Select value={addKey} onValueChange={(v) => setAddKey(v as SectionKey)}>
                <SelectTrigger className="h-9 flex-1" aria-label="Section type to add">
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
                size="icon"
                aria-label="Add section"
                onClick={() => {
                  mutateContent((c) => {
                    c.sections.push({ key: addKey, content: structuredClone(SECTION_SKELETONS[addKey]) });
                    return c;
                  });
                  setSelection({ kind: "section", index: sections.length });
                }}
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Editor pane ─────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <LayersIcon className="size-4 text-muted-foreground" />
              <h2 className="font-semibold">{titleForSelection()}</h2>
              {selection.kind === "section" ? (
                <Badge variant="outline" className="ml-auto font-mono text-xs">
                  {sections[selection.index]?.key}
                </Badge>
              ) : null}
            </div>
            <Separator className="my-4" />
            {selection.kind === "section" && selectedSection?.key === "gallery" ? (
              <p className="mb-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <GlobeIcon className="size-4 shrink-0" />
                Every image is a URL in the object store — swap, reorder, or remove
                entries freely. A bulk upload picker is coming.
              </p>
            ) : null}
            {editorForSelection()}
          </CardContent>
        </Card>

        {/* ── Live preview: the real renderer, fed the draft ──────────────── */}
        <Card className="h-fit xl:sticky xl:top-6">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Live preview · click a section to edit it
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant={previewWide ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  aria-label="Desktop width"
                  onClick={() => setPreviewWide(true)}
                >
                  <MonitorIcon className="size-4" />
                </Button>
                <Button
                  variant={!previewWide ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  aria-label="Mobile width"
                  onClick={() => setPreviewWide(false)}
                >
                  <SmartphoneIcon className="size-4" />
                </Button>
              </div>
            </div>
            {/* The observed wrapper is FULL-WIDTH and independent of scale —
                observing the scaled box itself would feed its own output back
                into the ResizeObserver and shrink to nothing. */}
            <div ref={paneRef} className="w-full">
              <div
                className="mx-auto overflow-hidden rounded-xl border bg-white shadow-sm"
                style={{
                  width: Math.round(VIEWPORT_W * scale),
                  height: Math.round(VIEWPORT_H * scale),
                }}
              >
              {/* The iframe runs at a REAL desktop/mobile viewport and is
                  scaled to fit the pane — media queries respond to the true
                  width, so "desktop" shows the desktop layout, not a squeezed
                  mobile one (the scaled-canvas trick every builder uses). */}
              <iframe
                ref={iframeRef}
                src="/sites/preview"
                title="Live preview of your site"
                onLoad={postDraft}
                className="border-0 bg-white"
                style={{
                  width: VIEWPORT_W,
                  height: VIEWPORT_H,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
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
