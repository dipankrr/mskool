import type { FacultySection, FaqSection, GallerySection } from "@repo/contracts";
import Image from "next/image";
import { SectionHeader } from "./core-sections";
import { GalleryGrid } from "./gallery-grid";

// ── Gallery ─────────────────────────────────────────────────────────────────

export function GallerySectionView({ content }: { content: GallerySection }) {
  return (
    <section className="bg-[var(--site-surface-alt)] px-4 py-20 sm:py-24">
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
    <section className="px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {content.members.map((m, i) => (
            <article
              key={m.name + String(i)}
              className="site-reveal flex flex-col items-center rounded-2xl bg-white p-7 text-center shadow-[0_2px_14px_rgba(30,58,52,0.08)] transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="relative size-24 overflow-hidden rounded-full border-4 border-[var(--site-surface-alt)] bg-[var(--site-surface-alt)]">
                {m.imageUrl ? (
                  <Image src={m.imageUrl} alt={m.name} width={160} height={160} className="h-full w-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="site-heading grid h-full w-full place-items-center text-3xl text-[var(--site-primary)]/50">
                    {m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </span>
                )}
              </div>
              <h3 className="site-heading mt-4 text-lg text-[var(--site-ink)]">{m.name}</h3>
              <p className="mt-1 text-sm font-bold text-[var(--site-accent)]">{m.designation}</p>
              {m.qualification ? (
                <p className="mt-1.5 text-sm text-[var(--site-ink)]/65">{m.qualification}</p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── FAQ (native details/summary: accordion without JS) ─────────────────────

export function FaqSectionView({ content }: { content: FaqSection }) {
  return (
    <section className="bg-[var(--site-surface-alt)] px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <div className="mt-10 space-y-3.5">
          {content.items.map((item) => (
            <details
              key={item.question}
              className="group rounded-2xl bg-white px-6 py-1 shadow-[0_2px_10px_rgba(30,58,52,0.06)] open:shadow-[0_4px_18px_rgba(30,58,52,0.10)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-bold text-[var(--site-ink)] marker:hidden [&::-webkit-details-marker]:hidden">
                {item.question}
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--site-surface-alt)] text-xl font-bold text-[var(--site-accent)] transition-transform duration-300 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-5 text-[15px] leading-relaxed text-[var(--site-ink)]/75">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
