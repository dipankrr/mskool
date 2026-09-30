"use client";

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
 * Two modes, one review grid:
 *   - SECTION: pick class + section, then dump the photographer's folder in.
 *     NO renaming — photos sort into the section's roll order (capture time
 *     by default, filename or manual drag to correct), photo i → roll i.
 *   - REGISTER: filenames are ADMISSION NUMBERS; the browser matches them
 *     against `student.byAdmissions` (school-clipped, active only).
 *
 * Nothing uploads until Confirm. Every assignment is a row the operator
 * eyeballs — order-based mapping is a human-checked pass, not a guess.
 * Uploads then run SEQUENTIALLY through the ordinary `student.uploadPhoto`
 * mutation — one photo, one permission check, one validated seam each —
 * with per-photo results and retry-failed, because 300 independent calls
 * will always include one blip and that must be boring.
 *
 * Known edges, handled: HEIC (Chrome cannot decode it — the file is flagged
 * with the camera-setting fix, never silently dropped), students without a
 * roll number (skipped slot, assignable later one-by-one), duplicate names
 * in register mode (conflict, operator picks), zips ≤ 200MB, images ≤ 500.
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

type SlotAssignment = {
  /** photo id assigned to this slot, or null. */
  photoId: string | null;
};

export function BulkPhotos() {
  const { organizationId, schoolId, activeSession, has } = useActiveContext();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<Mode>("section");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [sortMode, setSortMode] = useState<"capture" | "name">("capture");
  const [assignments, setAssignments] = useState<Record<string, SlotAssignment>>({});
  const [results, setResults] = useState<
    {
      studentId: string;
      name: string;
      ok: boolean;
      error?: string;
      photo: LoadedPhoto;
    }[]
  >([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const canEdit = has("student:update");
  const classes = useClasses();
  const sections = useSections(classId || undefined);

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

  // REGISTER match: run once per photo batch.
  const byAdmissions = trpc.student.byAdmissions.useMutation({
    onError: (error) => toast.error(errorMessage(error)),
  });
  const [registerMatches, setRegisterMatches] = useState<
    Map<string, { studentId: string; name: string }>
  >(new Map());

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const images = incoming.filter((f) => IMAGE_RE.test(f.name));
      const skipped = incoming.length - images.length;
      if (skipped > 0) {
        toast.message(copy.bulkPhotos.nonImageSkipped(skipped));
      }
      setPhotos((current) => {
        const merged = [...current];
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
        }
        return merged;
      });
    },
    [],
  );

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
        await addFiles(files);
      } catch {
        toast.error(copy.bulkPhotos.zipBroken);
      }
    },
    [addFiles],
  );

  // Decode check happens lazily per photo (used by the preview + upload).
  const ensureDecoded = useCallback(
    async (photo: LoadedPhoto): Promise<boolean> => {
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
    },
    [],
  );

  const orderedPhotos = useMemo(() => {
    const sorted = [...photos];
    if (sortMode === "capture") {
      sorted.sort((a, b) => a.file.lastModified - b.file.lastModified);
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    return sorted;
  }, [photos, sortMode]);

  // The mapping: section mode assigns photo i → slot i (roll order);
  // register mode matches basename → admission number.
  useEffect(() => {
    if (mode === "section") {
      setAssignments(() => {
        const next: Record<string, SlotAssignment> = {};
        slots.forEach((slot, index) => {
          next[slot.student.id] = {
            photoId: orderedPhotos[index]?.id ?? null,
          };
        });
        return next;
      });
      return;
    }
    // register mode: match on confirm-match button, not per keystroke.
  }, [mode, slots, orderedPhotos]);

  const matchRegister = useCallback(async () => {
    const admissions = [
      ...new Set(
        photos.map((p) =>
          p.name.replace(IMAGE_RE, "").trim().toUpperCase(),
        ),
      ),
    ];
    if (admissions.length === 0) {
      setRegisterMatches(new Map());
      return;
    }
    const students = await byAdmissions.mutateAsync({
      organizationId,
      schoolId: schoolId ?? undefined,
      admissions: admissions.slice(0, 500),
    });
    const map = new Map<string, { studentId: string; name: string }>();
    const seen = new Set<string>();
    for (const photo of photos) {
      const admission = photo.name.replace(IMAGE_RE, "").trim().toUpperCase();
      const student = students.find((s) => s.admissionNumber === admission);
      if (!student || seen.has(student.id)) continue;
      seen.add(student.id);
      map.set(photo.id, { studentId: student.id, name: student.admissionNumber });
    }
    setRegisterMatches(map);
  }, [byAdmissions, organizationId, schoolId, photos]);

  const upload = trpc.student.uploadPhoto.useMutation();

  /** The runner: sequential decode → resize → upload, per-photo results.
   * Retry passes ONLY the failed pairs, so a blip re-uploads 4 photos, not
   * 300. */
  const runUpload = useCallback(
    async (pairs: { studentId: string; name: string; photo: LoadedPhoto }[]) => {
      if (pairs.length === 0) {
        toast.error(copy.bulkPhotos.nothingToUpload);
        return;
      }
      setRunning(true);
      setProgress({ done: 0, total: pairs.length });
      const failures: typeof pairs = [];
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
            { studentId: pair.studentId, name: pair.name, ok: true, photo: pair.photo },
          ]);
        } catch (error) {
          failures.push(pair);
          setResults((r) => [
            ...r,
            {
              studentId: pair.studentId,
              name: pair.name,
              ok: false,
              error: errorMessage(error as never),
              photo: pair.photo,
            },
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

  const confirmUpload = useCallback(async () => {
    const pairs: { studentId: string; name: string; photo: LoadedPhoto }[] = [];
    if (mode === "section") {
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
    } else {
      for (const photo of photos) {
        const match = registerMatches.get(photo.id);
        if (match) {
          pairs.push({ studentId: match.studentId, name: match.name, photo });
        }
      }
    }
    setResults([]);
    await runUpload(pairs);
  }, [mode, assignments, slots, photos, registerMatches, runUpload]);

  const retryFailed = useCallback(async () => {
    const failed = results
      .filter((r) => !r.ok)
      .map((r) => ({ studentId: r.studentId, name: r.name, photo: r.photo }));
    setResults((r) => r.filter((x) => x.ok));
    await runUpload(failed);
  }, [results, runUpload]);

  if (!canEdit) {
    return <p className="text-muted-foreground text-sm">{copy.bulkPhotos.noPermission}</p>;
  }

  const decodable = (p: LoadedPhoto) => p.decodable !== false;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Mode ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{copy.bulkPhotos.mode}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("section")}
            className={`rounded-xl border p-4 text-left transition-colors ${
              mode === "section" ? "border-primary bg-primary/5" : "hover:border-primary"
            }`}
          >
            <span className="block text-sm font-semibold">
              {copy.bulkPhotos.sectionMode}
            </span>
            <span className="text-muted-foreground block text-xs">
              {copy.bulkPhotos.sectionModeHint}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`rounded-xl border p-4 text-left transition-colors ${
              mode === "register" ? "border-primary bg-primary/5" : "hover:border-primary"
            }`}
          >
            <span className="block text-sm font-semibold">
              {copy.bulkPhotos.registerMode}
            </span>
            <span className="text-muted-foreground block text-xs">
              {copy.bulkPhotos.registerModeHint}
            </span>
          </button>
        </CardContent>
      </Card>

      {/* ── Photo source ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{copy.bulkPhotos.sourceHeading}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mode === "section" ? (
            <div className="grid grid-cols-2 gap-3">
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
                    <SelectItem value={ALL}>{copy.idCards.allSections}</SelectItem>
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

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={filesInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.heic,.heif"
              className="hidden"
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => filesInput.current?.click()}>
              {copy.bulkPhotos.chooseImages}
            </Button>
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
            <Button variant="outline" size="sm" onClick={() => zipInput.current?.click()}>
              {copy.bulkPhotos.chooseZip}
            </Button>
            <span className="text-muted-foreground text-xs">
              {mode === "section"
                ? copy.bulkPhotos.sectionSourceHint
                : copy.bulkPhotos.registerSourceHint}
            </span>
          </div>

          {photos.length > 0 ? (
            <div className="flex flex-col gap-2">
              {mode === "section" ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {copy.bulkPhotos.sortHeading}
                  </span>
                  <Button
                    variant={sortMode === "capture" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortMode("capture")}
                  >
                    {copy.bulkPhotos.sortCapture}
                  </Button>
                  <Button
                    variant={sortMode === "name" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortMode("name")}
                  >
                    {copy.bulkPhotos.sortName}
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {orderedPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className={`w-20 overflow-hidden rounded-md border ${
                      decodable(photo) ? "" : "border-destructive"
                    }`}
                  >
                    <img src={photo.url} alt={photo.name} className="h-20 w-20 object-cover" />
                    <span className="block truncate px-1 py-0.5 text-[10px] text-muted-foreground">
                      {photo.name}
                    </span>
                  </div>
                ))}
              </div>
              {photos.some((p) => p.decodable === false) ? (
                <p className="text-destructive text-xs">{copy.bulkPhotos.heicHint}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── The review grid ── */}
      {photos.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{copy.bulkPhotos.reviewHeading}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {mode === "section" ? (
              !sectionId ? (
                <p className="text-muted-foreground text-sm">
                  {copy.bulkPhotos.pickSection}
                </p>
              ) : roster.isLoading ? (
                <Spinner className="m-2" />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {slots.map((slot) => {
                    const assignment = assignments[slot.student.id];
                    const photo = assignment?.photoId
                      ? photos.find((p) => p.id === assignment.photoId)
                      : undefined;
                    const roll =
                      slot.enrollment.rollNumber ?? copy.bulkPhotos.noRoll;
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
                          <div className="flex h-14 w-11 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                            {copy.bulkPhotos.emptySlot}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {slot.student.firstName} {slot.student.lastName}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {copy.bulkPhotos.rollLabel} {roll}
                          </span>
                        </div>
                        {photo && !decodable(photo) ? (
                          <Badge variant="destructive">{copy.bulkPhotos.badImage}</Badge>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <div className="flex flex-col gap-2">
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
                {registerMatches.size > 0 ? (
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {photos
                      .filter((p) => registerMatches.has(p.id))
                      .map((photo) => {
                        const match = registerMatches.get(photo.id)!;
                        return (
                          <li
                            key={photo.id}
                            className="flex items-center gap-3 rounded-lg border p-2"
                          >
                            <img
                              src={photo.url}
                              alt=""
                              className="h-14 w-11 rounded object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {match.name}
                              </span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {photo.name}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                ) : null}
                {photos.length > 0 && !byAdmissions.isPending ? (
                  <p className="text-muted-foreground text-xs">
                    {copy.bulkPhotos.registerUnmatched(
                      photos.length - registerMatches.size,
                    )}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Confirm + results ── */}
      {photos.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void confirmUpload()}
                disabled={running || photos.length === 0}
              >
                {running
                  ? copy.bulkPhotos.uploading(progress.done, progress.total)
                  : copy.bulkPhotos.confirm}
              </Button>
              {running ? (
                <span className="text-muted-foreground text-sm">
                  {progress.done} / {progress.total}
                </span>
              ) : null}
            </div>
            {results.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={running || results.every((r) => r.ok)}
                  onClick={() => void retryFailed()}
                >
                  {copy.bulkPhotos.retryFailed(
                    results.filter((r) => !r.ok).length,
                  )}
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const ALL = "__all__";
