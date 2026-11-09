import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  clampGap,
  clampMargin,
  GAP_DEFAULT_MM,
  MARGIN_DEFAULT_MM,
  type SheetSpacing,
} from "../screens/students/id-card-print-logic";

/**
 * The last ID-card gaps and margins used on this phone, so the office doesn't set them every time.
 * A per-phone convenience like the fees display choice (fee-prefs.ts), not a school
 * setting: the gaps change nothing the server stores.
 */
const KEY = "mskool.idCards.gaps";

export type CardGaps = SheetSpacing;

const clampAll = (next: Partial<CardGaps>): CardGaps => ({
  columnGapMm: next.columnGapMm === undefined ? GAP_DEFAULT_MM : clampGap(Number(next.columnGapMm)),
  rowGapMm: next.rowGapMm === undefined ? GAP_DEFAULT_MM : clampGap(Number(next.rowGapMm)),
  marginXMm: next.marginXMm === undefined ? MARGIN_DEFAULT_MM : clampMargin(Number(next.marginXMm)),
  marginYMm: next.marginYMm === undefined ? MARGIN_DEFAULT_MM : clampMargin(Number(next.marginYMm)),
});

let value: CardGaps = clampAll({});
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((stored) => {
      if (!stored) return;
      value = clampAll(JSON.parse(stored) as Partial<CardGaps>);
      emit();
    })
    .catch(() => {
      // Unreadable storage keeps the defaults for this session.
    });
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCardGaps(next: CardGaps) {
  value = clampAll(next);
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => undefined);
}

export function useCardGaps(): CardGaps {
  return useSyncExternalStore(subscribe, () => value);
}
