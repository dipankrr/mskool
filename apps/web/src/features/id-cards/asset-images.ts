"use client";

import { useSyncExternalStore } from "react";

import type { ImageRef } from "@repo/contracts";

/**
 * WHERE A TEMPLATE'S IMAGES LIVE (ADR-063). A design names its backgrounds
 * and logos by asset id; the template reads (`list`, `byId`) and a freshly
 * completed upload carry those ids' ready-made links. This small store keeps
 * the latest link per id, so every card renderer can show an asset without
 * threading links through props. A link changes every few hours, the file
 * behind an id never does, so a newer link simply replaces an older one.
 */

const urls = new Map<string, string>();
const listeners = new Set<() => void>();

export function rememberImages(images: Record<string, ImageRef> | ImageRef[]) {
  const list = Array.isArray(images) ? images : Object.values(images);
  let changed = false;
  for (const image of list) {
    if (urls.get(image.id) !== image.url) {
      urls.set(image.id, image.url);
      changed = true;
    }
  }
  if (changed) for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The asset's link, or null while it is unknown (an empty slot, never broken). */
export function useAssetUrl(assetId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (assetId ? (urls.get(assetId) ?? null) : null),
    () => null,
  );
}
