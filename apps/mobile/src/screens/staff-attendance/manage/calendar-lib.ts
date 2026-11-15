/**
 * Calendar set-up and editing rules (ADR-069), pure so they are tested in
 * isolation: day looks, turning per-day rows into named ranges, the normal
 * week, the national holiday list and the paste import.
 */
import { colors } from "../../../theme/brand-admin";

export type DayType = "working" | "half_day" | "exam_day" | "holiday" | "weekend";
export type PatternDay = "working" | "half_day" | "weekend";

/** Index = weekday, 0 = Sunday … 6 = Saturday (server's `getUTCDay`). */
export type WeekPattern = PatternDay[];

export const DEFAULT_PATTERN: WeekPattern = [
  "weekend",
  "working",
  "working",
  "working",
  "working",
  "working",
  "half_day",
];

/** Display order of weekdays: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Exam days get their own indigo (owner, 2026-11-15). */
export const EXAM_TONE = { fg: "#3538CD", bg: "#EEF4FF" } as const;

export const DAY_LOOK: Record<DayType, { fg: string; bg: string; short: string }> = {
  working: { fg: colors.ink, bg: "transparent", short: "" },
  half_day: { fg: colors.tone.caution.fg, bg: colors.tone.caution.bg, short: "½" },
  exam_day: { fg: EXAM_TONE.fg, bg: EXAM_TONE.bg, short: "EXAM" },
  holiday: { fg: colors.tone.critical.fg, bg: colors.tone.critical.bg, short: "HOL" },
  weekend: { fg: colors.chevron, bg: "transparent", short: "OFF" },
};

export const SCHOOL_DAYS: ReadonlySet<DayType> = new Set(["working", "half_day", "exam_day"]);

export function isSchoolDay(type: DayType | null | undefined): boolean {
  return type ? SCHOOL_DAYS.has(type) : false;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function isoAdd(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let iso = from; iso <= to; iso = isoAdd(iso, 1)) out.push(iso);
  return out;
}

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function patternType(pattern: readonly PatternDay[], iso: string): PatternDay {
  return pattern[weekdayOf(iso)] ?? "weekend";
}

/** Day counts for a session laid out from the week plus the entries on top. */
export function countSession(
  pattern: readonly PatternDay[],
  from: string,
  to: string,
  overrides: ReadonlyMap<string, DayType>,
): Record<DayType, number> & { school: number } {
  const counts = { working: 0, half_day: 0, exam_day: 0, holiday: 0, weekend: 0, school: 0 };
  for (const iso of datesBetween(from, to)) {
    const type = overrides.get(iso) ?? patternType(pattern, iso);
    counts[type] += 1;
    if (isSchoolDay(type)) counts.school += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Entries: named runs of days
// ---------------------------------------------------------------------------

export type Entry = {
  key: string;
  from: string;
  to: string;
  dayType: Exclude<DayType, "working" | "weekend">;
  reason: string | null;
  /** Copied or listed festival whose date moves year to year. */
  check?: boolean;
};

/** School days inside an entry (a break over a weekend is still one entry). */
export function entryDates(entry: Pick<Entry, "from" | "to">): string[] {
  return datesBetween(entry.from, entry.to);
}

/**
 * Per-day rows → named runs, for the holiday list. A run continues across
 * days that are off anyway (a weekend inside a break). Unnamed half days are
 * the normal week's Saturdays, not entries.
 */
export function groupEntries(
  rows: readonly { date: string; dayType: DayType; reason: string | null }[],
): Entry[] {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const typeOf = new Map(sorted.map((row) => [row.date, row.dayType]));
  const out: Entry[] = [];
  for (const row of sorted) {
    if (row.dayType === "working" || row.dayType === "weekend") continue;
    if (row.dayType === "half_day" && !row.reason) continue;
    const last = out[out.length - 1];
    if (last && last.dayType === row.dayType && last.reason === row.reason) {
      const between = datesBetween(isoAdd(last.to, 1), isoAdd(row.date, -1));
      if (between.length <= 3 && between.every((iso) => typeOf.get(iso) === "weekend")) {
        last.to = row.date;
        continue;
      }
    }
    out.push({ key: row.date, from: row.date, to: row.date, dayType: row.dayType, reason: row.reason });
  }
  return out;
}

/** Days in an entry, not counting the off days it spans. */
export function entryLength(entry: Entry, typeOf?: ReadonlyMap<string, DayType>): number {
  const dates = entryDates(entry);
  if (!typeOf) return dates.length;
  return dates.filter((iso) => typeOf.get(iso) !== "weekend").length;
}

// ---------------------------------------------------------------------------
// National holidays (India)
// ---------------------------------------------------------------------------

/** Same date every year. */
const FIXED: readonly [string, string][] = [
  ["01-26", "Republic Day"],
  ["08-15", "Independence Day"],
  ["10-02", "Gandhi Jayanti"],
  ["12-25", "Christmas"],
];

/**
 * Festivals by year. Dates follow the lunar calendar and differ by state, so
 * every one is flagged for the admin to check; update this list each year.
 */
const FESTIVALS: Record<number, readonly [string, string][]> = {
  2026: [
    ["2026-05-27", "Eid al-Adha"],
    ["2026-09-04", "Janmashtami"],
    ["2026-09-14", "Ganesh Chaturthi"],
    ["2026-10-20", "Dussehra"],
    ["2026-11-08", "Diwali"],
    ["2026-11-24", "Guru Nanak Jayanti"],
  ],
  2027: [
    ["2027-03-10", "Eid al-Fitr"],
    ["2027-03-22", "Holi"],
    ["2027-03-26", "Good Friday"],
    ["2027-05-17", "Eid al-Adha"],
    ["2027-08-25", "Janmashtami"],
    ["2027-09-04", "Ganesh Chaturthi"],
    ["2027-10-09", "Dussehra"],
    ["2027-10-29", "Diwali"],
    ["2027-11-14", "Guru Nanak Jayanti"],
  ],
  2028: [
    ["2028-02-27", "Eid al-Fitr"],
    ["2028-03-11", "Holi"],
  ],
};

export function nationalHolidays(from: string, to: string): Entry[] {
  const out: Entry[] = [];
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const [md, name] of FIXED) {
      const iso = `${y}-${md}`;
      if (iso >= from && iso <= to) out.push({ key: iso, from: iso, to: iso, dayType: "holiday", reason: name });
    }
    for (const [iso, name] of FESTIVALS[y] ?? []) {
      if (iso >= from && iso <= to) {
        out.push({ key: iso, from: iso, to: iso, dayType: "holiday", reason: name, check: true });
      }
    }
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Paste import: rows copied from Excel / Sheets, CSV lines, or a .ics file
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Reads 2027-01-26, 26/01/2027, 26-1-2027, 26 Jan 2027, Jan 26 2027. */
export function parseDate(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.? (\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3)) + 1;
    return month ? valid(Number(m[3]), month, Number(m[1])) : null;
  }
  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3)) + 1;
    return month ? valid(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

function typeFromText(raw: string): Entry["dayType"] | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("exam") || t === "ex") return "exam_day";
  if (t.startsWith("half") || t === "½") return "half_day";
  if (t.startsWith("hol") || t.startsWith("off") || t.startsWith("vacation") || t.startsWith("break")) return "holiday";
  return null;
}

export type ImportResult = { entries: Entry[]; skipped: string[] };

/**
 * One entry per line: a date (or two, from and to), a name, and optionally
 * a type word (holiday / exam / half day; holiday when left out). Columns may
 * be split by tabs (pasted cells), commas or semicolons. A pasted .ics file
 * is read by its events instead.
 */
export function parseImport(text: string): ImportResult {
  if (/BEGIN:VEVENT/i.test(text)) return parseIcs(text);
  const entries: Entry[] = [];
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t|;|,(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").trim());
    const dates: string[] = [];
    const words: string[] = [];
    let type: Entry["dayType"] | null = null;
    for (const cell of cells) {
      if (!cell) continue;
      const iso = parseDate(cell);
      if (iso && dates.length < 2) dates.push(iso);
      else if (!type && typeFromText(cell) && words.length > 0) type = typeFromText(cell);
      else words.push(cell);
    }
    if (dates.length === 0 || words.length === 0) {
      skipped.push(line.trim());
      continue;
    }
    const from = dates[0]!;
    const to = dates[1] && dates[1] >= from ? dates[1] : from;
    entries.push({ key: `${from}-${entries.length}`, from, to, dayType: type ?? "holiday", reason: words.join(" ").slice(0, 255) });
  }
  return { entries, skipped };
}

function parseIcs(text: string): ImportResult {
  const entries: Entry[] = [];
  const skipped: string[] = [];
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  for (const block of unfolded.split(/BEGIN:VEVENT/i).slice(1)) {
    const field = (name: string) => new RegExp(`^${name}[^:\\n]*:(.*)$`, "im").exec(block)?.[1]?.trim() ?? "";
    const start = parseDate(field("DTSTART").slice(0, 8));
    const endRaw = parseDate(field("DTEND").slice(0, 8));
    const summary = field("SUMMARY").replace(/\\,/g, ",").replace(/\\n/g, " ");
    if (!start || !summary) {
      skipped.push(summary || "event without a date");
      continue;
    }
    // DTEND is exclusive for all-day events.
    const to = endRaw && endRaw > start ? isoAdd(endRaw, -1) : start;
    entries.push({ key: `${start}-${entries.length}`, from: start, to, dayType: typeFromText(summary) === "exam_day" ? "exam_day" : "holiday", reason: summary.slice(0, 255) });
  }
  return { entries, skipped };
}
