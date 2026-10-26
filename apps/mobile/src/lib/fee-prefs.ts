import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether "Collected" counts late fees (gap 13). Schools read it both ways:
 * fees only (what the bills were paid down by) or all cash received. It is a
 * per-device display choice, not a school setting — it changes no amount the
 * server stores, only which of two server totals a screen shows — so it lives
 * in AsyncStorage beside the active-branch keys.
 *
 * One module-level value with listeners, so flipping the switch on the setup
 * screen updates every mounted screen at once.
 */
const KEY = "mskool.fees.collectedIncludesLateFees";
const DEFAULT = true;

let value = DEFAULT;
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
      if (stored === null) return;
      value = stored === "true";
      emit();
    })
    .catch(() => {
      // Unreadable storage keeps the default; the switch still works for
      // this session.
    });
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCollectedIncludesLateFees(next: boolean) {
  value = next;
  emit();
  void AsyncStorage.setItem(KEY, String(next)).catch(() => undefined);
}

export function useCollectedIncludesLateFees(): boolean {
  return useSyncExternalStore(subscribe, () => value);
}
