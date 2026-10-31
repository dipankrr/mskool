/**
 * The Class & Section screen's rules, kept out of the screen so they can be
 * tested: what to prefill when adding, and which classes still have no section.
 */

/** Numeric order is limited to this range by the class contract. */
const MAX_CLASS_ORDER = 20;

/**
 * The next letter after the class's sections: A, B → C. Names that aren't a
 * single letter ("Rose") are ignored, and the field stays editable anyway.
 */
export function nextSectionName(existing: readonly string[]): string {
  const letters = existing
    .map((name) => name.trim().toUpperCase())
    .filter((name) => /^[A-Z]$/.test(name))
    .map((name) => name.charCodeAt(0));
  if (letters.length === 0) return existing.length === 0 ? "A" : "";
  const next = Math.max(...letters) + 1;
  return next > "Z".charCodeAt(0) ? "" : String.fromCharCode(next);
}

/** The order after the highest in use, so a new class lands at the end. */
export function nextClassOrder(existing: readonly number[]): string {
  if (existing.length === 0) return "1";
  return String(Math.min(Math.max(...existing) + 1, MAX_CLASS_ORDER));
}

/** Sections by class id. Every class gets an entry, so a gap reads as empty. */
export function sectionsByClass<S extends { classId: string }>(
  classIds: readonly string[],
  sections: readonly S[],
): Map<string, S[]> {
  const grouped = new Map<string, S[]>(classIds.map((id) => [id, []]));
  for (const section of sections) grouped.get(section.classId)?.push(section);
  return grouped;
}

/** How many classes have no section yet. */
export function classesWithoutSection<S>(grouped: ReadonlyMap<string, readonly S[]>): number {
  let count = 0;
  for (const list of grouped.values()) if (list.length === 0) count += 1;
  return count;
}
