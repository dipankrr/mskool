/**
 * The teacher picker's ordering (ADR-068, frame 11). Pure; unit-tested.
 */

export type DirectoryPerson = {
  staffId: string;
  name: string;
  designation: string | null;
  teachesClasses: boolean;
  slots: number;
  photo?: { id: string; url: string } | null;
};

export type PickerPerson = DirectoryPerson & { busiest: boolean };

/**
 * Teaching staff only (unless `showAll`), minus people already in the slot,
 * filtered by the search, split into "already teaches this subject" and the
 * rest, each by name. "Busiest" marks a load well above the others: at
 * least 6 classes and at least 1.5× the average of everyone listed.
 */
export function orderPicker(
  people: readonly DirectoryPerson[],
  opts: { query: string; showAll: boolean; prefer: string[]; exclude: string[] },
): { groups: { title: string; people: PickerPerson[] }[]; total: number } {
  const needle = opts.query.trim().toLowerCase();
  const pool = people
    .filter((p) => opts.showAll || p.teachesClasses || p.slots > 0)
    .filter((p) => !opts.exclude.includes(p.staffId))
    .filter((p) => !needle || `${p.name} ${p.designation ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const average = pool.length ? pool.reduce((n, p) => n + p.slots, 0) / pool.length : 0;
  const mark = (p: DirectoryPerson): PickerPerson => ({
    ...p,
    busiest: p.slots >= 6 && p.slots >= average * 1.5,
  });
  const preferred = pool.filter((p) => opts.prefer.includes(p.staffId)).map(mark);
  const others = pool.filter((p) => !opts.prefer.includes(p.staffId)).map(mark);
  return {
    groups: [
      { title: "Teaches this subject", people: preferred },
      { title: preferred.length ? `Other teachers · ${others.length}` : `Teachers · ${others.length}`, people: others },
    ],
    total: pool.length,
  };
}
