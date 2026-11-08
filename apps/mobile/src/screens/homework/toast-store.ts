import { useSyncExternalStore } from "react";

/**
 * What Give hands back to Home for the toast. A tiny in-memory store rather
 * than route params: returning to a tab that is already mounted drops params
 * passed through `dismissTo` (found on the 2026-11-08 device walk).
 */
export type GivenToastData = {
  id: string;
  labels: string;
  draft: boolean;
  /** The pair Undo's subject gate needs, known at Give time. */
  sectionId: string;
  subjectId: string;
};

let current: GivenToastData | null = null;
const listeners = new Set<() => void>();

export function showGivenToast(data: GivenToastData | null): void {
  current = data;
  for (const l of listeners) l();
}

export function useGivenToast(): GivenToastData | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
