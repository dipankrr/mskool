import { en, type Dict } from "./en";
import { hi } from "./hi";
import { bn } from "./bn";

export const LANGS = ["en", "hi", "bn"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABEL: Record<Lang, string> = { en: "EN", hi: "हिं", bn: "বাং" };
export const PATH: Record<Lang, string> = { en: "/", hi: "/hi/", bn: "/bn/" };
export const DICTS: Record<Lang, Dict> = { en, hi, bn };
