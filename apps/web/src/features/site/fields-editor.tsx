"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The editor's auto-form (ADR-041 Tier A): walks ANY section content object
 * and renders inputs for every leaf, so a new field in the contract is
 * editable here with zero editor code. Arrays of objects get per-item
 * fieldsets with remove/add; anything too hairy for an input is still
 * reachable through the JSON textarea fallback.
 *
 * Strings only at the leaves by contract design — images are URL strings
 * (ADR-042), so pasting an object-store URL is the upload story until the
 * dedicated picker lands.
 */

function humanize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function FieldsEditor({
  value,
  onChange,
  level = 0,
  path = [],
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  level?: number;
  path?: string[];
}) {
  if (typeof value === "string") {
    const long = value.length > 80 || /https?:\/\//.test(value) === false && value.length > 60;
    return long ? (
      <Textarea
        value={value}
        rows={Math.min(6, Math.ceil(value.length / 70) + 1)}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5"
      />
    ) : (
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5" />
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <Input
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
        className="mt-1.5"
      />
    );
  }

  if (Array.isArray(value)) {
    const allStrings = value.every((v) => typeof v === "string");
    return (
      <div className="mt-2 space-y-2">
        {value.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              {allStrings ? (
                <Input
                  value={String(item)}
                  onChange={(e) => {
                    const next = [...value];
                    next[i] = e.target.value;
                    onChange(next);
                  }}
                />
              ) : (
                <div className="rounded-xl border bg-muted/30 p-3">
                  <FieldsEditor
                    value={item}
                    onChange={(next) => {
                      const arr = [...value];
                      arr[i] = next;
                      onChange(arr);
                    }}
                    level={level + 1}
                    path={[...path, String(i)]}
                  />
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              aria-label="Remove item"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange(
              allStrings
                ? [...value, ""]
                : [...value, typeof value[0] === "object" && value[0] !== null && !Array.isArray(value[0])
                    ? Object.fromEntries(Object.keys(value[0] as object).map((k) => [k, typeof (value[0] as Record<string, unknown>)[k] === "number" ? 0 : ""]))
                    : ""],
            )
          }
        >
          + Add
        </Button>
      </div>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className={level === 0 ? "space-y-4" : "mt-2 space-y-3"}>
        {entries.map(([key, child]) => (
          <div key={key}>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {humanize(key)}
            </Label>
            <FieldsEditor
              value={child}
              onChange={(next) => onChange({ ...(value as object), [key]: next })}
              level={level + 1}
              path={[...path, key]}
            />
          </div>
        ))}
      </div>
    );
  }

  // null / undefined — not produced by the contract, but never crash the editor.
  return <Input value="" onChange={(e) => onChange(e.target.value)} className="mt-1.5" />;
}
