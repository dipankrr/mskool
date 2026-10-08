"use client";

import { SiteRenderer } from "@/components/sites/site-renderer";
import type { PublicSiteContent } from "@repo/contracts";
import { useEffect, useRef, useState } from "react";

/**
 * THE LIVE PREVIEW (ADR-041). Rendered inside the site editor's iframe and
 * fed the draft via postMessage — the same renderer the public site serves,
 * so the editor sees exactly what visitors will see.
 *
 * Inline editing: clicking a text leaf (an element stamped with its content
 * path and carrying no nested field, with either no child elements or only
 * inline decoration marked `data-edit-rich`) makes it contentEditable in
 * place; keystrokes post `mskool:draft-edit` to the parent debounced, and the
 * parent SUPPRESSES re-posting content back here while the field is being
 * typed — a re-render mid-keystroke would destroy the caret. Clicks on
 * non-text elements (images, card containers, complex leaves) just select
 * their field in the editor pane. Clicks never navigate: the canvas selects
 * and edits only.
 *
 * Targets address every editable root, not just sections: chrome (header),
 * nav links, footer, and section content. The field element's nearest
 * `data-region` wins, so the footer wordmark (which displays chrome.orgName)
 * correctly resolves to chrome.
 */

/** Where on the canvas a click landed, and which editor root owns it. */
export type CanvasTarget =
  | { kind: "section"; index: number; cpath?: string }
  | { kind: "chrome"; cpath?: string }
  | { kind: "nav"; cpath?: string }
  | { kind: "footer"; cpath?: string };

export function SitePreview() {
  const [content, setContent] = useState<PublicSiteContent | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Same-origin only: the editor is the one legitimate sender.
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "mskool:draft" && e.data.content) {
        // Ignore drafts while a field is being typed in place — a re-render
        // here would blow away the caret and the in-progress DOM edits.
        if (editingRef.current) return;
        setContent(e.data.content as PublicSiteContent);
      }
    }
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "mskool:preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Report the rendered height so the editor sizes the scaled frame to the
  // whole page instead of clipping long sites at a fixed viewport height.
  // One-way: the parent never re-posts content for this message, so no loop.
  useEffect(() => {
    if (!content || !rootRef.current) return;
    const postHeight = () => {
      const height = Math.max(300, Math.min(8000, rootRef.current?.scrollHeight ?? 0));
      window.parent?.postMessage({ type: "mskool:preview-height", height }, window.location.origin);
    };
    postHeight();
    const settle = setTimeout(postHeight, 600); // images/fonts settle late
    const ro = new ResizeObserver(postHeight);
    ro.observe(rootRef.current);
    return () => {
      clearTimeout(settle);
      ro.disconnect();
    };
  }, [content]);

  // ── Inline editing state ─────────────────────────────────────────────────
  const editingRef = useRef<{
    el: HTMLElement;
    target: CanvasTarget;
    original: string;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  function postEdit(target: CanvasTarget, value: string) {
    window.parent?.postMessage({ type: "mskool:draft-edit", target, value }, window.location.origin);
  }

  function finishInlineEdit(commit: boolean) {
    const ed = editingRef.current;
    if (!ed) return;
    if (ed.timer) clearTimeout(ed.timer);
    if (!commit) ed.el.textContent = ed.original;
    ed.el.contentEditable = "false";
    ed.el.style.outline = "";
    ed.el.removeEventListener("input", onEditInput);
    ed.el.removeEventListener("blur", onEditBlur);
    ed.el.removeEventListener("keydown", onEditKeydown);
    editingRef.current = null;
    // The final value lands in the draft either way — the parent suppresses
    // the iframe re-post for canvas-sourced changes.
    postEdit(ed.target, ed.el.innerText ?? "");
  }

  function onEditInput(this: HTMLElement) {
    const ed = editingRef.current;
    if (!ed) return;
    if (ed.timer) clearTimeout(ed.timer);
    ed.timer = setTimeout(() => postEdit(ed.target, ed.el.innerText), 400);
  }

  function onEditBlur(this: HTMLElement) {
    finishInlineEdit(true);
  }

  function onEditKeydown(this: HTMLElement, e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      // Plain Enter commits; Shift+Enter keeps the default newline so
      // multi-line fields (body, answers) stay editable in place.
      e.preventDefault();
      (e.target as HTMLElement).blur(); // commit
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishInlineEdit(false); // restore the original text
    }
  }

  function startInlineEdit(el: HTMLElement, target: CanvasTarget) {
    if (editingRef.current) return; // one field at a time
    editingRef.current = {
      el,
      target,
      original: el.textContent ?? "",
      timer: null,
    };
    el.contentEditable = "true";
    el.style.outline = "2px solid rgba(232,84,47,0.9)";
    el.style.outlineOffset = "2px";
    el.focus();
    // Caret to the end of the existing text; clicking again repositions it
    // normally now that the element is editable.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.addEventListener("input", onEditInput);
    el.addEventListener("blur", onEditBlur);
    el.addEventListener("keydown", onEditKeydown);
  }

  // Click-to-select/edit: capture phase, so anchor links and CTAs inside the
  // preview never navigate — the canvas selects, edits, nothing else. The
  // click resolves to the FINEST target: an element stamped with its content
  // path (data-cpath, e.g. "cards.2.description") under the cursor, falling
  // back to the owning section or chrome/nav/footer region.
  function onCanvasClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const fieldEl = target.closest("[data-cpath]") as HTMLElement | null;
    const sectionEl = target.closest("[data-section-index]");
    if (!fieldEl && !sectionEl && !target.closest("[data-region]")) return;
    e.preventDefault();
    e.stopPropagation();

    // The field's own nearest region wins over the section (the footer's
    // wordmark is chrome content rendered inside the footer region).
    const fieldRegion = fieldEl
      ? (fieldEl.closest("[data-region]") as HTMLElement | null)?.getAttribute("data-region")
      : null;
    const containerRegion = (target.closest("[data-region]") as HTMLElement | null)?.getAttribute(
      "data-region",
    );
    const region = fieldRegion ?? containerRegion;
    const cpath = fieldEl ? (fieldEl.getAttribute("data-cpath") ?? undefined) : undefined;

    let select: CanvasTarget | null = null;
    if (region === "chrome" || region === "nav" || region === "footer") {
      select = { kind: region, cpath };
    } else if (sectionEl) {
      const index = Number(sectionEl.getAttribute("data-section-index"));
      if (Number.isFinite(index)) select = { kind: "section", index, cpath };
    }
    if (!select) return;

    // A text leaf → edit in place: stamped, no nested stamped field, and
    // either a bare text element or one whose children are inline decoration
    // (data-edit-rich, e.g. the SectionHeader's accent spans). Everything
    // else (images, card containers, complex leaves) just selects.
    const isTextLeaf =
      fieldEl !== null &&
      cpath !== undefined &&
      fieldEl.querySelector("[data-cpath]") === null &&
      (fieldEl.children.length === 0 || fieldEl.hasAttribute("data-edit-rich")) &&
      (fieldEl.textContent ?? "").trim().length > 0 &&
      !editingRef.current;
    if (isTextLeaf && fieldEl) {
      startInlineEdit(fieldEl, select);
    }
    window.parent?.postMessage({ type: "mskool:select", target: select }, window.location.origin);
  }

  if (!content) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#FBF6DC] px-6 text-center font-sans text-[#1E3A34]">
        <p className="max-w-xs text-sm leading-relaxed opacity-70">
          This is the live preview canvas. Open it from the Website editor to
          see, click, and type on your draft.
        </p>
      </div>
    );
  }

  return (
    <div ref={rootRef} onClickCapture={onCanvasClick}>
      <style>{`[data-section-index]{cursor:pointer}[data-section-index]:hover{outline:2px dashed rgba(232,84,47,.65);outline-offset:-2px}[data-cpath]:hover{outline:2px solid rgba(232,84,47,.9);outline-offset:2px}[data-region]{cursor:pointer}`}</style>
      <SiteRenderer content={content} />
    </div>
  );
}
