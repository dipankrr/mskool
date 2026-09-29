"use client";

import { PencilIcon, PrinterIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import type { IdCardStudentCard } from "@repo/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { IdCardPreview } from "@/features/id-cards/id-card-preview";
import { PREBUILT_TEMPLATES } from "@/features/id-cards/prebuilt-templates";
import {
  useAdoptTemplate,
  useCloneGalleryTemplate,
  useCreateTemplate,
  useGalleryTemplates,
  useIdCardTemplates,
  usePublishTemplate,
  useSetDefaultTemplate,
  useStudentSelection,
  useTemplateChoices,
  type TemplateChoice,
} from "@/features/id-cards/use-id-cards";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * STUDENT ID CARDS (slice 2a; 2b adds the management + gallery surface) —
 * pick a class/section and students, pick a template (an adopted row, a
 * starter design, or a clone from the community gallery), preview, print.
 *
 * The template JSON is laid out by the shared renderer against
 * `idCard.cardData` — the server's payload, never client-invented facts. The
 * print sheet (`.idcard-print-sheet`, globals.css) renders the SAME cards at
 * physical CR80 size in an A4 grid with cut guides; `@media print` hides
 * every piece of chrome around it.
 *
 * 2b's additions, all gated `id_card:manage`: Edit (the designer), Publish/
 * Unpublish, New template (build-from-blank), and the community gallery —
 * published designs from EVERY org, clonable into the caller's school (the
 * one deliberate platform-level read; see the router's gallery comment).
 */

const THIRTY_SECONDS = 30 * 1000;

export default function IdCardsPage() {
  const { organizationId, schoolId, activeSession } = useActiveContext();
  const router = useRouter();

  const templates = useIdCardTemplates();
  const classes = useClasses();
  const [classId, setClassId] = useState("");
  const sections = useSections(classId || undefined);
  const [sectionId, setSectionId] = useState("");

  const roster = trpc.enrollment.list.useQuery(
    {
      organizationId,
      academicYearId: activeSession?.id ?? "",
      ...(classId ? { classId } : {}),
      ...(sectionId ? { sectionId } : {}),
    },
    { enabled: Boolean(activeSession), staleTime: THIRTY_SECONDS },
  );

  const selection = useStudentSelection();
  const adopted = useTemplateChoices(templates.data);
  const adopt = useAdoptTemplate();
  const setDefault = useSetDefaultTemplate();
  const publish = usePublishTemplate();
  const createTemplate = useCreateTemplate();
  const cloneTemplate = useCloneGalleryTemplate();
  const gallery = useGalleryTemplates();

  const [choice, setChoice] = useState<TemplateChoice | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOrientation, setNewOrientation] = useState<"landscape" | "portrait">(
    "landscape",
  );
  const [cloneTarget, setCloneTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [cloneName, setCloneName] = useState("");

  // First paint: pre-select the school's default template, else the first.
  useEffect(() => {
    if (choice || adopted.length === 0) return;
    const defaultRow = (templates.data ?? []).find((row) => row.isDefault);
    const fallback =
      adopted.find((option) => option.key === defaultRow?.id) ?? adopted[0];
    if (fallback) setChoice(fallback);
  }, [adopted, choice, templates.data]);

  // The payload — fetched for the SELECTION exactly as picked. Enabled only
  // when a branch and session are real, because both are required inputs.
  const cards = trpc.idCard.cardData.useQuery(
    {
      organizationId,
      schoolId: schoolId ?? "",
      academicYearId: activeSession?.id ?? "",
      studentIds: Array.from(selection.selected),
    },
    {
      enabled:
        Boolean(schoolId) &&
        Boolean(activeSession) &&
        selection.selected.size > 0,
      staleTime: THIRTY_SECONDS,
    },
  );

  const cardByStudentId = useMemo(() => {
    const map = new Map<string, IdCardStudentCard>();
    for (const card of cards.data ?? []) map.set(card.studentId, card);
    return map;
  }, [cards.data]);

  // Preview order follows the roster the user picked from.
  const selectedPairs = useMemo(
    () =>
      (roster.data ?? []).filter((pair) =>
        selection.selected.has(pair.student.id),
      ),
    [roster.data, selection.selected],
  );

  if (!schoolId || !activeSession) {
    return (
      <>
        <PageHeader
          title={copy.nav.idCards}
          description={copy.idCards.subtitle}
        />
        <EmptyState
          title={copy.idCards.chooseBranchBody}
          description={copy.idCards.subtitle}
        />
      </>
    );
  }

  const orientation = choice?.data.orientation ?? "landscape";
  // CR80 on A4: 2 × 4 landscape (8) or 3 × 3 portrait (9), cut guides between.
  const perPage = orientation === "portrait" ? 9 : 8;
  const printableCards = selectedPairs
    .map((pair) => cardByStudentId.get(pair.student.id))
    .filter((card): card is IdCardStudentCard => card !== undefined);
  const printPages: (typeof printableCards)[] = [];
  for (let i = 0; i < printableCards.length; i += perPage) {
    printPages.push(printableCards.slice(i, i + perPage));
  }

  return (
    <>
      <PageHeader
        title={copy.nav.idCards}
        description={copy.idCards.subtitle}
        actions={
          <Button
            onClick={() => window.print()}
            disabled={printableCards.length === 0 || !choice}
            className="idcard-screen-only"
          >
            <PrinterIcon data-slot="icon" />
            {copy.idCards.print} ({printableCards.length})
          </Button>
        }
      />

      <div className="idcard-screen-only flex flex-col gap-6">
        {/* ── Pickers ── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>{copy.idCards.chooseClass}</Label>
            <Select
              value={classId}
              onValueChange={(value) => {
                setClassId(!value || value === ALL ? "" : value);
                setSectionId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={copy.terms.class} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{copy.terms.classes}</SelectItem>
                {(classes.data ?? []).map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{copy.idCards.chooseSection}</Label>
            <Select
              value={sectionId}
              onValueChange={(value) =>
                setSectionId(!value || value === ALL ? "" : value)
              }
              disabled={!classId}
            >
              <SelectTrigger>
                <SelectValue placeholder={copy.terms.section} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{copy.idCards.allSections}</SelectItem>
                {(sections.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{copy.idCards.chooseTemplate}</Label>
            <Select
              value={choice?.rowId ?? ""}
              onValueChange={(value) => {
                const next = adopted.find((option) => option.key === value);
                if (next) setChoice(next);
              }}
              disabled={adopted.length === 0}
            >
              <SelectTrigger>
                <SelectValue>
                  {(value: string | null) =>
                    adopted.find((option) => option.key === value)?.name ??
                    copy.idCards.yourTemplatesEmpty}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {adopted.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Students ── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {copy.idCards.studentsHeading} ·{" "}
              {copy.idCards.selectedCount(selection.selected.size)}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  selection.selectMany(
                    (roster.data ?? []).map((pair) => pair.student.id),
                  )
                }
                disabled={(roster.data ?? []).length === 0}
              >
                {copy.idCards.selectAll}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={selection.clear}
                disabled={selection.selected.size === 0}
              >
                {copy.idCards.clearAll}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {roster.isLoading ? (
              <Spinner className="mt-4" />
            ) : (roster.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {copy.idCards.emptyRosterBody}
              </p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {(roster.data ?? []).map((pair) => (
                  <li key={pair.enrollment.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={selection.selected.has(pair.student.id)}
                        onCheckedChange={() =>
                          selection.toggle(pair.student.id)
                        }
                      />
                      <span className="truncate">
                        {pair.student.firstName} {pair.student.lastName}
                      </span>
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                        {pair.enrollment.rollNumber ?? pair.student.admissionNumber}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Preview ── */}
        {cards.isLoading && selection.selected.size > 0 ? (
          <Spinner className="mt-2" />
        ) : cards.error ? (
          <p className="text-destructive text-sm" role="alert">
            {copy.idCards.loadFailed} {errorMessage(cards.error)}
          </p>
        ) : selectedPairs.length === 0 ? (
          <EmptyState
            title={copy.idCards.previewHeading}
            description={copy.idCards.previewHint}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{copy.idCards.previewHeading}</h2>
            <div className="flex flex-wrap gap-4">
              {selectedPairs.map((pair) => {
                const card = cardByStudentId.get(pair.student.id);
                if (!card || !choice) return null;
                return (
                  <div key={pair.student.id} className="flex flex-col gap-1">
                    <IdCardPreview
                      template={choice.data}
                      card={card}
                      scale={1.4}
                    />
                    <span className="text-muted-foreground text-xs">
                      {card.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Templates: your rows + the starter gallery + the community gallery ── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{copy.idCards.yourTemplates}</CardTitle>
            <PermissionGate permission="id_card:manage">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewName("");
                  setNewOrientation("landscape");
                  setNewOpen(true);
                }}
              >
                {copy.idCards.newTemplate.action}
              </Button>
            </PermissionGate>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {adopted.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {copy.idCards.yourTemplatesEmpty}
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {adopted.map((option) => {
                  const row = (templates.data ?? []).find(
                    (candidate) => candidate.id === option.key,
                  );
                  return (
                    <li
                      key={option.key}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <button
                        type="button"
                        className="truncate text-left underline-offset-2 hover:underline"
                        onClick={() => setChoice(option)}
                      >
                        {option.name}
                      </button>
                      {row?.isDefault ? (
                        <Badge variant="secondary">
                          {copy.idCards.defaultBadge}
                        </Badge>
                      ) : null}
                      {row?.isPublished ? (
                        <Badge variant="outline">
                          {copy.idCards.gallery.publishedBadge}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground ml-auto text-xs">
                        {option.data.orientation === "portrait"
                          ? copy.idCards.orientationPortrait
                          : copy.idCards.orientationLandscape}
                      </span>
                      <PermissionGate permission="id_card:manage">
                        {/* Management: designer, publish switch, default.
                            No delete — hard rule 2 (templates close, never
                            vanish) and 2a shipped no destructive procedure. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            router.push(
                              `/students/id-cards/${option.key}/design`,
                            )
                          }
                        >
                          <PencilIcon data-slot="icon" />
                          {copy.idCards.designer.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={publish.isPending}
                          onClick={() =>
                            void publish.submit(
                              option.key,
                              !(row?.isPublished ?? false),
                            )
                          }
                        >
                          {row?.isPublished
                            ? copy.idCards.gallery.unpublish
                            : copy.idCards.gallery.publish}
                        </Button>
                        {!row?.isDefault ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setDefault.isPending}
                            onClick={() => void setDefault.submit(option.key)}
                          >
                            {copy.idCards.makeDefault}
                          </Button>
                        ) : null}
                      </PermissionGate>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {copy.idCards.starterGallery}
              </h3>
              <p className="text-muted-foreground text-xs">
                {copy.idCards.starterGalleryHint}
              </p>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PREBUILT_TEMPLATES.map((prebuilt) => (
                  <li key={prebuilt.id} className="flex flex-col gap-2">
                    <button
                      type="button"
                      className="rounded-md border p-2 text-left transition-colors hover:border-primary"
                      onClick={() =>
                        setChoice({
                          key: prebuilt.id,
                          prebuiltId: prebuilt.id,
                          name: prebuilt.name,
                          data: prebuilt.data,
                        })
                      }
                    >
                      <IdCardPreview template={prebuilt.data} card={null} scale={0.8} />
                      <span className="mt-2 block text-sm font-medium">
                        {prebuilt.name}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {prebuilt.description}
                      </span>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={adopt.isPending}
                      onClick={() =>
                        void adopt.submit(
                          prebuilt.id,
                          prebuilt.name,
                          prebuilt.data,
                        )
                      }
                    >
                      {copy.idCards.adopt}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            {/* ── The community gallery (2b): every org's published designs ── */}
            <PermissionGate permission="id_card:manage">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">
                  {copy.idCards.gallery.heading}
                </h3>
                <p className="text-muted-foreground text-xs">
                  {copy.idCards.gallery.hint}
                </p>
                {gallery.isLoading ? (
                  <Spinner className="mt-2" />
                ) : gallery.isError ? (
                  <p className="text-destructive text-sm" role="alert">
                    {copy.idCards.loadFailed} {errorMessage(gallery.error)}
                  </p>
                ) : (gallery.data ?? []).length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {copy.idCards.gallery.empty}
                  </p>
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(gallery.data ?? []).map((design) => (
                      <li key={design.id} className="flex flex-col gap-2">
                        <IdCardPreview
                          template={design}
                          card={null}
                          scale={0.8}
                        />
                        <span className="text-sm font-medium">{design.name}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={cloneTemplate.isPending}
                          onClick={() => {
                            setCloneName(design.name);
                            setCloneTarget({ id: design.id, name: design.name });
                          }}
                        >
                          {copy.idCards.gallery.clone}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </PermissionGate>
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-xs">{copy.idCards.printHint}</p>
      </div>

      {/* ── Build-from-blank (2b) ── */}
      <FormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title={copy.idCards.newTemplate.title}
        description={copy.idCards.newTemplate.hint}
        submitLabel={copy.idCards.newTemplate.create}
        pending={createTemplate.isPending}
        disabled={!newName.trim()}
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          void createTemplate
            .submit(name, newOrientation)
            .then((row) => {
              setNewOpen(false);
              router.push(`/students/id-cards/${row.id}/design`);
            })
            .catch(() => {
              // The mutation hook toasts the worded refusal.
            });
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-template-name">
              {copy.idCards.newTemplate.name}
            </Label>
            <Input
              id="new-template-name"
              value={newName}
              maxLength={150}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{copy.idCards.newTemplate.orientation}</Label>
            <Select
              value={newOrientation}
              onValueChange={(value) =>
                setNewOrientation(value as "landscape" | "portrait")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">
                  {copy.idCards.orientationLandscape}
                </SelectItem>
                <SelectItem value="portrait">
                  {copy.idCards.orientationPortrait}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormDialog>

      {/* ── Gallery clone (2b): rename on the way in to dodge the name index ── */}
      <FormDialog
        open={cloneTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCloneTarget(null);
        }}
        title={copy.idCards.gallery.clone}
        description={copy.idCards.gallery.hint}
        submitLabel={copy.idCards.gallery.clone}
        pending={cloneTemplate.isPending}
        disabled={!cloneName.trim()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!cloneTarget) return;
          void cloneTemplate
            .submit(cloneTarget.id, cloneName.trim())
            .then(() => setCloneTarget(null))
            .catch(() => {
              // The mutation hook toasts the worded refusal.
            });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clone-template-name">
            {copy.idCards.newTemplate.name}
          </Label>
          <Input
            id="clone-template-name"
            value={cloneName}
            maxLength={150}
            onChange={(event) => setCloneName(event.target.value)}
          />
        </div>
      </FormDialog>

      {/* ── The print sheet (print-only; chrome hides via globals.css) ── */}
      <div className="idcard-print-sheet" aria-hidden>
        {printPages.map((pageCards, pageIndex) => (
          <div key={pageIndex} className="idcard-print-page">
            <div
              className="idcard-print-grid"
              style={{
                gridTemplateColumns:
                  orientation === "portrait"
                    ? "repeat(3, 54mm)"
                    : "repeat(2, 86mm)",
              }}
            >
              {pageCards.map((card) =>
                choice ? (
                  <IdCardPreview
                    key={card.studentId}
                    template={choice.data}
                    card={card}
                    cutGuide
                  />
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const ALL = "__all__";
