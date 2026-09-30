"use client";

import { useRef } from "react";

import type {
  IdCardBinding,
  IdCardTemplateData,
} from "@repo/contracts";
import { ID_CARD_BINDINGS } from "@repo/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { copy } from "@/lib/copy";

import type { NewElementType, DesignerDraft } from "./use-template-designer";
import { cardSizeMm } from "./template";

/**
 * THE DESIGNER'S PANELS (slice 2b) — the field palette (what to add), the
 * canvas settings (name, orientation, background), and the selected
 * element's properties. Everything here edits the DRAFT through the state
 * hook; only the dirty bar's Save sends anything. Vocabulary — "binding",
 * "starter", "branch" — lives in copy.ts like every other feature.
 */

type Element = IdCardTemplateData["elements"][number];

/** The card-data catalog's labels. The binding list IS the payload surface. */
const BINDING_LABELS: Record<IdCardBinding, string> = {
  studentName: copy.idCards.binding.studentName,
  admissionNumber: copy.idCards.binding.admissionNumber,
  rollNumber: copy.idCards.binding.rollNumber,
  className: copy.idCards.binding.className,
  sectionName: copy.idCards.binding.sectionName,
  academicYear: copy.idCards.binding.academicYear,
  dateOfBirth: copy.idCards.binding.dateOfBirth,
  bloodGroup: copy.idCards.binding.bloodGroup,
  address: copy.idCards.binding.address,
  guardianName: copy.idCards.binding.guardianName,
  motherName: copy.idCards.binding.motherName,
  validTill: copy.idCards.binding.validTill,
  schoolName: copy.idCards.binding.schoolName,
  custom: copy.idCards.binding.custom,
};

// ── Field palette ──────────────────────────────────────────────────────────

export function FieldPalette({
  onAdd,
  disabled,
}: {
  onAdd: (type: NewElementType) => void;
  disabled?: boolean;
}) {
  const d = copy.idCards.designer;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-sm">{d.paletteHeading}</span>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAdd("text")}>
        {d.addText}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAdd("photo")}>
        {d.addPhoto}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAdd("qr")}>
        {d.addQr}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAdd("logo")}>
        {d.addLogo}
      </Button>
    </div>
  );
}

// ── Canvas settings ────────────────────────────────────────────────────────

export function CanvasSettings({
  draft,
  onName,
  onOrientation,
  onBackground,
  onCanvasSize,
  onCornerRadius,
  onBackgroundFit,
  onUploadAsset,
  uploading,
}: {
  draft: DesignerDraft;
  onName: (name: string) => void;
  onOrientation: (orientation: IdCardTemplateData["orientation"]) => void;
  onBackground: (assetId: string | null) => void;
  /** Hand-sets the card's physical size (mm). */
  onCanvasSize: (widthMm: number, heightMm: number) => void;
  /** Hand-sets the printed card's corner rounding (mm). */
  onCornerRadius: (cornerRadiusMm: number) => void;
  /**
   * Background upload with FIT: the card adopts the image's aspect ratio as
   * its physical size (the reason a school uploads a designed sheet).
   */
  onBackgroundFit: (
    assetId: string,
    imageWidthPx: number,
    imageHeightPx: number,
  ) => void;
  /** Uploads through the storage seam; resolves the new object id. */
  onUploadAsset: (file: File) => Promise<string | null>;
  uploading: boolean;
}) {
  const d = copy.idCards.designer;
  const fileInput = useRef<HTMLInputElement>(null);
  const size = cardSizeMm(draft);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idcard-template-name">{d.name}</Label>
        <Input
          id="idcard-template-name"
          value={draft.name}
          maxLength={150}
          onChange={(event) => onName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idcard-template-orientation">{d.orientation}</Label>
        <Select
          value={draft.orientation}
          onValueChange={(value) =>
            onOrientation(value as IdCardTemplateData["orientation"])
          }
        >
          <SelectTrigger id="idcard-template-orientation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="landscape">{copy.idCards.orientationLandscape}</SelectItem>
            <SelectItem value="portrait">{copy.idCards.orientationPortrait}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{d.orientationConsequence}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{d.canvasSize}</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label={d.canvasWidth}
            type="number"
            min={20}
            max={300}
            step={0.5}
            value={size.widthMm}
            onChange={(event) =>
              onCanvasSize(Number(event.target.value), size.heightMm)
            }
          />
          <Input
            aria-label={d.canvasHeight}
            type="number"
            min={20}
            max={300}
            step={0.5}
            value={size.heightMm}
            onChange={(event) =>
              onCanvasSize(size.widthMm, Number(event.target.value))
            }
          />
        </div>
        <p className="text-muted-foreground text-xs">{d.canvasSizeHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idcard-corner-radius">{d.cornerRadius}</Label>
        <Input
          id="idcard-corner-radius"
          type="number"
          min={0}
          max={20}
          step={0.5}
          value={draft.canvas.cornerRadiusMm ?? 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onCornerRadius(parsed);
          }}
        />
        <p className="text-muted-foreground text-xs">{d.cornerRadiusHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{d.background}</Label>
        {draft.canvas.backgroundAssetId ? (
          <div className="flex items-center gap-3">
            <img
              src={`/api/storage/${draft.canvas.backgroundAssetId}`}
              alt=""
              className="h-10 w-16 rounded border object-cover"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={() => onBackground(null)}
            >
              {d.removeBackground}
            </Button>
          </div>
        ) : (
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void (async () => {
                    // Read the image's natural size client-side FIRST — it
                    // decides the card's physical size (fit-to-background).
                    const bitmap = await createImageBitmap(file);
                    const widthPx = bitmap.width;
                    const heightPx = bitmap.height;
                    bitmap.close();
                    const objectId = await onUploadAsset(file);
                    if (objectId) onBackgroundFit(objectId, widthPx, heightPx);
                  })();
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {d.uploadBackground}
            </Button>
          </div>
        )}
        <p className="text-muted-foreground text-xs">{d.backgroundHint}</p>
      </div>
    </div>
  );
}

// ── Element properties ─────────────────────────────────────────────────────

export function ElementProperties({
  element,
  onReplace,
  onDelete,
  onUploadAsset,
  uploading,
}: {
  element: Element;
  onReplace: (next: Element) => void;
  onDelete: () => void;
  onUploadAsset: (file: File) => Promise<string | null>;
  uploading: boolean;
}) {
  const d = copy.idCards.designer;

  return (
    <div className="flex flex-col gap-4">
      {element.type === "text" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>{d.binding}</Label>
            <Select
              value={element.binding}
              onValueChange={(value) =>
                onReplace({ ...element, binding: value as IdCardBinding })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ID_CARD_BINDINGS.map((binding) => (
                  <SelectItem key={binding} value={binding}>
                    {BINDING_LABELS[binding]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {element.binding === "custom" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idcard-custom-text">{d.customText}</Label>
              <Input
                id="idcard-custom-text"
                value={element.customText ?? ""}
                maxLength={200}
                onChange={(event) =>
                  onReplace({ ...element, customText: event.target.value })
                }
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idcard-font-size">{d.fontSize}</Label>
              <Input
                id="idcard-font-size"
                type="number"
                min={4}
                max={48}
                value={element.fontSize}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) {
                    onReplace({
                      ...element,
                      fontSize: Math.min(48, Math.max(4, Math.round(parsed))),
                    });
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{d.fontWeight}</Label>
              <Select
                value={element.fontWeight}
                onValueChange={(value) =>
                  onReplace({
                    ...element,
                    fontWeight: value as "normal" | "bold",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">{d.weightNormal}</SelectItem>
                  <SelectItem value="bold">{d.weightBold}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idcard-color">{d.color}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="idcard-color"
                  type="color"
                  value={element.color ?? "#111827"}
                  className="h-9 w-9 cursor-pointer rounded border"
                  onChange={(event) =>
                    onReplace({ ...element, color: event.target.value })
                  }
                />
                <span className="text-muted-foreground font-mono text-xs">
                  {element.color ?? "#111827"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{d.align}</Label>
              <div className="flex gap-1">
                {ALIGN_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={element.align === option.value ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => onReplace({ ...element, align: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {element.type === "logo" ? <LogoAssetField
        element={element}
        onReplace={onReplace}
        onUploadAsset={onUploadAsset}
        uploading={uploading}
      /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="idcard-element-radius">{d.borderRadius}</Label>
        <Input
          id="idcard-element-radius"
          type="number"
          min={0}
          max={50}
          value={element.borderRadius ?? 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            const borderRadius = Math.min(50, Math.max(0, parsed));
            onReplace({ ...element, borderRadius: borderRadius || undefined });
          }}
        />
        <p className="text-muted-foreground text-xs">{d.borderRadiusHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{d.positionHeading}</Label>
        <GeometryFields element={element} onReplace={onReplace} />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="idcard-element-visible">{d.visible}</Label>
        <Switch
          id="idcard-element-visible"
          checked={element.visible !== false}
          onCheckedChange={(checked) => onReplace({ ...element, visible: checked })}
        />
      </div>

      <Button variant="destructive" size="sm" onClick={onDelete}>
        {d.delete}
      </Button>
    </div>
  );
}

const ALIGN_OPTIONS: { value: "left" | "center" | "right"; label: string }[] = [
  { value: "left", label: copy.idCards.designer.alignLeft },
  { value: "center", label: copy.idCards.designer.alignCenter },
  { value: "right", label: copy.idCards.designer.alignRight },
];

function GeometryFields({
  element,
  onReplace,
}: {
  element: Element;
  onReplace: (next: Element) => void;
}) {
  const d = copy.idCards.designer;
  const fields = [
    { key: "x", label: d.posX },
    { key: "y", label: d.posY },
    { key: "width", label: d.posWidth },
    { key: "height", label: d.posHeight },
  ] as const;

  return (
    <div className="grid grid-cols-4 gap-2">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{field.label}</span>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={element[field.key]}
            className="h-8"
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) {
                onReplace({
                  ...element,
                  [field.key]: Math.min(100, Math.max(0, parsed)),
                });
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

function LogoAssetField({
  element,
  onReplace,
  onUploadAsset,
  uploading,
}: {
  element: Extract<Element, { type: "logo" }>;
  onReplace: (next: Element) => void;
  onUploadAsset: (file: File) => Promise<string | null>;
  uploading: boolean;
}) {
  const d = copy.idCards.designer;
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{d.logoAsset}</Label>
      {element.assetId ? (
        <div className="flex items-center gap-3">
          <img
            src={`/api/storage/${element.assetId}`}
            alt=""
            className="h-10 w-10 rounded border object-contain"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => onReplace({ ...element, assetId: null })}
          >
            {d.clearLogo}
          </Button>
        </div>
      ) : (
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void onUploadAsset(file).then((objectId) => {
                  if (objectId) onReplace({ ...element, assetId: objectId });
                });
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {d.uploadLogo}
          </Button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">{d.logoHint}</p>
    </div>
  );
}
