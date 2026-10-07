"use client";

import { SiteRenderer } from "@/components/sites/site-renderer";
import type { PublicSiteContent } from "@repo/contracts";
import { useEffect, useState } from "react";

/**
 * THE LIVE PREVIEW (ADR-041 Tier A → the on-screen editor). Rendered inside
 * the site editor's iframe. It owns NO data: the parent editor posts the
 * current draft via postMessage on every edit, and this page simply renders
 * it with the real site renderer — so what the editor sees IS what
 * `{slug}.mskool.in` will serve.
 *
 * Clicking a section posts `mskool:select` back to the parent, which focuses
 * that section in the outline/fields panes. Clicks never navigate: preview
 * is a canvas, not a browser.
 *
 * Auth: none needed here, deliberately. The page renders nothing until the
 * parent (staff-gated) sends a draft; opened directly it is a polite dead
 * end. The draft itself never crosses a trust boundary — it comes only from
 * the same-origin editor that already verified the session.
 */
export function SitePreview() {
  const [content, setContent] = useState<PublicSiteContent | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Same-origin only: the editor is the one legitimate sender.
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "mskool:draft" && e.data.content) {
        setContent(e.data.content as PublicSiteContent);
      }
    }
    window.addEventListener("message", onMessage);
    // Tell the editor this pane is ready for its first draft.
    window.parent?.postMessage({ type: "mskool:preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Click-to-select: capture phase, so anchor links and CTAs inside the
  // preview never navigate — the canvas only selects.
  function onCanvasClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest("[data-section-index]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const index = Number(el.getAttribute("data-section-index"));
    if (Number.isFinite(index)) {
      window.parent?.postMessage({ type: "mskool:select", index }, window.location.origin);
    }
  }

  if (!content) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#FBF6DC] px-6 text-center font-sans text-[#1E3A34]">
        <p className="max-w-xs text-sm leading-relaxed opacity-70">
          This is the live preview canvas. Open it from the Website editor to
          see and click through your draft.
        </p>
      </div>
    );
  }

  return (
    <div onClickCapture={onCanvasClick}>
      <style>{`[data-section-index]{cursor:pointer}[data-section-index]:hover{outline:2px dashed rgba(232,84,47,.65);outline-offset:-2px}`}</style>
      <SiteRenderer content={content} />
    </div>
  );
}
