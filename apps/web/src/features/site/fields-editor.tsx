"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageField } from "./image-field";
import { VideoIdField } from "./video-field";
import { useEffect, useRef } from "react";

/**
 * The editor's auto-form (ADR-041 Tier A): walks ANY section content object
 * and renders inputs for every leaf, so a new field in the contract is
 * editable here with zero editor code. Strings only at the leaves by
 * contract design — images are URL strings (ADR-042), and URL fields render
 * with a thumbnail preview so an editor never stares at a raw uuid.
 *
 * Layout heuristics keep it humane: short sibling strings go side by side,
 * long text gets a textarea, arrays of objects become removable cards.
 */

const IMAGE_URL = /\.(webp|png|jpe?g|gif|svg)(\?|$)|^\/api\/public\/storage\//i;

function isImageUrl(value: string) {
  return IMAGE_URL.test(value);
}

function humanize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function StringInput({
  value,
  onChange,
  autoFocusItem,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocusItem?: boolean;
}) {
  const isImage = isImageUrl(value);
  if (isImage) {
    return <ImageField value={value} onChange={onChange} />;
  }

  const long = value.length > 70;
  if (long) {
    return (
      <Textarea
        value={value}
        rows={Math.min(6, Math.ceil(value.length / 70) + 1)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return <Input value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocusItem} />;
}

function FieldRow({
  label,
  children,
  active,
  focus,
}: {
  label: string;
  children: React.ReactNode;
  /** The canvas clicked THIS exact field — ring it and bring it into view. */
  active?: boolean;
  /** Carries the click nonce: re-clicking the same field re-fires the
   * scroll/ring instead of silently no-opping on an unchanged boolean. */
  focus?: { path: string; n: number };
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Re-runs on every canvas click: focus carries a nonce so re-clicking
    // the same field re-rings and re-scrolls instead of dying silently.
  }, [active, focus]);
  return (
    <div
      ref={rowRef}
      className={cn(
        "rounded-lg p-2 -m-2 transition-shadow",
        active && "bg-primary/5 ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <Label className="text-[13px] font-medium">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * The ring+scroll for list rows that are not FieldRows: array-of-object
 * sheets (cards, members, FAQ items — the canvas addresses a whole card by
 * `cards.2`) and short string-list rows (phones). Same nonce contract as
 * FieldRow: an exact-path match rings, every click re-scrolls.
 */
function FocusWrap({
  active,
  n,
  className,
  children,
}: {
  active?: boolean;
  n?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, n]);
  return (
    <div
      ref={ref}
      className={cn(className, active && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
    >
      {children}
    </div>
  );
}

export function FieldsEditor({
  value,
  onChange,
  path = [],
  focus,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  path?: string[];
  /** Content path clicked on the canvas (e.g. "cards.2.description") — the
   * matching field here rings and scrolls into view. */
  focus?: { path: string; n: number };
}) {
  // ── Leaves ────────────────────────────────────────────────────────────────
  if (typeof value === "string") {
    // Video ids are the one leaf with a link-paste habit: the contract holds
    // a bare id, humans paste watch URLs, so this field extracts on input.
    if (path[path.length - 1] === "videoId") {
      return <VideoIdField value={value} onChange={onChange} />;
    }
    return <StringInput value={value} onChange={onChange} />;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <Input
        type={typeof value === "number" ? "number" : "text"}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (typeof value === "number") {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          } else {
            onChange(raw === "true");
          }
        }}
      />
    );
  }

  // ── Arrays ────────────────────────────────────────────────────────────────
  if (Array.isArray(value)) {
    const allStrings = value.every((v) => typeof v === "string");

    if (allStrings && value.length <= 4) {
      // Short string list: one input per item, remove on empty.
      return (
        <div className="space-y-2">
          {value.map((item, i) => (
            <FocusWrap
              key={i}
              active={focus?.path === [...path, String(i)].join(".")}
              n={focus?.n}
              className="flex items-center gap-2 rounded-lg"
            >
              <Input
                value={String(item)}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove item"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </FocusWrap>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
            + Add item
          </Button>
        </div>
      );
    }

    // Array of objects (cards, nav rows, members, stats…): removable sheets.
    const template = () => {
      const first = value[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return Object.fromEntries(
          Object.entries(first as Record<string, unknown>).map(([k, v]) => [
            k,
            typeof v === "number" ? 0 : typeof v === "boolean" ? false : Array.isArray(v) ? [] : "",
          ]),
        );
      }
      return "";
    };

    return (
      <div className="space-y-3">
        {value.map((item, i) => (
          <FocusWrap
            key={i}
            active={focus?.path === [...path, String(i)].join(".")}
            n={focus?.n}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {humanize(path[path.length - 1] ?? "item").replace(/s$/, "")} {i + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
            <FieldsEditor
              value={item}
              focus={focus}
              onChange={(next) => {
                const arr = [...value];
                arr[i] = next;
                onChange(arr);
              }}
              path={[...path, String(i)]}
            />
          </FocusWrap>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-dashed"
          onClick={() => onChange([...value, template()])}
        >
          + Add {humanize(path[path.length - 1] ?? "item").replace(/s$/, "")}
        </Button>
      </div>
    );
  }

  // ── Objects ───────────────────────────────────────────────────────────────
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    // Short string/number siblings pair up in a 2-col grid; long or complex
    // values go full width. Consecutive halves are grouped into runs.
    const half = (v: unknown) =>
      ((typeof v === "string" && v.length <= 40 && !isImageUrl(v)) || typeof v === "number") ?? false;

    const runs: { kind: "pair"; items: [string, unknown][] }[] | { kind: "full"; key: string; v: unknown }[] = [];
    void runs;
    type Block = { kind: "pair"; items: [string, unknown][] } | { kind: "full"; key: string; v: unknown };
    const blocks: Block[] = [];
    for (const [key, v] of entries) {
      if (half(v)) {
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "pair" && last.items.length === 1) {
          last.items.push([key, v]);
        } else {
          blocks.push({ kind: "pair", items: [[key, v]] });
        }
      } else {
        blocks.push({ kind: "full", key, v });
      }
    }

    return (
      <div className="space-y-4">
        {blocks.map((block, bi) =>
          block.kind === "pair" ? (
            <div key={bi} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {block.items.map(([key, v]) => (
                <FieldRow key={key} label={humanize(key)} active={focus?.path === [...path, key].join(".")} focus={focus}>
                  <FieldsEditor
                    value={v}
                    focus={focus}
                    onChange={(next) => onChange({ ...(value as object), [key]: next })}
                    path={[...path, key]}
                  />
                </FieldRow>
              ))}
            </div>
          ) : (
            <FieldRow key={block.key} label={humanize(block.key)} active={focus?.path === [...path, block.key].join(".")} focus={focus}>
              <FieldsEditor
                value={block.v}
                focus={focus}
                onChange={(next) => onChange({ ...(value as object), [block.key]: next })}
                path={[...path, block.key]}
              />
            </FieldRow>
          ),
        )}
      </div>
    );
  }

  // null / undefined — not produced by the contract, but never crash the editor.
  return <Input value="" onChange={(e) => onChange(e.target.value)} />;
}
