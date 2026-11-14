/**
 * Pure helpers for the staff screens (ADR-068). Unit-tested.
 */

/** "Kavita Iyer" → first "Kavita", last "Iyer"; the last word is the surname. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { firstName: words[0] ?? "", lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words.at(-1)! };
}

/**
 * Whether a designation reads like a teacher, so "Teaches classes" can switch
 * itself on. Free text, so this is a hint, never a rule.
 */
export function looksLikeTeacher(designation: string): boolean {
  return /\b(prt|tgt|pgt|teacher|lecturer|faculty|tutor|instructor|coach)\b/i.test(designation);
}

/** Today in India, as YYYY-MM-DD. */
export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
