import type { AppIconName } from "../../components/app-icon";

/**
 * More's areas (v3, `prototype/more-v3.html`): the parts of the school that
 * have no bottom tab, each a screen behind the pinned bar. One colour each,
 * used for the bar's band, the tab's icon and the screen's hero.
 */
export type AreaKey = "overview" | "exams" | "academics" | "staff" | "teaching" | "school";

export type AreaLook = {
  label: string;
  icon: AppIconName;
  /** Deep and light ends of the area's gradient. */
  h0: string;
  h1: string;
  /** The bar's band: top colour, and the colour it fades to at the tabs. */
  band: string;
  band2: string;
  /** Pale wash for tiles and icon backgrounds. */
  tint: string;
};

export const AREAS: Record<AreaKey, AreaLook> = {
  overview: { label: "Overview", icon: "dashboard", h0: "#0F7A44", h1: "#3DBE84", band: "#D3EEDF", band2: "#E3F2EA", tint: "#E6F4EC" },
  exams: { label: "Exams", icon: "exams", h0: "#C4520A", h1: "#F2934A", band: "#FFE2CA", band2: "#FCEDE1", tint: "#FFF0E3" },
  academics: { label: "Academics", icon: "stack", h0: "#5B34B8", h1: "#9C7BF0", band: "#E4DBFB", band2: "#EEE9FA", tint: "#F1ECFD" },
  staff: { label: "Staff", icon: "students", h0: "#0E6E86", h1: "#33B4CF", band: "#CFEBF2", band2: "#E2F1F5", tint: "#E3F5F8" },
  teaching: { label: "Teaching", icon: "school", h0: "#0E6E86", h1: "#33B4CF", band: "#CFEBF2", band2: "#E2F1F5", tint: "#E3F5F8" },
  school: { label: "School", icon: "branches", h0: "#1D58B8", h1: "#5B96F2", band: "#D6E4FB", band2: "#E5EDFA", tint: "#E8F1FD" },
};

/** The order the bar shows them in. */
export const AREA_ORDER: AreaKey[] = ["overview", "exams", "academics", "staff", "teaching", "school"];

/** Which areas a caller gets: each needs the read that opens it. */
export function areasFor(has: (permission: string) => boolean, teaches: boolean): AreaKey[] {
  const canStaff = has("staff:read");
  const open: Record<AreaKey, boolean> = {
    overview: true,
    exams: has("exam:read"),
    academics: has("class:read") || has("subject:read"),
    staff: canStaff,
    // A teacher's own slice of Staff; whoever sees Staff finds teaching there.
    teaching: !canStaff && (has("teacher_assignment:read") || teaches),
    school:
      (has("school:read") && (has("school:create") || has("school:update") || has("school:delete"))) ||
      (has("academic_year:read") && (has("academic_year:create") || has("academic_year:update"))),
  };
  return AREA_ORDER.filter((key) => open[key]);
}

/** "#C4520A" at 30% → "#C4520A4D", for shadows tinted with the area. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`.toUpperCase();
}
