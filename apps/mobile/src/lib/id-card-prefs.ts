import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { clampGap, GAP_DEFAULT_MM } from "../screens/students/id-card-print-logic";

/**
 * The last ID-card gaps used on this phone, so the office doesn't set them every time.
 * A per-phone convenience like the fees display choice (fee-prefs.ts), not a school
 * setting: the gaps change nothing the server stores.
 */
const KEY = "mskool.idCards.gaps";

export type CardGaps = { columnGapMm: number; rowGapMm: number };

let value: CardGaps = { columnGapMm: GAP_DEFAULT_MM, rowGapMm: GAP_DEFAULT_MM };
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
      const parsed = JSON.parse(stored) as Partial<CardGaps>;
      value = {
        columnGapMm: clampGap(Number(parsed.columnGapMm)),
        rowGapMm: clampGap(Number(parsed.rowGapMm)),
      };
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
  value = { columnGapMm: clampGap(next.columnGapMm), rowGapMm: clampGap(next.rowGapMm) };
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => undefined);
}

export function useCardGaps(): CardGaps {
  return useSyncExternalStore(subscribe, () => value);
}
