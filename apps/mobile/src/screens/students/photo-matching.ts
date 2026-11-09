/**
 * The photo workbench's matching logic, pure and testable. Two modes mirror
 * the web's bulk uploader: photos map to the roster in order (SECTION) or by
 * file name → admission number (REGISTER, matched against the whole school by
 * `student.byAdmissions`). Resizing and uploading live in lib/image-upload
 * (ADR-063).
 *
 * In SECTION mode the batch's ARRAY ORDER is the one source of truth, as on
 * the web: sorting rewrites the array, moving a photo swaps it with its
 * neighbour, and students marked skipped hand their turn to the next student.
 */

export type RosterEntry = {
  studentId: string;
  admissionNumber: string;
  name: string;
  rollNumber: string | null;
};

export type PickedPhoto = {
  /** Stable within a batch: the library's asset id, else the file's uri. */
  id: string;
  localUri: string;
  fileName: string | null;
  /** Epoch millis when the photo was taken (EXIF), when the photo says. */
  creationTime: number | null;
  width: number;
  height: number;
};

/** studentId → the photo that will upload for them. */
export type PhotoMatches = { studentId: string; photo: PickedPhoto }[];

export type MatchResult = {
  matches: PhotoMatches;
  /** Photos no student claimed. */
  unmatched: PickedPhoto[];
};

export type PhotoOrder = "taken" | "name";

/**
 * EXIF dates read "2026:11:09 10:42:07" with no zone. They are compared only
 * with each other, so reading them as UTC is fine. iOS nests the tags under
 * "{Exif}"; Android puts them at the top.
 */
export function captureTimeFromExif(
  exif: Record<string, unknown> | null | undefined,
): number | null {
  if (!exif) return null;
  const nested = exif["{Exif}"] as Record<string, unknown> | undefined;
  const raw =
    exif.DateTimeOriginal ??
    nested?.DateTimeOriginal ??
    exif.DateTimeDigitized ??
    nested?.DateTimeDigitized ??
    exif.DateTime;
  if (typeof raw !== "string") return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  const millis = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Photos in capture order. The camera's EXIF time comes first. Without it,
 * the file name decides, numbers compared as numbers: camera names carry the
 * time (IMG_20261109_091200) and Android's photo picker, which hides real
 * names, hands out media ids (1000000573.jpg) that grow in the order photos
 * reached the phone. The picker's own order is the last resort — Android
 * does not keep the order photos were tapped in.
 */
export function photosInCaptureOrder(photos: PickedPhoto[]): PickedPhoto[] {
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      const at = a.photo.creationTime;
      const bt = b.photo.creationTime;
      if (at !== null && bt !== null && at !== bt) return at - bt;
      if (at !== null && bt === null) return -1;
      if (at === null && bt !== null) return 1;
      if (a.photo.fileName && b.photo.fileName) {
        const byName = a.photo.fileName.localeCompare(b.photo.fileName, undefined, {
          numeric: true,
        });
        if (byName !== 0) return byName;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.photo);
}

/** Android's photo picker hides real names behind media ids like 1000000573.jpg. */
export function looksLikeHiddenName(fileName: string | null): boolean {
  return fileName === null || /^\d{6,}\.[a-z]+$/i.test(fileName);
}

/** File-name order, numbers compared as numbers; unnamed photos keep their place last. */
export function photosInNameOrder(photos: PickedPhoto[]): PickedPhoto[] {
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      if (a.photo.fileName && b.photo.fileName) {
        const byName = a.photo.fileName.localeCompare(b.photo.fileName, undefined, {
          numeric: true,
        });
        if (byName !== 0) return byName;
      } else if (a.photo.fileName) return -1;
      else if (b.photo.fileName) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.photo);
}

export function sortPhotos(photos: PickedPhoto[], by: PhotoOrder): PickedPhoto[] {
  return by === "taken" ? photosInCaptureOrder(photos) : photosInNameOrder(photos);
}

/** Adds a new pick to the batch; a photo already in it is not added twice. */
export function mergePhotos(
  current: PickedPhoto[],
  incoming: PickedPhoto[],
): { photos: PickedPhoto[]; added: number } {
  const seen = new Set(current.map((photo) => photo.id));
  const next = [...current];
  for (const photo of incoming) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    next.push(photo);
  }
  return { photos: next, added: next.length - current.length };
}

/** Swaps a photo with its neighbour; out-of-range moves change nothing. */
export function movePhoto(
  photos: PickedPhoto[],
  photoId: string,
  delta: -1 | 1,
): PickedPhoto[] {
  const from = photos.findIndex((photo) => photo.id === photoId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= photos.length) return photos;
  const next = [...photos];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Roster in roll order: numbered rolls first, unnumbered after by name. */
export function rosterInMarkingOrder(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort((a, b) => {
    if (a.rollNumber && b.rollNumber) {
      const an = Number(a.rollNumber);
      const bn = Number(b.rollNumber);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return a.rollNumber.localeCompare(b.rollNumber);
    }
    if (a.rollNumber) return -1;
    if (b.rollNumber) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * SECTION mode: the batch, in its current order, maps onto roll order. A
 * skipped student (absent on photo day, or already has a photo) takes no
 * photo, and the next student gets it instead.
 */
export function matchByOrder(
  photos: PickedPhoto[],
  roster: RosterEntry[],
  skipped: ReadonlySet<string> = new Set(),
): MatchResult {
  const slots = rosterInMarkingOrder(roster).filter(
    (entry) => !skipped.has(entry.studentId),
  );
  const matches: PhotoMatches = [];
  const unmatched: PickedPhoto[] = [];
  photos.forEach((photo, index) => {
    const entry = slots[index];
    if (entry) matches.push({ studentId: entry.studentId, photo });
    else unmatched.push(photo);
  });
  return { matches, unmatched };
}

/**
 * REGISTER mode: the file name's stem is an admission number. Matching is
 * case-insensitive over the stem, whitespace-stripped — "IMG_0142.jpg" is
 * NOT a match unless the stem itself is the number; files without a usable
 * stem land in unmatched rather than guessing.
 */
export function admissionFromFileName(fileName: string | null): string | null {
  if (!fileName) return null;
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "");
  return stem.length > 0 ? stem : null;
}

/** The admission numbers to ask the server about, one per distinct stem. */
export function admissionsToLookUp(photos: PickedPhoto[]): string[] {
  const out = new Map<string, string>();
  for (const photo of photos) {
    const stem = admissionFromFileName(photo.fileName);
    if (stem && stem.length <= 40) out.set(stem.toLowerCase(), stem);
  }
  return [...out.values()].slice(0, 500);
}

/** Matches photos to students found by admission number; first photo per student wins. */
export function matchByAdmission(
  photos: PickedPhoto[],
  roster: RosterEntry[],
): MatchResult {
  const byAdmission = new Map(
    roster.map((entry) => [entry.admissionNumber.toLowerCase(), entry]),
  );
  const matches: PhotoMatches = [];
  const unmatched: PickedPhoto[] = [];
  const used = new Set<string>();
  for (const photo of photos) {
    const admission = admissionFromFileName(photo.fileName)?.toLowerCase();
    const entry = admission ? byAdmission.get(admission) : undefined;
    if (entry && !used.has(entry.studentId)) {
      used.add(entry.studentId);
      matches.push({ studentId: entry.studentId, photo });
    } else {
      unmatched.push(photo);
    }
  }
  return { matches, unmatched };
}

/**
 * Runs `work` over `items` with at most `limit` running at once. Each item's
 * failure is its own: the pool keeps going and never rejects.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await work(item!);
      } catch {
        // The caller records failures inside `work`.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane),
  );
}

/** Trades two photos' places; nobody else moves. */
export function swapPhotos(
  photos: PickedPhoto[],
  firstId: string,
  secondId: string,
): PickedPhoto[] {
  const a = photos.findIndex((photo) => photo.id === firstId);
  const b = photos.findIndex((photo) => photo.id === secondId);
  if (a < 0 || b < 0 || a === b) return photos;
  const next = [...photos];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

export type SectionCoverage = {
  sectionId: string;
  label: string;
  total: number;
  withPhoto: number;
};

/** Sections with the most missing photos first; complete ones last, by name. */
export function sectionsByNeed(rows: SectionCoverage[]): SectionCoverage[] {
  return [...rows].sort((a, b) => {
    const am = a.total - a.withPhoto;
    const bm = b.total - b.withPhoto;
    if (am !== bm) return bm - am;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

/** The photo-day queue: roll order, without skipped students. */
export function photoDayQueue(
  roster: RosterEntry[],
  skipped: ReadonlySet<string>,
): RosterEntry[] {
  return rosterInMarkingOrder(roster).filter((entry) => !skipped.has(entry.studentId));
}
