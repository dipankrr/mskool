/** The Students tab's list logic, pure and testable. */

export type RosterView = "current" | "notPlaced" | "left" | "alumni" | "all";
export type RosterSort = "class" | "name" | "newest";

export type RosterFilters = {
  classId: string | null;
  sectionId: string | null;
  gender: "male" | "female" | "other" | null;
  admissionYear: string;
  noSection: boolean;
  noGuardian: boolean;
  noPhoto: boolean;
};

export const emptyFilters: RosterFilters = {
  classId: null,
  sectionId: null,
  gender: null,
  admissionYear: "",
  noSection: false,
  noGuardian: false,
  noPhoto: false,
};

export function activeFilterCount(filters: RosterFilters): number {
  return [
    filters.classId,
    filters.sectionId,
    filters.gender,
    filters.admissionYear.length === 4,
    filters.noSection,
    filters.noGuardian,
    filters.noPhoto,
  ].filter(Boolean).length;
}

const VIEWS: RosterView[] = ["current", "notPlaced", "left", "alumni", "all"];

/**
 * An empty tab is only noise, so Current and All always show and the rest appear
 * once they hold someone. The open tab stays, even when its last student moves.
 */
export function rosterVisibleViews(
  selected: RosterView,
  counts: Record<RosterView, number> | undefined,
): RosterView[] {
  return VIEWS.filter(
    (view) =>
      view === "current" ||
      view === "all" ||
      view === selected ||
      (counts?.[view] ?? 0) > 0,
  );
}

export type RosterItem<Row> =
  | { kind: "group"; key: string; label: string | null }
  | { kind: "student"; key: string; row: Row };

/**
 * Rows in class order get a heading each time the class or section changes. Name
 * and newest orders cut across classes, so headings would only split them up.
 */
export function rosterItems<
  Row extends { id: string; className: string | null; sectionName: string | null },
>(rows: readonly Row[], sort: RosterSort): RosterItem<Row>[] {
  const items: RosterItem<Row>[] = [];
  let previous: string | undefined;
  for (const row of rows) {
    if (sort === "class") {
      const label = row.className
        ? [row.className, row.sectionName].filter(Boolean).join(" · ")
        : null;
      const group = label ?? "";
      if (group !== previous) {
        items.push({ kind: "group", key: `group-${group}`, label });
        previous = group;
      }
    }
    items.push({ kind: "student", key: row.id, row });
  }
  return items;
}
