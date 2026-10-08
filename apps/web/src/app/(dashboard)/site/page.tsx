"use client";

import { CopyIcon, EyeOffIcon, GlobeIcon, LayersIcon, MonitorIcon, PaletteIcon, PlusIcon, RocketIcon, SaveIcon, SmartphoneIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useActiveContext } from "@/features/session/active-context";
import { FieldsEditor } from "@/features/site/fields-editor";
import type { CanvasTarget } from "@/features/site/preview";
import { buildStarterContent } from "@/features/site/starter";
import { useSite, useSiteMutations } from "@/features/site/use-site";
import type { PublicSiteContent, SectionKey } from "@repo/contracts";

/**
 * THE SITE EDITOR (ADR-041 Tier A + on-screen editing). Two panes: an OUTLINE
 * of everything the site is made of (chrome, nav, footer, design tokens, the
 * ordered sections) on the left; the selected node's fields on the right; the
 * live preview (the real renderer in an iframe) alongside. Save Draft writes
 * the whole draft; Publish is the only act that changes the live site.
 * Unpublish takes it offline without touching the draft.
 */

/** Blank content per section key, used by "+ Add section". Every skeleton is
 * valid against its section schema, so adding never breaks the next save —
 * the gallery carries a clearly-labeled local placeholder photo. */
const SECTION_SKELETONS: Record<SectionKey, unknown> = {
  hero: { title: "New hero", subtitle: "", images: [], ctas: [] },
  stats: { items: [{ value: "100%", label: "New stat" }] },
  about: { title: "New section", body: "", images: [], ctas: [] },
  cardGrid: { title: "New section", subtitle: "", cards: [{ title: "New card" }] },
  gallery: {
    title: "Gallery",
    images: [{ url: "/sites/ujjwal/hero-1.webp", alt: "Placeholder — replace with a school photo" }],
  },
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

type Selection =
  | { kind: "chrome" }
  | { kind: "nav" }
  | { kind: "footer" }
  | { kind: "theme" }
  | { kind: "section"; index: number };

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

/**
 * The empty state: no provisioned row, or a row with no usable draft. Offers
 * the starter generator — provision + a factual-minimal skeleton named for
 * the org — instead of the old dead-end "seed a site first" text.
 */
function StarterEmpty({ orgName }: { orgName: string }) {
  const [name, setName] = useState(orgName);
  const { ensureSite, save, validate, isSaving } = useSiteMutations();

  const create = async () => {
    const content = buildStarterContent(name);
    const check = validate(content);
    if (!check.success) {
      const issue = check.error.issues[0]!;
      toast.error(`Starter content is invalid at "${issue.path.join(".")}" — ${issue.message}`);
      return;
    }
    try {
      // ensure is idempotent: creates the row when missing, no-ops when the
      // row exists with an empty draft. The save then writes the starter.
      await ensureSite();
      await save(content, { silent: true });
      toast.success("Starter site created — edit it, then publish.");
    } catch {
      // toasts handled in the mutations
    }
  };

  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <GlobeIcon className="size-4 text-muted-foreground" />
          <h2 className="font-semibold">Create your school website</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          No site exists for this organization yet. Start from a short skeleton
          named for your school — no invented claims, just sections to fill in.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="starter-org-name" className="text-[13px] font-medium">
            School name on the site
          </label>
          <Input
            id="starter-org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Our School"
          />
        </div>
        <Button disabled={isSaving} onClick={() => void create()}>
          <PlusIcon className="size-4" /> Create starter site
        </Button>
      </CardContent>
    </Card>
  );
}

function SiteEditor() {
  const { data: site, isLoading, error, refetch } = useSite();
  const { save, publishDraft, publishNow, unpublishNow, validate, isSaving } = useSiteMutations();
  const { scopeArgs, memberships } = useActiveContext();
  const orgName =
    memberships.find((m) => m.organization.id === scopeArgs().organizationId)?.organization.name ??
    "Our School";

  const [draft, setDraft] = useState<PublicSiteContent | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "chrome" });
  const [addKey, setAddKey] = useState<SectionKey>("cardGrid");
  const [previewWide, setPreviewWide] = useState(true);
  // The exact field clicked on the canvas (e.g. "cards.2.description") — the
  // fields editor rings and scrolls to it. The nonce re-fires the ring when
  // the same field is clicked twice; the path clears after a beat so the ring
  // is a pointer, not a permanent state.
  const [focusPath, setFocusPath] = useState<string | undefined>(undefined);
  const [focusTick, setFocusTick] = useState(0);
  const focus = focusPath ? { path: focusPath, n: focusTick } : undefined;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Content mirror for the postMessage handler (its closure would otherwise
  // go stale between renders). Assigned below, after `content` exists.
  const contentRef = useRef<PublicSiteContent | null>(null);
  // Set when a canvas keystroke updates the draft: the next post effect skips
  // one round so the iframe is never re-rendered mid-keystroke.
  const canvasEditRef = useRef(false);
  // The preview reports its rendered height; the scaled frame fits the whole
  // page instead of clipping long sites at a fixed viewport height.
  const [previewHeight, setPreviewHeight] = useState(900);

  // Adopt the server draft into local state once; edits are local until saved.
  // (Cast: the wire type's `content` is inferred optional through the zod
  // input side; the contract guarantees it present on any stored draft.)
  const content: PublicSiteContent | null =
    draft ?? ((site?.draftContent ?? null) as PublicSiteContent | null);
  contentRef.current = content;
  const dirty = useMemo(
    () => Boolean(draft && site?.draftContent && JSON.stringify(draft) !== JSON.stringify(site.draftContent)),
    [draft, site],
  );
  // Publish is about the LIVE site, not the local buffer: enabled whenever
  // what the visitor would see differs from the snapshot — including right
  // after a save, when `dirty` has already reset.
  const liveOutdated = useMemo(() => {
    if (!content) return false;
    if (!site?.publishedContent) return true;
    return JSON.stringify(content) !== JSON.stringify(site.publishedContent);
  }, [content, site]);
  const live = Boolean(site?.publishedAt && site.isActive);

  // ── The live preview handshake (the on-screen editor) ─────────────────────
  // The iframe renders the REAL site renderer fed the draft: post it on every
  // edit (debounced — the payload includes the whole content tree), receive
  // clicks back as node selections. Same-origin only, both directions.
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
    // Canvas-sourced changes skip the re-post: the iframe already shows the
    // typed text, and re-rendering mid-keystroke would destroy the caret.
    if (canvasEditRef.current) {
      canvasEditRef.current = false;
      return;
    }
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
      if (e.data?.type === "mskool:preview-height") {
        const h = Number(e.data.height);
        if (Number.isFinite(h)) setPreviewHeight(Math.max(300, Math.min(8000, h)));
        return;
      }
      if (e.data?.type === "mskool:draft-edit") {
        // A canvas keystroke: apply it into the draft WITHOUT re-posting to
        // the iframe — re-rendering mid-keystroke would destroy the caret.
        // The iframe already shows the typed text.
        const t = e.data.target as CanvasTarget | undefined;
        const value = String(e.data.value ?? "");
        if (!t || typeof t.cpath !== "string" || !t.cpath) return;
        if (t.kind === "section" && !Number.isFinite(t.index)) return;
        const cpath = t.cpath;
        canvasEditRef.current = true;
        setDraft((current) => {
          const base = structuredClone((current ?? contentRef.current)!);
          const root: unknown =
            t.kind === "section"
              ? (base.sections[t.index]?.content ?? null)
              : (base as unknown as Record<string, unknown>)[t.kind];
          if (root == null || typeof root !== "object") return base;
          const keys = cpath.split(".");
          let cur: unknown = root;
          for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i]!;
            cur = Array.isArray(cur) ? cur[Number(k)] : (cur as Record<string, unknown>)[k];
            if (cur == null) return base;
          }
          const last = keys[keys.length - 1]!;
          if (Array.isArray(cur)) cur[Number(last)] = value;
          else (cur as Record<string, unknown>)[last] = value;
          return base;
        });
        return;
      }
      if (e.data?.type === "mskool:select" && e.data.target) {
        const t = e.data.target as CanvasTarget;
        if (t.kind === "section") {
          if (!Number.isFinite(t.index)) return;
          setSelection({ kind: "section", index: t.index });
        } else {
          setSelection({ kind: t.kind });
        }
        // The canvas resolved the click to a specific field — ring it. Every
        // click bumps the nonce so re-clicking the same field re-rings.
        if (typeof t.cpath === "string" && t.cpath) {
          setFocusPath(t.cpath);
          setFocusTick((n) => n + 1);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postDraft]);

  // The ring is a pointer: fade it after a beat.
  useEffect(() => {
    if (!focusPath) return;
    const t = setTimeout(() => setFocusPath(undefined), 4000);
    return () => clearTimeout(t);
  }, [focusPath]);

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
    if (thenPublish) {
      // Publish the local edits when there are any, else the server draft.
      if (draft) {
        const check = validate(draft);
        if (!check.success) {
          const issue = check.error.issues[0]!;
          toast.error(`Content is invalid at "${issue.path.join(".")}" — ${issue.message}`);
          return;
        }
        try {
          await publishDraft(draft);
          setDraft(null);
        } catch {
          // toasts handled in the mutations
        }
      } else {
        try {
          await publishNow();
        } catch {
          // toasts handled in the mutations
        }
      }
      return;
    }
    if (!draft) return;
    const check = validate(draft);
    if (!check.success) {
      const issue = check.error.issues[0]!;
      toast.error(`Content is invalid at "${issue.path.join(".")}" — ${issue.message}`);
      return;
    }
    try {
      await save(draft);
      setDraft(null);
    } catch {
      // toasts handled in the mutations
    }
  };

  const doUnpublish = async () => {
    if (!window.confirm("Take the public site offline? Visitors will see nothing; the draft is kept.")) return;
    try {
      await unpublishNow();
    } catch {
      // toasts handled in the mutations
    }
  };

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading the site draft…</p>;
  if (error) {
    const code = (error as { data?: { code?: string } })?.data?.code;
    // No row provisioned yet: the starter generator, not a dead end.
    if (code === "NOT_FOUND") return <StarterEmpty orgName={orgName} />;
    return (
      <p className="p-6 text-muted-foreground">
        You don&apos;t have access to a site editor for this organization.{" "}
        <Button variant="link" className="h-auto p-0" onClick={() => void refetch()}>
          Retry
        </Button>
      </p>
    );
  }
  if (!content) {
    return <StarterEmpty orgName={orgName} />;
  }

  const mutateContent = (fn: (c: PublicSiteContent) => PublicSiteContent) =>
    setDraft((current) => fn(structuredClone(current ?? content)));

  const removeSection = (index: number, title: string) => {
    if (
      !window.confirm(
        `Remove "${title}" from the draft? The live site is untouched until you publish.`,
      )
    ) {
      return;
    }
    mutateContent((c) => {
      c.sections.splice(index, 1);
      return c;
    });
    // Keep the selection on something that still exists.
    if (selection.kind === "section") {
      if (selection.index === index) setSelection({ kind: "chrome" });
      else if (selection.index > index) setSelection({ kind: "section", index: selection.index - 1 });
    }
  };

  const duplicateSection = (index: number) => {
    mutateContent((c) => {
      c.sections.splice(index + 1, 0, structuredClone(c.sections[index]!));
      return c;
    });
    setSelection({ kind: "section", index: index + 1 });
  };

  const sections = content.sections;
  const selectedSection = selection.kind === "section" ? sections[selection.index] : undefined;

  const editorForSelection = () => {
    switch (selection.kind) {
      case "chrome":
        return (
          <FieldsEditor
            value={content.chrome}
            focus={focus}
            onChange={(next) => mutateContent((c) => ({ ...c, chrome: next as PublicSiteContent["chrome"] }))}
          />
        );
      case "nav":
        return (
          <FieldsEditor
            value={content.nav}
            focus={focus}
            onChange={(next) => mutateContent((c) => ({ ...c, nav: next as PublicSiteContent["nav"] }))}
          />
        );
      case "footer":
        return (
          <FieldsEditor
            value={content.footer}
            focus={focus}
            onChange={(next) => mutateContent((c) => ({ ...c, footer: next as PublicSiteContent["footer"] }))}
          />
        );
      case "theme":
        return (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Colors are hex values (click any field to type a new one); the two
              fonts are family names the theme loads.
            </p>
            <FieldsEditor
              value={content.theme}
              focus={focus}
              onChange={(next) => mutateContent((c) => ({ ...c, theme: next as PublicSiteContent["theme"] }))}
            />
          </>
        );
      case "section":
        return selectedSection ? (
          <FieldsEditor
            key={`${selectedSection.key}-${selection.index}`}
            value={selectedSection.content}
            focus={focus}
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
      case "theme":
        return "Design · colors & fonts";
      case "section": {
        const s = sections[selection.index]!;
        return SECTION_LABELS[s.key] + (s.id ? ` · #${s.id}` : "");
      }
    }
  };

  return (
    <div className="w-full space-y-6 px-6 py-6">
      <PageHeader
        title="Website"
        description="Edit your public site's draft, then publish it to the live page."
        actions={
          <>
            {dirty ? <Badge>Pending changes</Badge> : null}
            {live ? (
              <Badge variant="secondary">Live since {new Date(site!.publishedAt!).toLocaleDateString()}</Badge>
            ) : site?.publishedAt ? (
              <Badge variant="secondary">Unpublished</Badge>
            ) : (
              <Badge variant="secondary">Never published</Badge>
            )}
            {dirty ? (
              <Button variant="ghost" disabled={isSaving} onClick={() => setDraft(null)}>
                <Undo2Icon className="size-4" /> Discard
              </Button>
            ) : null}
            <Button variant="outline" disabled={isSaving || !dirty} onClick={() => void doSave(false)}>
              <SaveIcon className="size-4" /> Save draft
            </Button>
            {live ? (
              <Button variant="outline" disabled={isSaving} onClick={() => void doUnpublish()}>
                <EyeOffIcon className="size-4" /> Unpublish
              </Button>
            ) : null}
            <Button disabled={isSaving || !liveOutdated} onClick={() => void doSave(true)}>
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
            <OutlineRow
              label="Design"
              hint="theme"
              active={selection.kind === "theme"}
              onClick={() => setSelection({ kind: "theme" })}
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Duplicate section"
                      onClick={() => duplicateSection(i)}
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      aria-label="Remove section"
                      onClick={() => removeSection(i, title)}
                    >
                      <Trash2Icon className="size-3.5" />
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
              {selection.kind === "theme" ? (
                <PaletteIcon className="size-4 text-muted-foreground" />
              ) : (
                <LayersIcon className="size-4 text-muted-foreground" />
              )}
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
                Live preview · click anything to edit it
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
                into the ResizeObserver and shrink to nothing. The frame box
                fits the page's reported height and scrolls when taller than
                the viewport. */}
            <div ref={paneRef} className="max-h-[75vh] w-full overflow-auto">
              <div
                className="mx-auto overflow-hidden rounded-xl border bg-white shadow-sm"
                style={{
                  width: Math.round(VIEWPORT_W * scale),
                  height: Math.round(previewHeight * scale),
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
                  height: previewHeight,
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
