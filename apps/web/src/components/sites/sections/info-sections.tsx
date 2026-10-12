import type { FacultySection, FaqSection, GallerySection } from "@repo/contracts";
import Image from "next/image";
import { DoodleBlob, DoodleFace, DoodleSparkle } from "../decor";
import { SectionHeader } from "./core-sections";
import { GalleryGrid } from "./gallery-grid";

/**
 * info sections of the ujjwal-kids preset. Avatars sit on cycling colored
 * blobs (the reference's organic-shape motif); FAQ rows get the sticker
 * treatment when open.
 */

const BLOBS = ["#F5B301", "#2A9D8F", "#E8542F", "#155E4B"] as const;

// ── Gallery ─────────────────────────────────────────────────────────────────

export function GallerySectionView({ content }: { content: GallerySection }) {
  return (
    <section className="bg-[var(--site-surface-alt)] px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <GalleryGrid content={content} />
      </div>
    </section>
  );
}

// ── Faculty ─────────────────────────────────────────────────────────────────

export function FacultySectionView({ content }: { content: FacultySection }) {
  return (
    <section className="px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <div className="mt-14 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {content.members.map((m, i) => {
            const blob = BLOBS[i % BLOBS.length];
            return (
              <article
                key={m.name + String(i)}
                data-cpath={`members.${i}`}
                className="site-reveal group flex flex-col items-center rounded-3xl bg-white p-8 text-center shadow-[0_10px_28px_rgba(30,58,52,0.09)] transition-transform duration-300 hover:-translate-y-1.5"
              >
                <div data-cpath={`members.${i}.imageUrl`} className="relative grid size-28 place-items-center">
                  <DoodleBlob className="absolute inset-0 transition-transform duration-500 group-hover:rotate-12" color={blob} />
                  <div className="relative size-20 overflow-hidden rounded-full border-4 border-white bg-white shadow-[0_4px_14px_rgba(30,58,52,0.2)]">
                    {m.imageUrl ? (
                      <Image src={m.imageUrl} alt={m.name} width={160} height={160} className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-[var(--site-surface)]">
                        <DoodleFace className="size-10" color={blob} />
                      </span>
                    )}
                  </div>
                </div>
                <h3 data-cpath={`members.${i}.name`} className="site-heading mt-5 text-lg text-[var(--site-ink)]">{m.name}</h3>
                <p
                  data-cpath={`members.${i}.designation`}
                  className="mt-2 rounded-full px-3 py-1 text-xs font-extrabold text-white"
                  style={{ background: blob }}
                >
                  {m.designation}
                </p>
                {m.qualification ? (
                  <p data-cpath={`members.${i}.qualification`} className="mt-2.5 text-sm text-[var(--site-ink)]/60">{m.qualification}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── FAQ (native details/summary: accordion without JS) ─────────────────────

export function FaqSectionView({ content }: { content: FaqSection }) {
  return (
    <section className="bg-[var(--site-surface-alt)] px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <div className="mt-12 space-y-4">
          {content.items.map((item, i) => (
            <details
              key={`${item.question}-${i}`}
              data-cpath={`items.${i}`}
              className="group rounded-2xl border-2 border-transparent bg-white px-6 py-1 shadow-[0_4px_16px_rgba(30,58,52,0.07)] open:border-[var(--site-primary)]/20 open:bg-white open:shadow-[0_10px_30px_rgba(30,58,52,0.12)]"
            >
              <summary data-cpath={`items.${i}.question`} className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-bold text-[var(--site-ink)] marker:hidden [&::-webkit-details-marker]:hidden">
                {item.question}
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--site-surface-alt)] text-xl font-bold text-[var(--site-accent)] transition-transform duration-300 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p data-cpath={`items.${i}.answer`} className="pb-5 text-[15px] leading-relaxed text-[var(--site-ink)]/75">{item.answer}</p>
            </details>
          ))}
        </div>
        <DoodleSparkle className="mx-auto mt-10 block size-8 opacity-70" />
      </div>
    </section>
  );
}
