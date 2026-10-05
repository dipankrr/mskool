"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { GallerySection } from "@repo/contracts";

/**
 * Gallery grid + lightbox (ADR-041 section library). Client leaf: the only
 * state on the public page besides the nav toggle. Arrow keys and Escape
 * work; a plain grid is server-rendered for no-JS visitors.
 */
export function GalleryGrid({ content }: { content: GallerySection }) {
  const [index, setIndex] = useState<number | null>(null);

  const close = useCallback(() => setIndex(null), []);
  const step = useCallback(
    (dir: 1 | -1) =>
      setIndex((i) => (i === null ? null : (i + dir + content.images.length) % content.images.length)),
    [content.images.length],
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, close, step]);

  const current = index === null ? null : content.images[index];

  return (
    <>
      <div className="site-masonry mt-12">
        {content.images.map((img, i) => (
          <button
            key={img.url + i}
            type="button"
            onClick={() => setIndex(i)}
            className="group block w-full overflow-hidden rounded-xl"
            aria-label={`Open photo ${i + 1} of ${content.images.length}`}
          >
            <Image
              src={img.url}
              alt={img.alt}
              width={600}
              height={450}
              className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </button>
        ))}
      </div>

      {current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            className="absolute left-3 grid size-11 place-items-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:left-6"
          >
            ‹
          </button>
          {/* Plain img: the lightbox shows the full-size file, not an optimized crop. */}
          <img
            src={current.url}
            alt={current.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
          <button
            type="button"
            aria-label="Next photo"
            onClick={(e) => { e.stopPropagation(); step(1); }}
            className="absolute right-3 grid size-11 place-items-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:right-6"
          >
            ›
          </button>
          <p className="absolute bottom-5 text-sm font-semibold text-white/80">
            {index === null ? "" : `${index + 1} / ${content.images.length}`}
          </p>
        </div>
      ) : null}
    </>
  );
}
