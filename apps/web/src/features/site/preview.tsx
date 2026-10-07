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
 * path and carrying no child elements) makes it contentEditable in place;
 * keystrokes post `mskool:draft-edit` to the parent debounced, and the
 * parent SUPPRESSES re-posting content back here while the field is being
 * typed — a re-render mid-keystroke would destroy the caret. Clicks on
 * non-text elements (images, complex leaves) just select their field in the
 * editor pane. Clicks never navigate: the canvas selects and edits only.
 */
export function SitePreview() {
  const [content, setContent] = useState<PublicSiteContent | null>(null);

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

  // ── Inline editing state ─────────────────────────────────────────────────
  const editingRef = useRef<{
    el: HTMLElement;
    index: number;
    cpath: string;
    original: string;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  function postEdit(index: number, cpath: string, value: string) {
    window.parent?.postMessage(
      { type: "mskool:draft-edit", index, cpath, value },
      window.location.origin,
    );
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
    postEdit(ed.index, ed.cpath, ed.el.textContent ?? "");
  }

  function onEditInput(this: HTMLElement) {
    const ed = editingRef.current;
    if (!ed) return;
    if (ed.timer) clearTimeout(ed.timer);
    ed.timer = setTimeout(() => postEdit(ed.index, ed.cpath, ed.el.innerText), 400);
  }

  function onEditBlur(this: HTMLElement) {
    finishInlineEdit(true);
  }

  function onEditKeydown(this: HTMLElement, e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLElement).blur(); // commit
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishInlineEdit(false); // restore the original text
    }
  }

  function startInlineEdit(el: HTMLElement, index: number, cpath: string) {
    if (editingRef.current) return; // one field at a time
    editingRef.current = {
      el,
      index,
      cpath,
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
  // back to the owning section.
  function onCanvasClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const fieldEl = target.closest("[data-cpath]") as HTMLElement | null;
    const sectionEl = target.closest("[data-section-index]");
    if (!fieldEl && !sectionEl) return;
    e.preventDefault();
    e.stopPropagation();
    const index = sectionEl ? Number(sectionEl.getAttribute("data-section-index")) : undefined;
    const cpath = fieldEl ? (fieldEl.getAttribute("data-cpath") ?? undefined) : undefined;
    // A text leaf → edit in place. Everything else (images, complex leaves)
    // selects its field in the editor pane.
    const isTextLeaf =
      fieldEl !== null &&
      fieldEl.children.length === 0 &&
      (fieldEl.textContent ?? "").trim().length > 0 &&
      !editingRef.current;
    if (isTextLeaf && fieldEl && index !== undefined && cpath) {
      startInlineEdit(fieldEl, index, cpath);
    }
    if (Number.isFinite(index)) {
      window.parent?.postMessage(
        { type: "mskool:select", index, cpath },
        window.location.origin,
      );
    }
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
    <div onClickCapture={onCanvasClick}>
      <style>{`[data-section-index]{cursor:pointer}[data-section-index]:hover{outline:2px dashed rgba(232,84,47,.65);outline-offset:-2px}[data-cpath]:hover{outline:2px solid rgba(232,84,47,.9);outline-offset:2px}`}</style>
      <SiteRenderer content={content} />
    </div>
  );
}
