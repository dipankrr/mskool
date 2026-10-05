import Image from "next/image";
import type {
  AboutSection,
  CardGridSection,
  CtaBannerSection,
  HeroSection,
  StatsSection,
} from "@repo/contracts";
import { AccentWord, CloudDivider, DoodleStar } from "../decor";

/**
 * The ujjwal-kids section renderers (ADR-041). Each one is a pure function
 * of its content + theme variables — no org conditionals anywhere. Server
 * components by default; interactivity lives in dedicated client leaves
 * (gallery lightbox, nav).
 */

// ── Shared section header ───────────────────────────────────────────────────

export function SectionHeader({
  title,
  subtitle,
  accentWords = [],
}: {
  title: string;
  subtitle?: string;
  /** 0-2 word indices of `title` to underline with the squiggle. */
  accentWords?: number[];
}) {
  const words = title.split(" ");
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h2 className="site-heading text-3xl text-[var(--site-primary)] sm:text-4xl md:text-5xl">
        {words.map((w, i) =>
          accentWords.includes(i) ? (
            <span key={i}>
              <AccentWord>{w}</AccentWord>{" "}
            </span>
          ) : (
            `${w} `
          ),
        )}
      </h2>
      {subtitle ? (
        <p className="mx-auto mt-4 max-w-[58ch] text-base leading-relaxed text-[var(--site-ink)]/75 sm:text-lg">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

export function HeroSection({ content }: { content: HeroSection }) {
  const [img1, img2] = content.images;
  return (
    <section className="relative overflow-hidden bg-[var(--site-primary)] pb-24 pt-12 text-[var(--site-on-primary)] sm:pb-32 sm:pt-16">
      <DoodleStar className="site-float absolute left-[6%] top-24 hidden size-10 opacity-80 lg:block" color="var(--site-accent)" />
      <DoodleStar className="site-float-slow absolute right-[8%] top-40 hidden size-6 opacity-70 lg:block" color="var(--site-on-primary)" />

      <div className="relative mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-4xl text-center">
          {content.ribbon ? (
            <p className="mx-auto mb-5 inline-block rounded-full bg-[var(--site-accent)] px-5 py-1.5 text-sm font-bold shadow-[0_4px_14px_rgba(232,84,47,0.4)]">
              {content.ribbon}
            </p>
          ) : null}
          <h1 className="site-heading text-4xl sm:text-5xl md:text-6xl">
            {content.title}
          </h1>
          {content.subtitle ? (
            <p className="mx-auto mt-5 max-w-[62ch] text-base leading-relaxed text-[var(--site-on-primary)]/85 sm:text-lg">
              {content.subtitle}
            </p>
          ) : null}
          {content.ctas.length > 0 ? (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {content.ctas.map((cta) => (
                <a
                  key={cta.href + cta.label}
                  href={cta.href}
                  className={
                    cta.style === "primary"
                      ? "rounded-full bg-[var(--site-accent)] px-7 py-3 text-base font-bold shadow-[0_6px_18px_rgba(232,84,47,0.45)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                      : "rounded-full border-2 border-[var(--site-on-primary)]/50 px-7 py-3 text-base font-bold transition-colors hover:border-[var(--site-on-primary)] hover:bg-white/10"
                  }
                >
                  {cta.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {img1 ? (
          <div className="relative mx-auto mt-12 grid max-w-4xl grid-cols-5 items-end gap-4 sm:mt-16 sm:gap-6">
            {img2 ? (
              <div className="site-float-slow col-span-2 overflow-hidden rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
                <Image src={img2.url} alt={img2.alt} width={560} height={640} className="h-full w-full object-cover" priority={false} />
              </div>
            ) : (
              <div className="col-span-2" />
            )}
            <div className="col-span-3 overflow-hidden rounded-3xl border-4 border-[var(--site-accent)] shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
              <Image src={img1.url} alt={img1.alt} width={840} height={640} className="h-full w-full object-cover" priority />
            </div>
          </div>
        ) : null}
      </div>

      <CloudDivider className="absolute bottom-[-1px] left-0" />
    </section>
  );
}

// ── Stats bar ───────────────────────────────────────────────────────────────

export function StatsSection({ content }: { content: StatsSection }) {
  return (
    <section className="bg-[var(--site-surface)] px-4 py-14 sm:py-16">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
        {content.items.map((stat) => (
          <div key={stat.label} className="text-center">
            <p className="site-heading text-4xl text-[var(--site-primary)] sm:text-5xl">
              {stat.value}
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--site-ink)]/60 sm:text-sm">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── About (split) ───────────────────────────────────────────────────────────

export function AboutSection({ content }: { content: AboutSection }) {
  const [img1, img2] = content.images;
  return (
    <section className="bg-[var(--site-surface-alt)] px-4 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <h2 className="site-heading text-3xl text-[var(--site-primary)] sm:text-4xl">
            {content.title}
          </h2>
          <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-[var(--site-ink)]/75 sm:text-lg">
            {content.body}
          </p>
          {content.ctas.length > 0 ? (
            <div className="mt-7 flex flex-wrap gap-3">
              {content.ctas.map((cta) => (
                <a
                  key={cta.href + cta.label}
                  href={cta.href}
                  className={
                    cta.style === "primary"
                      ? "rounded-full bg-[var(--site-accent)] px-6 py-2.5 font-bold text-white transition-transform hover:-translate-y-0.5"
                      : "rounded-full border-2 border-[var(--site-primary)] px-6 py-2.5 font-bold text-[var(--site-primary)] transition-colors hover:bg-[var(--site-primary)] hover:text-[var(--site-on-primary)]"
                  }
                >
                  {cta.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        {img1 ? (
          <div className="relative grid grid-cols-2 items-end gap-4">
            <div className="overflow-hidden rounded-2xl">
              <Image src={img1.url} alt={img1.alt} width={520} height={620} className="h-full w-full object-cover" />
            </div>
            {img2 ? (
              <div className="site-float mt-10 overflow-hidden rounded-2xl border-4 border-[var(--site-accent)]">
                <Image src={img2.url} alt={img2.alt} width={520} height={560} className="h-full w-full object-cover" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ── Card grid (programs / campuses / achievements / projects / resources) ──

function CardVideo({ videoId, title }: { videoId: string; title: string }) {
  return (
    <a
      href={`https://www.youtube.com/watch?v=${videoId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-xl"
      aria-label={`Watch: ${title}`}
    >
      <Image
        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
        alt=""
        width={480}
        height={360}
        className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
      />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-12 place-items-center rounded-full bg-[var(--site-accent)]/95 shadow-lg transition-transform group-hover:scale-110">
          <svg viewBox="0 0 24 24" className="ml-0.5 size-5 fill-white" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
      </span>
    </a>
  );
}

function SiteCard({ card }: { card: CardGridSection["cards"][number] }) {
  const hasMedia = card.videoId || card.imageUrl;
  return (
    <article className="site-reveal flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_14px_rgba(30,58,52,0.08)] transition-transform duration-300 hover:-translate-y-1">
      {card.videoId ? (
        <div className="p-3 pb-0">
          <CardVideo videoId={card.videoId} title={card.title} />
        </div>
      ) : card.imageUrl ? (
        <div className="relative overflow-hidden">
          <Image src={card.imageUrl} alt={card.imageAlt ?? card.title} width={640} height={480} className="aspect-[4/3] w-full object-cover" />
          {card.badge ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-[var(--site-accent)] px-3 py-1 text-xs font-bold text-white">
              {card.badge}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-6">
        {/* The badge is the on-image pill when there is media; otherwise it
            leads the text block — never both. */}
        {card.badge && !hasMedia ? (
          <span className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--site-accent)]">{card.badge}</span>
        ) : null}
        <h3 className="site-heading text-xl text-[var(--site-ink)]">{card.title}</h3>
        {card.description ? (
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--site-ink)]/70">{card.description}</p>
        ) : null}
        {card.bullets && card.bullets.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {card.bullets.map((b) => (
              <li key={b} className="flex gap-2 text-sm text-[var(--site-ink)]/80">
                <span aria-hidden="true" className="mt-0.5 text-[var(--site-accent)]">✓</span>
                {b}
              </li>
            ))}
          </ul>
        ) : null}
        {card.href ? (
          <a
            href={card.href}
            target={card.href.startsWith("http") ? "_blank" : undefined}
            rel={card.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className="mt-4 inline-flex w-fit items-center gap-1 font-bold text-[var(--site-accent)] hover:underline"
          >
            {card.badge ? card.badge : "Learn more"} <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function CardGridSection({ content }: { content: CardGridSection }) {
  return (
    <section className="px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {content.cards.map((card) => (
            <SiteCard key={card.title} card={card} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA banner ──────────────────────────────────────────────────────────────

export function CtaBannerSection({ content }: { content: CtaBannerSection }) {
  return (
    <section className="px-4 pb-24 pt-4 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[var(--site-accent)] px-6 py-14 text-white sm:px-12">
        {content.imageUrl ? (
          <div className="absolute inset-y-0 right-0 hidden w-[42%] md:block">
            <Image src={content.imageUrl} alt="" width={900} height={700} className="h-full w-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--site-accent)] via-[var(--site-accent)]/40 to-transparent" />
          </div>
        ) : null}
        <div className="relative max-w-xl">
          <h2 className="site-heading text-3xl sm:text-4xl md:text-5xl">{content.title}</h2>
          {content.subtitle ? (
            <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-white/90 sm:text-lg">{content.subtitle}</p>
          ) : null}
          {content.ctas.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {content.ctas.map((cta) => (
                <a
                  key={cta.href + cta.label}
                  href={cta.href}
                  className={
                    cta.style === "primary"
                      ? "rounded-full bg-[var(--site-primary)] px-7 py-3 font-bold text-[var(--site-on-primary)] shadow-lg transition-transform hover:-translate-y-0.5"
                      : "rounded-full border-2 border-white/70 px-7 py-3 font-bold text-white transition-colors hover:bg-white/15"
                  }
                >
                  {cta.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
