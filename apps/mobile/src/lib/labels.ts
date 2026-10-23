/**
 * Human words for the enum values the server sends. Labels only: no screen
 * decides anything from a role or a scope name — permissions are the gate
 * (ADR-044), and these strings are what a person reads.
 */

/** `class_teacher` → "Class teacher"; already-capitalised input is left alone. */
export function roleLabel(value: string): string {
  const words = value.replaceAll("_", " ").trim();
  return words.length === 0
    ? words
    : words.charAt(0).toUpperCase() + words.slice(1);
}

const SCOPE_LABELS: Record<string, string> = {
  org: "Organization",
  school: "Branch",
  class: "Class",
  section: "Section",
};

/** `school` → "Branch" — the word the rest of the app uses for a school. */
export function scopeLabel(value: string): string {
  return SCOPE_LABELS[value] ?? roleLabel(value);
}
