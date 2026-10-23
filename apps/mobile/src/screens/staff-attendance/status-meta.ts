/**
 * The five markable statuses' vocabulary and colour, in one place: the
 * sheet's order, the labels and the tone mapping. Tones are information —
 * present wears the app's own emerald, absent the semantic red, late amber,
 * on leave slate. Half day shares amber with late: the approved palette has
 * no fifth hue, and the label, not the tint, names the value.
 */

import { copy } from "../../lib/copy";
import type { Tone } from "../../theme/brand-admin";
import type { Status } from "./draft";

/** Day types the marking gate accepts (the service enforces the same set). */
export const MARKABLE_DAY_TYPES: readonly string[] = [
  "working",
  "half_day",
  "exam_day",
];

/** The long-press sheet's fixed order (probe anatomy). */
export const SHEET_ORDER: readonly Status[] = [
  "present",
  "late",
  "half_day",
  "absent",
  "on_leave",
];

export function statusLabel(status: Status): string {
  return copy.attendance.marking.statuses[status];
}

export function statusDescription(status: Status): string {
  return copy.attendance.marking.statusDescriptions[status];
}

export function statusShort(status: Status): string {
  return copy.attendance.marking.statusShort[status];
}

/**
 * The day-type vocabulary for the calendar surfaces (chunk 3): DB value in,
 * word out. An unknown value falls back to itself rather than "Not set" —
 * a server that learns a new type shows its own word, not a lie.
 */
export function dayTypeLabel(dayType: string | null): string {
  if (!dayType) return copy.attendance.marking.dayTypes.none;
  const labels = copy.attendance.marking.dayTypes as Record<string, string>;
  return labels[dayType] ?? dayType;
}

/**
 * The two-to-three character label inside a day-picker cell. It replaces the
 * old 4 px status dot: the tinted square carries the category, the label
 * carries it again in words a thumb can read at arm's length.
 */
export function dayTypeShort(dayType: string | null): string {
  if (dayType === "half_day") return "½";
  if (dayType === "exam_day") return "EX";
  if (dayType === "holiday") return "HOL";
  if (dayType === "weekend") return "OFF";
  if (dayType === "working") return "";
  return "—";
}

/** True when the marking gate accepts this day type (the same set, one place). */
export function isMarkableDayType(dayType: string | null): boolean {
  return dayType !== null && MARKABLE_DAY_TYPES.includes(dayType);
}

export const statusTone: Record<Status, Tone> = {
  present: "positive",
  absent: "critical",
  late: "caution",
  half_day: "caution",
  on_leave: "neutral",
};
