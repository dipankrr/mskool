"use client";

import {
  ArrowLeftIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { fileToTemplateAssetBase64, useUploadTemplateAsset } from "./use-id-cards";

import { CanvasSettings, ElementProperties, FieldPalette } from "./designer-properties";
import { DesignerCanvas } from "./designer-canvas";
import { useTemplateDesigner } from "./use-template-designer";

/**
 * THE TEMPLATE DESIGNER (slice 2b) — edits an adopted template's design
 * document at `/students/id-cards/[templateId]/design`.
 *
 * Layout: the scaled card (rendered by the SAME shared surface the print
 * preview uses, so what is designed is what prints) with the field palette
 * beneath it, and the canvas settings + the selected element's properties on
 * the right. The dirty bar sits in the header: Save posts the whole document
 * through `idCard.template.update` (refusals surface worded, via
 * lib/errors.ts); Discard rewinds to the loaded row.
 *
 * THE SAMPLE CARD: the canvas renders against design-time sample data, not a
 * real student — the designer is a layout tool, and pulling a child's actual
 * record into a design session (and into its screenshots) buys nothing. The
 * print page renders the same template against the server-resolved card
 * data, which is where truth lives; the print path still invents nothing.
 */

/** Design-time placeholder — never sent anywhere, never real student data. */
const SAMPLE_CARD = {
  studentId: "sample-card",
  name: "Aarav Sharma",
  admissionNumber: "ADM-2026-014",
  rollNumber: "12",
  className: "Class 6",
  sectionName: "A",
  academicYear: "2026-27",
  dateOfBirth: "2013-04-12",
  bloodGroup: "B+",
  address: "12, Rose Villa, MG Road, Pune 411001",
  guardianName: "Rakesh Sharma",
  motherName: "Nisha Sharma",
  validTill: "2027-03-31",
  photoObjectId: null,
  schoolName: "Sunrise Public School",
};

export function TemplateDesigner({ templateId }: { templateId: string }) {
  const { has } = useActiveContext();
  const router = useRouter();
  const designer = useTemplateDesigner(templateId);
  const uploadAsset = useUploadTemplateAsset();
  const [uploading, setUploading] = useState(false);

  /** Upload through the storage seam, then let the caller re-point a ref. */
  const handleUpload = useCallback(
    async (file: File): Promise<string | null> => {
      setUploading(true);
      try {
        const dataBase64 = await fileToTemplateAssetBase64(file);
        if (!dataBase64) return null;
        return await uploadAsset.submit({ dataBase64 });
      } catch {
        return null;
      } finally {
        setUploading(false);
      }
    },
    [uploadAsset],
  );

  // Every hook above this line; the gates below only shape the render.

  if (!has("id_card:manage")) {
    return (
      <EmptyState
        title={copy.idCards.designer.title}
        description={copy.idCards.designer.noManage}
      />
    );
  }

  if (designer.row.isError) {
    return (
      <EmptyState
        title={copy.idCards.designer.loadFailed}
        description={copy.idCards.designer.loadFailedBody}
      />
    );
  }

  if (!designer.draft) {
    return (
      <>
        <PageHeader
          title={copy.idCards.designer.title}
          description={copy.idCards.designer.subtitle}
        />
        {designer.row.isLoading ? (
          <Spinner className="mt-8" />
        ) : (
          // A row that arrived but will not parse — saved by a different
          // contract version. Honest refusal, never a broken card.
          <EmptyState
            title={copy.idCards.designer.parseErrorTitle}
            description={copy.idCards.designer.parseErrorBody}
          />
        )}
      </>
    );
  }

  const draft = designer.draft;
  // The selected element lives on the ACTIVE side — back-side elements were
  // selectable but invisible to the property panel when this read the front
  // array only.
  const activeElements =
    designer.side === "back" && draft.back ? draft.back.elements : draft.elements;
  const selected = activeElements.find(
    (element) => element.id === designer.selectedId,
  );
  const d = copy.idCards.designer;

  return (
    <>
      <PageHeader
        title={draft.name || d.title}
        description={d.subtitle}
        actions={
          <div className="idcard-screen-only flex items-center gap-2">
            <Link
              href="/students/id-cards"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <ArrowLeftIcon data-slot="icon" />
              {d.back}
            </Link>
            <Button
              variant="outline"
              size="sm"
              disabled={!designer.dirty || designer.saving}
              onClick={() => designer.discard()}
            >
              {d.discard}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={d.undo}
              title={d.undo}
              disabled={!designer.canUndo || designer.saving}
              onClick={designer.undo}
            >
              <Undo2Icon data-slot="icon" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={d.redo}
              title={d.redo}
              disabled={!designer.canRedo || designer.saving}
              onClick={designer.redo}
            >
              <Redo2Icon data-slot="icon" />
            </Button>
            <Button
              size="sm"
              disabled={!designer.dirty || designer.saving}
              onClick={() => void designer.save()}
            >
              {designer.saving ? d.saving : d.save}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!designer.dirty || designer.saving}
              onClick={() => void designer.save().then((ok) => {
                if (ok) router.push("/students/id-cards");
              })}
            >
              {d.saveAndClose}
            </Button>
          </div>
        }
      />

      {/* The canvas column is 1fr and the panel fixed-width: the stage's
          width must come from the LAYOUT, never from the card itself, or
          scale-to-fit chases its own tail. */}
      <div className="idcard-screen-only grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]">
        {/* ── The card + palette ── */}
        {/* Sticky from lg up: the properties panel is long, and the operator
            must see the card WHILE editing an element — scrolling the panel
            must never scroll the card out of view. items-start + sticky keep
            the measured stage width stable, so scale-to-fit is unaffected. */}
        <div className="flex flex-col items-start gap-4 self-start lg:sticky lg:top-16">
          {/* The side switch: Front is always there; Back exists once added.
              Element ids are unique across both sides, and the undo stack
              snapshots the whole document — switching sides never loses
              history. */}
          <div className="flex items-center gap-2">
            <div className="bg-muted inline-flex items-center rounded-4xl p-[3px]">
              <button
                type="button"
                aria-pressed={designer.side === "front"}
                className={`h-8 rounded-full px-4 text-sm font-medium transition-colors ${
                  designer.side === "front"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => designer.setSide("front")}
              >
                {d.sideFront}
              </button>
              {draft.back ? (
                <button
                  type="button"
                  aria-pressed={designer.side === "back"}
                  className={`h-8 rounded-full px-4 text-sm font-medium transition-colors ${
                    designer.side === "back"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => designer.setSide("back")}
                >
                  {d.sideBack}
                </button>
              ) : null}
            </div>
            {!draft.back ? (
              <Button variant="outline" size="sm" onClick={designer.addBackSide}>
                {d.addBackSide}
              </Button>
            ) : null}
          </div>
          <DesignerCanvas
            template={
              designer.side === "back" && draft.back
                ? {
                    orientation: draft.orientation,
                    canvas: draft.back.canvas,
                    elements: draft.back.elements,
                  }
                : draft
            }
            sampleCard={SAMPLE_CARD}
            selectedId={designer.selectedId}
            onSelect={designer.selectElement}
            onGeometry={designer.setGeometry}
            onUndo={designer.undo}
            onRedo={designer.redo}
          />
          <p className="text-muted-foreground max-w-md text-xs">
            {d.canvasHint}
          </p>
          <FieldPalette onAdd={designer.addElement} />
        </div>

        {/* ── Settings + properties ── */}
        {/* The selected element's editor JUMPS ABOVE Card settings: the
            click that selects is what the operator wants to edit next, and
            with the canvas sticky beside it there is nothing to scroll to. */}
        <div className="flex min-w-0 flex-col gap-6">
          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle>{d.propertiesHeading}</CardTitle>
              </CardHeader>
              <CardContent>
                <ElementProperties
                  element={selected}
                  onReplace={designer.replaceElement}
                  onDelete={() => designer.removeElement(selected.id)}
                  onUploadAsset={handleUpload}
                  uploading={uploading}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{d.settingsHeading}</CardTitle>
            </CardHeader>
            <CardContent>
              <CanvasSettings
                draft={draft}
                side={designer.side}
                onName={designer.setName}
                onOrientation={designer.setOrientation}
                onBackground={designer.setBackground}
                onCanvasSize={designer.setCanvasSize}
                onCornerRadius={designer.setCornerRadius}
                onBackgroundFit={designer.fitBackground}
                onRemoveBack={designer.removeBackSide}
                onUploadAsset={handleUpload}
                uploading={uploading}
              />
            </CardContent>
          </Card>

          {!selected ? (
            <Card>
              <CardHeader>
                <CardTitle>{d.noSelection}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  {d.noSelectionBody}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
