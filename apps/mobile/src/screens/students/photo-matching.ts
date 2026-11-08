/**
 * The photo workbench's matching logic, pure and testable. Two modes mirror
 * the web's bulk uploader: photos map to the roster in order (SECTION) or by
 * file name → admission number (REGISTER). Resizing and uploading live in
 * lib/image-upload (ADR-063).
 */

export type RosterEntry = {
  studentId: string;
  admissionNumber: string;
  name: string;
  rollNumber: string | null;
};

export type PickedPhoto = {
  localUri: string;
  fileName: string | null;
  /** Epoch millis when the photo was taken, when the platform supplies it. */
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

/** Photos in capture order: taken-time first, list position as the tiebreak. */
export function photosInCaptureOrder(photos: PickedPhoto[]): PickedPhoto[] {
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      const at = a.photo.creationTime ?? Number.MAX_SAFE_INTEGER;
      const bt = b.photo.creationTime ?? Number.MAX_SAFE_INTEGER;
      return at !== bt ? at - bt : a.index - b.index;
    })
    .map((entry) => entry.photo);
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

/** SECTION mode: capture order of the photos maps onto roll order of the roster. */
export function matchByOrder(
  photos: PickedPhoto[],
  roster: RosterEntry[],
): MatchResult {
  const ordered = photosInCaptureOrder(photos);
  const orderedRoster = rosterInMarkingOrder(roster);
  const matches: PhotoMatches = [];
  const unmatched: PickedPhoto[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const photo = ordered[index];
    const entry = orderedRoster[index];
    if (entry) {
      matches.push({ studentId: entry.studentId, photo });
    } else {
      unmatched.push(photo);
    }
  }
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
    const admission = admissionFromFileName(photo.fileName);
    const entry =
      admission !== null && !used.has(admission.toLowerCase())
        ? byAdmission.get(admission.toLowerCase())
        : undefined;
    if (entry && admission) {
      used.add(admission.toLowerCase());
      matches.push({ studentId: entry.studentId, photo });
    } else {
      unmatched.push(photo);
    }
  }
  return { matches, unmatched };
}
