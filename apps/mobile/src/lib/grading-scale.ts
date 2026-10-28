import { copy } from "./copy";

/**
 * GRADING SCALES (chunk 7F) — the pure layer behind the band editor.
 *
 * The server is the referee for contiguity, but this module mirrors its rules
 * exactly so a gap is painted on the row before a save is attempted:
 *
 * - each bound is a percentage with at most two decimals (`pct100`);
 * - the lowest band starts at 0 and the highest ends at 100;
 * - neighbouring bands SHARE their edge (80–90, 90–100) — a shared edge is
 *   valid, and the upper band wins a boundary value (`exams-maths.gradeFor`);
 * - an overlap (80–95 next to 90–100) and a gap (80–90 next to 91–100) are
 *   both refused because a percentage must land in exactly one band.
 *
 * The editor works in hundredths, never floats: "90.10" × 100 is not exactly
 * 9010 in binary, and a boundary that drifts by dust would invent a gap.
 */

const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
export const MAX_PERCENT_HUNDREDTHS = 10_000;

export type BandDraft = {
  minMarks: string;
  maxMarks: string;
  gradeLabel: string;
  gradePoint: string;
  /** Carried through the editor untouched — no field exists for it (gap 42). */
  descriptor?: string | null;
};

export type BandRowLike = {
  minMarks: string;
  maxMarks: string;
  gradeLabel: string;
  gradePoint: string | null;
  descriptor?: string | null;
  sequenceNumber?: number;
};

export type ParsedBand = {
  /** Index in the draft array (what the screen paints an error on). */
  index: number;
  draft: BandDraft;
  min: number;
  max: number;
  label: string;
};

export type BandProblem = {
  /** null for a problem that belongs to the scale, not one band. */
  index: number | null;
  message: string;
};

export type BandsCheck =
  | { ok: true; bands: ParsedBand[] }
  | { ok: false; problems: BandProblem[] };

/** Exact decimal-string → integer hundredths, or null when not a percentage. */
export function hundredthsOf(value: string): number | null {
  const text = value.trim();
  if (!PCT_RE.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const hundredths =
    Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (hundredths > MAX_PERCENT_HUNDREDTHS) return null;
  return hundredths;
}

/** Hundredths → the shortest exact percentage text ("8750" → "87.5"). */
export function formatPercent(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return String(whole);
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}`;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

/** The canonical text a save sends ("090.10" → "90.1"), or the raw text. */
export function canonicalPercent(value: string): string | null {
  const hundredths = hundredthsOf(value);
  return hundredths === null ? null : formatPercent(hundredths);
}

export function bandDraftFromRow(row: BandRowLike): BandDraft {
  return {
    minMarks: formatPercent(
      hundredthsOf(row.minMarks) ?? MAX_PERCENT_HUNDREDTHS,
    ),
    maxMarks: formatPercent(
      hundredthsOf(row.maxMarks) ?? MAX_PERCENT_HUNDREDTHS,
    ),
    gradeLabel: row.gradeLabel,
    gradePoint:
      row.gradePoint === null ? "" : formatPercent(hundredthsOf(row.gradePoint) ?? 0),
    descriptor: row.descriptor ?? null,
  };
}

/**
 * Rows come back ordered by `sequenceNumber` (the card's top-down order), so
 * the editor keeps that order. A saved scale therefore reads A1, A2, B … from
 * the top, and validation sorts separately.
 */
export function bandDraftsFromRows(rows: readonly BandRowLike[]): BandDraft[] {
  return [...rows]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map(bandDraftFromRow);
}

/**
 * Judge the editor's rows with the server's rules. Per-band problems come
 * first (a malformed row cannot be placed on a number line), then duplicate
 * labels, then coverage.
 */
export function checkBands(drafts: readonly BandDraft[]): BandsCheck {
  const problems: BandProblem[] = [];

  if (drafts.length === 0) {
    return {
      ok: false,
      problems: [
        { index: null, message: copy.exams.grading.scales.problems.empty },
      ],
    };
  }

  const parsed: ParsedBand[] = [];

  drafts.forEach((draft, index) => {
    let invalid = false;
    const label = draft.gradeLabel.trim();
    if (label.length === 0) {
      problems.push({
        index,
        message: copy.exams.grading.scales.problems.gradeRequired,
      });
      invalid = true;
    } else if (label.length > 10) {
      problems.push({
        index,
        message: copy.exams.grading.scales.problems.gradeTooLong,
      });
      invalid = true;
    }

    const min = hundredthsOf(draft.minMarks);
    const max = hundredthsOf(draft.maxMarks);
    if (min === null) {
      problems.push({
        index,
        message: copy.exams.grading.scales.problems.percentFormat,
      });
      invalid = true;
    }
    if (max === null) {
      problems.push({
        index,
        message: copy.exams.grading.scales.problems.percentFormat,
      });
      invalid = true;
    }
    if (min !== null && max !== null && max < min) {
      problems.push({
        index,
        message: copy.exams.grading.scales.problems.endsBeforeStarts,
      });
      invalid = true;
    }

    const pointText = draft.gradePoint.trim();
    if (pointText.length > 0 && hundredthsOf(pointText) === null) {
      problems.push({
        index,
        message: copy.exams.grading.scales.problems.pointFormat,
      });
      invalid = true;
    }

    if (!invalid && min !== null && max !== null) {
      parsed.push({ index, draft, min, max, label });
    }
  });

  // A duplicate is a save the unique index would refuse; catch it by name.
  const seen = new Set<string>();
  for (const band of [...parsed].sort((a, b) => a.index - b.index)) {
    if (seen.has(band.label)) {
      problems.push({
        index: band.index,
        message: copy.exams.grading.scales.problems.duplicateGrade,
      });
    } else {
      seen.add(band.label);
    }
  }

  const ordered = [...parsed].sort(
    (a, b) => a.min - b.min || a.max - b.max || a.index - b.index,
  );

  /**
   * Coverage is judged only on a complete parse. Otherwise a band with no
   * grade yet drops out of `ordered` and the next check invents a second
   * problem ("bands must end at 100" because the only parsed band stops at
   * 91) — two red lines for one missing field.
   */
  if (ordered.length === drafts.length && ordered.length > 0) {
    const lowest = ordered[0]!;
    const highest = ordered[ordered.length - 1]!;
    if (lowest.min !== 0) {
      problems.push({
        index: lowest.index,
        message: copy.exams.grading.scales.problems.startsAtZero,
      });
    }
    if (highest.max !== MAX_PERCENT_HUNDREDTHS) {
      problems.push({
        index: highest.index,
        message: copy.exams.grading.scales.problems.endsAtHundred,
      });
    }

    for (let i = 1; i < ordered.length; i++) {
      const lower = ordered[i - 1]!;
      const upper = ordered[i]!;
      if (upper.min > lower.max) {
        problems.push({
          index: upper.index,
          message: gapMessage(lower.max, upper.min),
        });
      } else if (upper.min < lower.max) {
        problems.push({
          index: upper.index,
          message: overlapMessage(lower, upper),
        });
      }
      // Equal edges are the normal, valid case: the upper band owns the point.
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, bands: parsed };
}

/** The one message the footer caption shows. */
export function firstBandProblem(check: BandsCheck): string | null {
  return check.ok ? null : (check.problems[0]?.message ?? null);
}

/** The first problem painted under a given band card. */
export function bandProblem(
  check: BandsCheck,
  index: number,
): string | null {
  if (check.ok) return null;
  return check.problems.find((problem) => problem.index === index)?.message ?? null;
}

function gapMessage(from: number, to: number): string {
  // Whole-percent edges read as a school would say them: 70 → 81 is "71–80".
  if (from % 100 === 0 && to % 100 === 0) {
    const start = from / 100 + 1;
    const end = to / 100 - 1;
    if (start <= end) {
      return copy.exams.grading.scales.problems.gap(
        String(start),
        String(end),
      );
    }
  }
  return copy.exams.grading.scales.problems.gapBetween(
    formatPercent(from),
    formatPercent(to),
  );
}

function overlapMessage(lower: ParsedBand, upper: ParsedBand): string {
  const from = upper.min;
  const to = Math.min(lower.max, upper.max);
  if (from === to) {
    return copy.exams.grading.scales.problems.overlapAt(
      upper.label,
      lower.label,
      formatPercent(from),
    );
  }
  return copy.exams.grading.scales.problems.overlapRange(
    upper.label,
    lower.label,
    formatPercent(from),
    formatPercent(to),
  );
}

export type Range = { from: number; to: number };

/**
 * The covered stretches of 0–100, merged, and the holes between them. Only
 * parseable, non-inverted bands contribute — the bar is a picture, not the
 * referee.
 */
export function coverageSegments(drafts: readonly BandDraft[]): {
  segments: Range[];
  gaps: Range[];
} {
  const bands = drafts
    .map((draft) => ({
      min: hundredthsOf(draft.minMarks),
      max: hundredthsOf(draft.maxMarks),
    }))
    .filter(
      (band): band is { min: number; max: number } =>
        band.min !== null && band.max !== null && band.max >= band.min,
    )
    .sort((a, b) => a.min - b.min || a.max - b.max);

  const segments: Range[] = [];
  for (const band of bands) {
    const last = segments[segments.length - 1];
    if (!last || band.min > last.to) {
      segments.push({ from: band.min, to: band.max });
    } else {
      last.to = Math.max(last.to, band.max);
    }
  }

  const gaps: Range[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.from > cursor) {
      gaps.push({ from: cursor, to: segment.from });
    }
    cursor = Math.max(cursor, segment.to);
  }
  if (cursor < MAX_PERCENT_HUNDREDTHS) {
    gaps.push({ from: cursor, to: MAX_PERCENT_HUNDREDTHS });
  }

  return { segments, gaps };
}

/**
 * The interval "Add band" offers: the widest hole, so a two-tap add closes
 * most of the scale. Empty scale → 0–100; after 90–100 → 0–90; fully covered
 * → null (the screen replaces the action with a quiet line).
 */
export function largestUncoveredInterval(
  drafts: readonly BandDraft[],
): { minMarks: string; maxMarks: string } | null {
  const { gaps } = coverageSegments(drafts);
  if (gaps.length === 0) return null;
  const widest = [...gaps].sort(
    (a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from,
  )[0]!;
  return {
    minMarks: formatPercent(widest.from),
    maxMarks: formatPercent(widest.to),
  };
}

/**
 * Removing a band never invents a gap: its lower neighbour grows to the
 * removed band's top; the bottom band grows down when no lower neighbour
 * exists. An already-broken draft simply loses the row.
 */
export function removeBandAndExtend(
  drafts: readonly BandDraft[],
  index: number,
): BandDraft[] {
  const removed = drafts[index];
  if (!removed) return [...drafts];
  const min = hundredthsOf(removed.minMarks);
  const max = hundredthsOf(removed.maxMarks);
  const rest = drafts.filter((_, position) => position !== index);
  if (min === null || max === null) return rest;

  let donorIndex = rest.findIndex(
    (draft) => hundredthsOf(draft.maxMarks) === min,
  );
  let donorValue: "max" | "min" = "max";
  if (donorIndex === -1) {
    donorIndex = rest.findIndex(
      (draft) => hundredthsOf(draft.minMarks) === max,
    );
    donorValue = "min";
  }

  if (donorIndex === -1) return rest;
  return rest.map((draft, position) =>
    position === donorIndex
      ? donorValue === "max"
        ? { ...draft, maxMarks: formatPercent(max) }
        : { ...draft, minMarks: formatPercent(min) }
      : draft,
  );
}

/** The payload's bands: display order becomes the card order. */
export type BandPayload = {
  minMarks: string;
  maxMarks: string;
  gradeLabel: string;
  gradePoint: string | null;
  descriptor?: string;
  sequenceNumber: number;
};

export function bandsPayload(drafts: readonly BandDraft[]): BandPayload[] {
  return drafts.map((draft, index) => {
    const point = draft.gradePoint.trim();
    const descriptor = draft.descriptor?.trim();
    return {
      minMarks: canonicalPercent(draft.minMarks) ?? draft.minMarks.trim(),
      maxMarks: canonicalPercent(draft.maxMarks) ?? draft.maxMarks.trim(),
      gradeLabel: draft.gradeLabel.trim(),
      gradePoint:
        point.length > 0
          ? (canonicalPercent(point) ?? point)
          : null,
      ...(descriptor ? { descriptor } : {}),
      sequenceNumber: index,
    };
  });
}

/**
 * A stable key for "has anything changed?" — canonical numbers so typing
 * "90.0" over "90" is not a change, but every real edit is.
 */
export function bandsKey(drafts: readonly BandDraft[]): string {
  return drafts
    .map((draft) =>
      [
        canonicalPercent(draft.minMarks) ?? draft.minMarks.trim(),
        canonicalPercent(draft.maxMarks) ?? draft.maxMarks.trim(),
        draft.gradeLabel.trim(),
        canonicalPercent(draft.gradePoint) ?? draft.gradePoint.trim(),
        draft.descriptor?.trim() ?? "",
      ].join("|"),
    )
    .join("~");
}

export function bandsFromKey(rows: readonly BandRowLike[]): string {
  return bandsKey(bandDraftsFromRows(rows));
}

/** One band as the list reads it: `A1` and `90–100`. */
export type BandPhrase = { label: string; range: string };

/**
 * The row's bands, top-down. The editor sorts by `sequenceNumber`; the row
 * prints label and range as separate pieces so the list can set the grade
 * apart from its numbers — at caption size "A1 90–100" reads as "A190–100".
 */
export function bandPhrases(rows: readonly BandRowLike[]): BandPhrase[] {
  return [...rows]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map((row) => {
      const min = hundredthsOf(row.minMarks);
      const max = hundredthsOf(row.maxMarks);
      return {
        label: row.gradeLabel,
        range:
          min !== null && max !== null
            ? `${formatPercent(min)}–${formatPercent(max)}`
            : `${row.minMarks}–${row.maxMarks}`,
      };
    });
}

/** "A1 90–100 · A2 80–90 · B 70–80" — the list row's one-line band sentence. */
export function bandSentence(rows: readonly BandRowLike[]): string {
  return bandPhrases(rows)
    .map((phrase) => `${phrase.label} ${phrase.range}`)
    .join(" · ");
}

/**
 * The highest boundary two bands meet on, with the grade that owns it.
 *
 * The editor prefills a new band to the neighbouring band's start (0–91 under
 * 91–100) because the server counts an exact shared edge as contiguous and
 * refuses a one-point gap. The note under the coverage bar says which grade
 * that boundary scores as.
 */
export function sharedEdge(
  drafts: readonly BandDraft[],
): { value: string; label: string } | null {
  const parsed = drafts
    .map((draft) => ({
      min: hundredthsOf(draft.minMarks),
      max: hundredthsOf(draft.maxMarks),
      label: draft.gradeLabel.trim(),
    }))
    .filter(
      (band): band is { min: number; max: number; label: string } =>
        band.min !== null &&
        band.max !== null &&
        band.min <= band.max &&
        band.label.length > 0,
    )
    .sort((a, b) => a.min - b.min);

  for (let index = parsed.length - 1; index > 0; index--) {
    const lower = parsed[index - 1]!;
    const upper = parsed[index]!;
    if (upper.min === lower.max) {
      return { value: formatPercent(upper.min), label: upper.label };
    }
  }
  return null;
}

export type GradeHit = {
  gradeLabel: string;
  gradePoint: string | null;
};

/**
 * The score check. Mirrors `gradeFor`: descending floor order, so a shared
 * boundary belongs to the upper band (90 is an A in 80–90 / 90–100).
 */
export function resolveGrade(
  drafts: readonly BandDraft[],
  percentage: string,
): GradeHit | null {
  const value = hundredthsOf(percentage);
  if (value === null) return null;

  const ordered = drafts
    .map((draft) => ({
      draft,
      min: hundredthsOf(draft.minMarks),
      max: hundredthsOf(draft.maxMarks),
    }))
    .filter(
      (band): band is { draft: BandDraft; min: number; max: number } =>
        band.min !== null && band.max !== null && band.min <= band.max,
    )
    .sort((a, b) => b.min - a.min);

  const hit = ordered.find((band) => value >= band.min && value <= band.max);
  if (!hit) return null;
  const point = hit.draft.gradePoint.trim();
  return {
    gradeLabel: hit.draft.gradeLabel.trim(),
    gradePoint: point.length > 0 ? (canonicalPercent(point) ?? point) : null,
  };
}
