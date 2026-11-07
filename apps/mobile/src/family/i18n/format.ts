import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { formatMoney } from "../../lib/money";

/**
 * Every number, date and amount a family screen shows. Month and weekday
 * names come from the language files, not `Intl` (Hermes' ICU data varies by
 * build; the same rule as `lib/format.ts`), so a new language translates them
 * like any other string. Digits stay Latin, as Indian apps commonly do.
 *
 * Calendar dates are sliced from the ISO string and never parsed with
 * `new Date(iso)`, which reads them as UTC midnight.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const CLOCK = /^(\d{1,2}):(\d{2})/;

type MonthNumber = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";
type WeekdayNumber = "0" | "1" | "2" | "3" | "4" | "5" | "6";

export type DateStyle = "dayMonth" | "dayMonthYear" | "weekdayDayMonth";

function parts(iso: string) {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function weekdayOf(year: number, month: number, day: number): WeekdayNumber {
  // Local parts: no timezone shift is possible here.
  return String(new Date(year, month - 1, day).getDay()) as WeekdayNumber;
}

export function createFormat(t: TFunction) {
  const monthShort = (month: number) => t(`monthShort.${String(month) as MonthNumber}`);
  const monthLong = (month: number) => t(`monthLong.${String(month) as MonthNumber}`);

  return {
    /** `"15 Oct"`, `"15 Oct 2026"`, `"Wed, 15 Oct"`; `"—"` for no date. */
    date(iso: string | null | undefined, style: DateStyle = "dayMonth"): string {
      const p = iso ? parts(iso) : null;
      if (!p) return "—";
      const weekday = t(`weekdayShort.${weekdayOf(p.year, p.month, p.day)}`);
      return t(`date.${style}`, {
        day: p.day,
        month: monthShort(p.month),
        year: p.year,
        weekday,
      });
    },

    /** The day of the month, `"7"`, for calendar cells. */
    day(iso: string): string {
      const p = parts(iso);
      return p ? String(p.day) : "—";
    },

    /** `"Wednesday"` for a date. */
    weekdayLong(iso: string): string {
      const p = parts(iso);
      if (!p) return "—";
      return t(`weekdayLong.${weekdayOf(p.year, p.month, p.day)}`);
    },

    /** `"15 Oct – 22 Oct"`. */
    dateRange(from: string | null | undefined, to: string | null | undefined): string {
      if (!from && !to) return "—";
      if (!to || from === to) return this.date(from);
      if (!from) return this.date(to);
      return t("date.range", { from: this.date(from), to: this.date(to) });
    },

    /** A month key `"2026-04"` or a date: `"April 2026"`, or `"Apr"` short. */
    month(value: string, style: "long" | "short" | "longWithYear" = "longWithYear"): string {
      const key = MONTH_KEY.exec(value) ?? ISO_DATE.exec(value);
      if (!key) return value;
      const year = Number(key[1]);
      const month = Number(key[2]);
      if (style === "short") return monthShort(month);
      if (style === "long") return monthLong(month);
      return t("date.monthYear", { month: monthLong(month), year });
    },

    /** `"09:30:00"` → `"9:30 AM"`. */
    time(clock: string | null | undefined): string {
      const match = clock ? CLOCK.exec(clock) : null;
      if (!match) return "—";
      const hours = Number(match[1]);
      const period = hours >= 12 ? t("time.pm") : t("time.am");
      const hour = hours % 12 === 0 ? 12 : hours % 12;
      return t("time.clock", { hour, minute: match[2], period });
    },

    /** `90` → `"1 hr 30 min"`. */
    duration(minutes: number): string {
      if (minutes < 60) return t("duration.minutes", { count: minutes });
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      if (rest === 0) return t("duration.hours", { count: hours });
      return t("duration.hoursMinutes", { hours, minutes: rest });
    },

    /** `86.4` → `"86.4%"`; whole values drop the decimal. */
    percent(value: number | string | null | undefined, digits = 1): string {
      const n = typeof value === "string" ? Number(value) : value;
      if (n === null || n === undefined || !Number.isFinite(n)) return "—";
      const fixed = n.toFixed(digits);
      const trimmed = fixed.replace(/\.0+$/, "");
      return t("percent", { value: trimmed });
    },

    /** Marks as stored ("80.00") → "80"; halves keep their decimal ("12.5"). */
    marks(value: string | number): string {
      const n = typeof value === "string" ? Number(value) : value;
      if (!Number.isFinite(n)) return "—";
      return String(Math.round(n * 100) / 100);
    },

    /** Wire money (`"12500.00"`) → `"₹12,500"`, Indian grouping. */
    money(value: string | null | undefined): string {
      return formatMoney(value);
    },
  };
}

export type Format = ReturnType<typeof createFormat>;

/** The formatters for the current language; re-renders on a language change. */
export function useFormat(): Format {
  const { t, i18n } = useTranslation();
  // The language is the dependency: a change must rebuild the formatters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createFormat(t), [t, i18n.language]);
}
