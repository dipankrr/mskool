import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";

import attendance from "./en/attendance.json";
import auth from "./en/auth.json";
import common from "./en/common.json";
import exams from "./en/exams.json";
import family from "./en/family.json";
import fees from "./en/fees.json";
import homework from "./en/homework.json";
import kit from "./en/kit.json";

/**
 * The family side's languages. English only today; Indian languages are
 * coming. Adding one is: a folder of JSON files next to `en/`, one entry in
 * `LANGUAGES`, and its script's font in `theme/palette.ts`. No screen changes.
 *
 * Rules for every family screen (also in `docs` plan section 5):
 * - text comes from `t("ns:key")`, never a literal (lint-enforced);
 * - whole sentences with named values (`{{count}}`), plurals via `_one` /
 *   `_other`, never string concatenation, since word order differs;
 * - dates, months, times, durations, money and percentages go through
 *   `useFormat()` (`./format.ts`), never hand-formatted;
 * - school-typed text (subject, fee head, exam and holiday names) is shown as
 *   it arrives.
 */

/** `script` picks the font family and line height in the theme. */
export const LANGUAGES = [{ code: "en", name: "English", script: "latin" }] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type Script = (typeof LANGUAGES)[number]["script"];

export const resources = {
  en: { common, auth, family, attendance, fees, exams, homework, kit },
} as const;

export const defaultNS = "common";
export const namespaces = Object.keys(resources.en) as (keyof (typeof resources)["en"])[];

const STORAGE_KEY = "family.language";

function isSupported(code: string | null | undefined): code is LanguageCode {
  return LANGUAGES.some((language) => language.code === code);
}

/**
 * The phone's first language we support, else English. Loaded lazily and
 * guarded: an app build without the native module (an older dev build)
 * falls back to English instead of failing every family screen.
 */
function deviceLanguage(): LanguageCode {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocales } = require("expo-localization") as typeof import("expo-localization");
    for (const locale of getLocales()) {
      if (isSupported(locale.languageCode)) return locale.languageCode;
    }
  } catch {
    // Native module missing: English.
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: "en",
  ns: namespaces,
  defaultNS,
  interpolation: { escapeValue: false },
  returnNull: false,
  // Resources are bundled, so init is synchronous: the first render already
  // has its strings.
  initAsync: false,
});

/**
 * The in-app choice wins over the phone's language: one family phone is
 * shared by several readers. Called once when the family shell mounts.
 */
export async function loadSavedLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isSupported(saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // Storage unavailable: keep the device language.
  }
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, code);
  } catch {
    // The change still applies for this run.
  }
}

/** The current language's script, for fonts and line height. */
export function currentScript(language: string = i18n.language): Script {
  return LANGUAGES.find((entry) => entry.code === language)?.script ?? "latin";
}

export { i18n };
