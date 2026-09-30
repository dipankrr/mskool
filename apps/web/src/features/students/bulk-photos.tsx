"use client";

import {
  HashIcon,
  ImagePlusIcon,
  ImagesIcon,
  ListOrderedIcon,
  FolderOpenIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { unzipSync } from "fflate";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { fileToResizedBase64 } from "@/features/students/photo-card";

/**
 * THE BULK PHOTO WORKBENCH — 300 photos without 300 page visits.
 *
 * The page is a THREE-STEP SEQUENCE, and the chrome says so (numbered
 * steps, because the workflow genuinely is one):
 *
 *   1. CHOOSE how photos are identified — by roll number (one section,
 *      order-based, no renaming) or by admission number (whole register).
 *   2. ADD the photos — drag them onto the dropzone, browse, or pick a
 *      folder/zip. Strip thumbnails can be removed and (in section mode)
 *      dragged into roll order.
 *   3. REVIEW the matches and upload — each photo renders beside the
 *      student it will be saved to; nothing is written until Confirm.
 *
 * Uploads run SEQUENTIALLY through the ordinary `student.uploadPhoto`
 * mutation — one permission check and one validated seam per photo — with
 * per-photo results and retry-failed-only, because 300 independent calls
 * always include one blip and that must be boring. Known edges, handled:
 * HEIC (Chrome cannot decode it — flagged with the camera-setting fix),
 * students without a roll number (skipped slot), duplicate admission
 * names (operator picks), zips ≤ 200MB, ≤ 500 photos.
 */

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_PHOTOS = 500;

type Mode = "section" | "register";

type LoadedPhoto = {
  id: string;
  file: File;
  name: string;
  url: string;
  /** null until decode is attempted; false = HEIC-or-worse, undecodable. */
  decodable: boolean | null;
};

type UploadPair = { studentId: string; name: string; photo: LoadedPhoto };

type UploadResult = UploadPair & { ok: boolean; error?: string };

type SlotAssignment = { photoId: string | null };

const stepBadge =
  "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground";

export function BulkPhotos() {
  const { organizationId, schoolId, activeSession, has } = useActiveContext();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<Mode>("section");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [sortMode, setSortMode] = useState<"capture" | "name">("capture");
  const [assignments, setAssignments] = useState<Record<string, SlotAssignment>>({});
  const [results, setResults] = useState<UploadResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragActive, setDragActive] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const canEdit = has("student:update");
  const classes = useClasses();
  const sections = useSections(classId || undefined);
  const sectionReady = mode === "register" || Boolean(classId && sectionId);

  // SECTION roster: enrollments for the picked class/section, roll-aware order.
  // Order mode is meaningless without a section (rolls repeat across
  // sections), so the mapping waits for both.
  const roster = trpc.enrollment.list.useQuery(
    {
      organizationId,
      academicYearId: activeSession?.id ?? "",
      ...(classId ? { classId } : {}),
      ...(sectionId ? { sectionId } : {}),
    },
    {
      enabled:
        mode === "section" &&
        Boolean(organizationId) &&
        Boolean(activeSession) &&
        Boolean(classId) &&
        Boolean(sectionId),
      staleTime: 30_000,
    },
  );

  const slots = useMemo(() => {
    if (mode !== "section") return [];
    return [...(roster.data ?? [])].sort((a, b) => {
      const roll = (r: string | null) => {
        const n = Number.parseInt(r ?? "", 10);
        return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
      };
      return roll(a.enrollment.rollNumber) - roll(b.enrollment.rollNumber);
    });
  }, [mode, roster.data]);

  const [registerRows, setRegisterRows] = useState<
    { photoId: string; studentId: string; admission: string; fullName: string; facts: string }[]
  >([]);

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter((f) => IMAGE_RE.test(f.name));
    const skipped = incoming.length - images.length;
    if (skipped > 0) toast.message(copy.bulkPhotos.nonImageSkipped(skipped));
    if (images.length === 0) return;
    setPhotos((current) => {
      const merged = [...current];
      let added = 0;
      for (const file of images) {
        if (merged.length >= MAX_PHOTOS) {
          toast.error(copy.bulkPhotos.tooMany(MAX_PHOTOS));
          break;
        }
        merged.push({
          id: `${file.name}-${file.lastModified}-${merged.length}`,
          file,
          name: file.name,
          url: URL.createObjectURL(file),
          decodable: null,
        });
        added += 1;
      }
      return merged;
    });
  }, []);

  const loadZip = useCallback(
    async (file: File) => {
      if (file.size > MAX_ZIP_BYTES) {
        toast.error(copy.bulkPhotos.zipTooBig);
        return;
      }
      try {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const files = Object.entries(entries)
          .filter(([name, bytes]) => bytes.length > 0 && IMAGE_RE.test(name))
          .map(
            ([name, bytes]) =>
              new File([bytes], name.split("/").pop() ?? name, {
                type: "application/octet-stream",
              }),
          );
        addFiles(files);
      } catch {
        toast.error(copy.bulkPhotos.zipBroken);
      }
    },
    [addFiles],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      const files: File[] = [];
      let sawZip = false;
      for (const item of event.dataTransfer.files) {
        if (/\.zip$/i.test(item.name)) sawZip = true;
        else files.push(item);
      }
      if (sawZip) {
        const zip = event.dataTransfer.files[0];
        if (zip) void loadZip(zip);
      }
      if (files.length > 0) addFiles(files);
    },
    [addFiles, loadZip],
  );

  const ensureDecoded = useCallback(async (photo: LoadedPhoto): Promise<boolean> => {
    if (photo.decodable !== null) return photo.decodable;
    try {
      const bitmap = await createImageBitmap(photo.file);
      bitmap.close();
      setPhotos((current) =>
        current.map((p) => (p.id === photo.id ? { ...p, decodable: true } : p)),
      );
      return true;
    } catch {
      setPhotos((current) =>
        current.map((p) => (p.id === photo.id ? { ...p, decodable: false } : p)),
      );
      return false;
    }
  }, []);

  const orderedPhotos = useMemo(() => {
    const sorted = [...photos];
    if (sortMode === "capture") {
      sorted.sort((a, b) => a.file.lastModified - b.file.lastModified);
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    return sorted;
  }, [photos, sortMode]);

  // Drag-to-reorder the strip (section mode only — order IS the assignment).
  const reorderPhoto = useCallback((from: number, to: number) => {
    setPhotos((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved !== undefined) {
        next.splice(to, 0, moved);
      }
      return next;
    });
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((current) => current.filter((p) => p.id !== id));
  }, []);

  const clearPhotos = useCallback(() => setPhotos([]), []);

  // The mapping: section mode assigns photo i → slot i (roll order);
  // register mode matches basename → admission number.
  useEffect(() => {
    if (mode !== "section") return;
    setAssignments(() => {
      const next: Record<string, SlotAssignment> = {};
      slots.forEach((slot, index) => {
        next[slot.student.id] = {
          photoId: orderedPhotos[index]?.id ?? null,
        };
      });
      return next;
    });
  }, [mode, slots, orderedPhotos]);

  // REGISTER match: basename → admission number, with the year's roster
  // facts for the review rows.
  const byAdmissions = trpc.student.byAdmissions.useMutation({
    onError: (error) => toast.error(errorMessage(error)),
  });

  const matchRegister = useCallback(async () => {
    const admissions = [
      ...new Set(
        photos.map((p) => p.name.replace(IMAGE_RE, "").trim().toUpperCase()),
      ),
    ];
    if (admissions.length === 0 || !activeSession) {
      setRegisterRows([]);
      return;
    }
    const rows = await byAdmissions.mutateAsync({
      organizationId,
      schoolId: schoolId ?? undefined,
      academicYearId: activeSession.id,
      admissions: admissions.slice(0, 500),
    });
    const byAdmission = new Map(rows.map((row) => [row.student.admissionNumber, row]));
    const next: typeof registerRows = [];
    const seen = new Set<string>();
    for (const photo of photos) {
      const admission = photo.name.replace(IMAGE_RE, "").trim().toUpperCase();
      const row = byAdmission.get(admission);
      if (!row || seen.has(row.student.id)) continue;
      seen.add(row.student.id);
      const where = [row.className, row.sectionName].filter(Boolean).join(" · ");
      next.push({
        photoId: photo.id,
        studentId: row.student.id,
        admission: row.student.admissionNumber,
        fullName: `${row.student.firstName} ${row.student.lastName}`,
        facts: [where, row.rollNumber ? `Roll ${row.rollNumber}` : null]
          .filter(Boolean)
          .join(" · "),
      });
    }
    setRegisterRows(next);
  }, [activeSession, byAdmissions, organizationId, photos, schoolId]);

  const upload = trpc.student.uploadPhoto.useMutation();

  const runUpload = useCallback(
    async (pairs: UploadPair[]) => {
      if (pairs.length === 0) {
        toast.error(copy.bulkPhotos.nothingToUpload);
        return;
      }
      setRunning(true);
      setProgress({ done: 0, total: pairs.length });
      const failures: UploadPair[] = [];
      let done = 0;
      for (const pair of pairs) {
        try {
          if (!(await ensureDecoded(pair.photo))) {
            throw new Error(copy.bulkPhotos.heicHint);
          }
          const base64 = await fileToResizedBase64(pair.photo.file);
          if (!base64) throw new Error(copy.bulkPhotos.resizeFailed);
          await upload.mutateAsync({
            organizationId,
            id: pair.studentId,
            data: { contentType: "image/jpeg", dataBase64: base64 },
          });
          setResults((r) => [
            ...r,
            { ...pair, ok: true },
          ]);
        } catch (error) {
          failures.push(pair);
          setResults((r) => [
            ...r,
            { ...pair, ok: false, error: errorMessage(error as never) },
          ]);
        }
        done += 1;
        setProgress({ done, total: pairs.length });
      }
      setRunning(false);
      if (failures.length === 0) {
        toast.success(copy.bulkPhotos.allUploaded(pairs.length));
      } else {
        toast.error(copy.bulkPhotos.someFailed(failures.length, pairs.length));
      }
      await utils.student.photo.invalidate();
    },
    [ensureDecoded, organizationId, upload, utils],
  );

  const matchedPairs: UploadPair[] = useMemo(() => {
    if (mode === "section") {
      const pairs: UploadPair[] = [];
      for (const slot of slots) {
        const assignment = assignments[slot.student.id];
        const photo = assignment?.photoId
          ? photos.find((p) => p.id === assignment.photoId)
          : undefined;
        if (photo) {
          pairs.push({
            studentId: slot.student.id,
            name: `${slot.student.firstName} ${slot.student.lastName}`,
            photo,
          });
        }
      }
      return pairs;
    }
    return registerRows.flatMap((row) => {
      const photo = photos.find((p) => p.id === row.photoId);
      return photo
        ? [{ studentId: row.studentId, name: row.fullName, photo }]
        : [];
    });
  }, [assignments, mode, photos, registerRows, slots]);

  const confirmUpload = useCallback(() => {
    setResults([]);
    void runUpload(matchedPairs);
  }, [matchedPairs, runUpload]);

  const retryFailed = useCallback(() => {
    const failed = results.filter((r) => !r.ok);
    setResults((r) => r.filter((x) => x.ok));
    void runUpload(
      failed.map((r) => ({ studentId: r.studentId, name: r.name, photo: r.photo })),
    );
  }, [results, runUpload]);

  if (!canEdit) {
    return (
      <p className="text-muted-foreground text-sm">{copy.bulkPhotos.noPermission}</p>
    );
  }

  const steps = [
    copy.bulkPhotos.howItWorks.step1,
    copy.bulkPhotos.howItWorks.step2,
    copy.bulkPhotos.howItWorks.step3,
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* ── How it works — a real sequence, so numbered ── */}
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className={stepBadge}>{index + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{step.title}</span>
              <span className="text-muted-foreground block text-xs">
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {/* ── Step 1: mode ── */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold">
          <span className={stepBadge}>1</span>
          {copy.bulkPhotos.mode}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("section")}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
              mode === "section"
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:border-primary/50"
            }`}
          >
            <UsersIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {copy.bulkPhotos.sectionMode}
              </span>
              <span className="text-muted-foreground block text-xs">
                {copy.bulkPhotos.sectionModeHint}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
              mode === "register"
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:border-primary/50"
            }`}
          >
            <HashIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {copy.bulkPhotos.registerMode}
              </span>
              <span className="text-muted-foreground block text-xs">
                {copy.bulkPhotos.registerModeHint}
              </span>
            </span>
          </button>
        </div>
        {mode === "section" ? (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
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
                  <SelectValue>
                    {(value: string | null) =>
                      value === ALL
                        ? copy.terms.classes
                        : (classes.data ?? []).find((cls) => cls.id === value)
                            ?.name ?? copy.terms.class}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
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
                  <SelectValue>
                    {(value: string | null) =>
                      !value || value === ALL
                        ? copy.idCards.allSections
                        : (sections.data ?? []).find((s) => s.id === value)
                            ?.name ?? copy.terms.section}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(sections.data ?? []).map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Step 2: add photos ── */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold">
          <span className={stepBadge}>2</span>
          {copy.bulkPhotos.sourceHeading}
        </h2>
        <div
          role="button"
          tabIndex={0}
          aria-label={copy.bulkPhotos.dropHere}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              filesInput.current?.click();
            }
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragActive ? "border-primary bg-primary/5" : "hover:border-primary/50"
          } ${sectionReady ? "" : "pointer-events-none opacity-50"}`}
        >
          <ImagePlusIcon className="text-muted-foreground size-8" />
          <span className="text-sm font-medium">{copy.bulkPhotos.dropHere}</span>
          <span className="text-muted-foreground text-xs">{copy.bulkPhotos.dropHint}</span>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <input
              ref={filesInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.heic,.heif"
              className="hidden"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <input
              ref={(element) => {
                folderInput.current = element;
                element?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              className="hidden"
            />
            <input
              ref={zipInput}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void loadZip(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sectionReady}
              onClick={(event) => {
                event.stopPropagation();
                filesInput.current?.click();
              }}
            >
              <ImagesIcon data-slot="icon" />
              {copy.bulkPhotos.chooseImages}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sectionReady}
              onClick={(event) => {
                event.stopPropagation();
                folderInput.current?.click();
              }}
            >
              <FolderOpenIcon data-slot="icon" />
              {copy.bulkPhotos.chooseFolder}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sectionReady}
              onClick={(event) => {
                event.stopPropagation();
                zipInput.current?.click();
              }}
            >
              {copy.bulkPhotos.chooseZip}
            </Button>
          </div>
          {!sectionReady && mode === "section" ? (
            <p className="text-muted-foreground text-xs">
              {copy.bulkPhotos.pickSectionFirst}
            </p>
          ) : null}
        </div>

        {photos.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {mode === "section" ? (
                <>
                  <span className="text-muted-foreground text-xs">
                    {copy.bulkPhotos.sortHeading}
                  </span>
                  <Button
                    variant={sortMode === "capture" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortMode("capture")}
                  >
                    <ListOrderedIcon data-slot="icon" />
                    {copy.bulkPhotos.sortCapture}
                  </Button>
                  <Button
                    variant={sortMode === "name" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortMode("name")}
                  >
                    {copy.bulkPhotos.sortName}
                  </Button>
                </>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={clearPhotos}
              >
                {copy.bulkPhotos.clearAll}
              </Button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {orderedPhotos.map((photo, index) => (
                <li
                  key={photo.id}
                  draggable={mode === "section"}
                  onDragStart={() => {
                    dragIndex.current = index;
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (
                      mode === "section" &&
                      dragIndex.current !== null &&
                      dragIndex.current !== index
                    ) {
                      reorderPhoto(dragIndex.current, index);
                      dragIndex.current = index;
                    }
                  }}
                  onDragEnd={() => {
                    dragIndex.current = null;
                  }}
                  className={`group relative w-24 overflow-hidden rounded-lg border bg-background ${
                    photo.decodable === false ? "border-destructive" : ""
                  } ${mode === "section" ? "cursor-grab active:cursor-grabbing" : ""}`}
                >
                  <img
                    src={photo.url}
                    alt={photo.name}
                    className="h-24 w-full object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`${copy.bulkPhotos.removePhoto}: ${photo.name}`}
                    className="bg-background/80 absolute top-1 right-1 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => removePhoto(photo.id)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                  <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                    {mode === "section" && sortMode === "capture"
                      ? `${index + 1}. ${photo.name}`
                      : photo.name}
                  </span>
                </li>
              ))}
            </ul>
            {photos.some((p) => p.decodable === false) ? (
              <p className="text-destructive text-xs">{copy.bulkPhotos.heicHint}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Step 3: review + upload ── */}
      {photos.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold">
            <span className={stepBadge}>3</span>
            {copy.bulkPhotos.reviewHeading}
          </h2>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={confirmUpload}
              disabled={running || matchedPairs.length === 0}
            >
              <UploadIcon data-slot="icon" />
              {running
                ? copy.bulkPhotos.uploading(progress.done, progress.total)
                : copy.bulkPhotos.confirm(matchedPairs.length)}
            </Button>
            {matchedPairs.length > 0 ? (
              <span className="text-muted-foreground pb-2.5 text-sm">
                {copy.bulkPhotos.matchedSummary(matchedPairs.length, photos.length)}
              </span>
            ) : null}
          </div>

          {running ? (
            <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{
                  width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                }}
              />
            </div>
          ) : null}

          {mode === "section" ? (
            !sectionId || roster.isLoading ? (
              roster.isLoading ? <Spinner className="m-2" /> : null
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {slots.map((slot) => {
                  const assignment = assignments[slot.student.id];
                  const photo = assignment?.photoId
                    ? photos.find((p) => p.id === assignment.photoId)
                    : undefined;
                  const roll = slot.enrollment.rollNumber ?? copy.bulkPhotos.noRoll;
                  return (
                    <li
                      key={slot.enrollment.id}
                      className={`flex items-center gap-3 rounded-lg border p-2 ${
                        photo ? "" : "opacity-60"
                      }`}
                    >
                      {photo ? (
                        <img
                          src={photo.url}
                          alt=""
                          className="h-14 w-11 rounded object-cover"
                        />
                      ) : (
                        <div className="text-muted-foreground flex h-14 w-11 items-center justify-center rounded bg-muted text-[10px]">
                          {copy.bulkPhotos.emptySlot}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {slot.student.firstName} {slot.student.lastName}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {copy.bulkPhotos.rollLabel} {roll}
                        </span>
                      </div>
                      {photo && photo.decodable === false ? (
                        <Badge variant="destructive">
                          {copy.bulkPhotos.badImage}
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={byAdmissions.isPending || photos.length === 0}
                onClick={() => void matchRegister()}
              >
                {copy.bulkPhotos.matchNow}
              </Button>
              {byAdmissions.isPending ? <Spinner className="m-2" /> : null}
              {registerRows.length > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {registerRows.map((row) => {
                    const photo = photos.find((p) => p.id === row.photoId);
                    if (!photo) return null;
                    return (
                      <li
                        key={row.photoId}
                        className="flex items-center gap-3 rounded-lg border p-2"
                      >
                        <img
                          src={photo.url}
                          alt=""
                          className="h-14 w-11 rounded object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {row.fullName}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {row.facts || row.admission}
                          </span>
                          <span className="text-muted-foreground block truncate font-mono text-[10px]">
                            {photo.name}
                          </span>
                        </div>
                        {photo.decodable === false ? (
                          <Badge variant="destructive">
                            {copy.bulkPhotos.badImage}
                          </Badge>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : !byAdmissions.isPending ? (
                <p className="text-muted-foreground text-xs">
                  {copy.bulkPhotos.registerUnmatched(photos.length)}
                </p>
              ) : null}
            </div>
          )}

          {results.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={running || results.every((r) => r.ok)}
                onClick={retryFailed}
              >
                {copy.bulkPhotos.retryFailed(results.filter((r) => !r.ok).length)}
              </Button>
              <ul className="max-h-60 overflow-y-auto text-sm">
                {results.map((r) => (
                  <li key={r.studentId} className="flex items-center gap-2 py-0.5">
                    {r.ok ? (
                      <Badge variant="secondary">{copy.bulkPhotos.ok}</Badge>
                    ) : (
                      <Badge variant="destructive">{r.error}</Badge>
                    )}
                    <span className="truncate">{r.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const ALL = "__all__";
