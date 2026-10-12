import Image from "next/image";
import type {
  AboutSection,
  CardGridSection,
  CtaBannerSection,
  HeroSection,
  StatsSection,
} from "@repo/contracts";
import {
  AccentWord,
  CloudDivider,
  DoodleArrow,
  DoodleSparkle,
  DoodleStar,
} from "../decor";

/**
 * The ujjwal-kids section renderers (ADR-041). Each one is a pure function
 * of its content + theme variables — no org conditionals anywhere. Server
 * components by default; interactivity lives in dedicated client leaves
 * (gallery lightbox, nav).
 *
 * The preset's signature moves, lifted from the reference art direction:
 * thick colored photo frames cycling through the preset palette, tilted
 * white sticker badges, confetti sparkles, and a hero collage that
 * overlaps the cloud divider into the stats band.
 */

// Preset palette companions to the org-editable theme tokens. Frames cycle.
const FRAMES = ["#155E4B", "#F5B301", "#E8542F", "#2A9D8F"] as const;
const FRAME_SHADOWS = [
  "rgba(21,94,75,0.28)",
  "rgba(245,179,1,0.35)",
  "rgba(232,84,47,0.30)",
  "rgba(42,157,143,0.30)",
] as const;

function frame(i: number) {
  const idx = i % FRAMES.length;
  return { background: FRAMES[idx], boxShadow: `0 14px 34px ${FRAME_SHADOWS[idx]}` };
}

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
      {/* data-edit-rich: the accent spans are inline decoration, so the
          canvas treats this as one text leaf for the whole title. */}
      <h2 data-cpath="title" data-edit-rich className="site-heading text-3xl text-[var(--site-primary)] sm:text-4xl md:text-5xl">
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
        <p data-cpath="subtitle" className="mx-auto mt-4 max-w-[58ch] text-base leading-relaxed text-[var(--site-ink)]/70 sm:text-lg">
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
    <section className="relative overflow-hidden bg-[var(--site-primary)] pb-40 pt-36 text-[var(--site-on-primary)] sm:pb-48 sm:pt-40">
      {/* confetti field */}
      <DoodleSparkle className="site-float absolute left-[8%] top-32 hidden size-9 opacity-90 lg:block" />
      <DoodleStar className="site-float-slow absolute left-[16%] top-52 hidden size-5 opacity-70 lg:block" color="#FDFBF0" />
      <DoodleSparkle className="site-float-slow absolute right-[10%] top-28 hidden size-7 opacity-80 lg:block" color="#FDFBF0" />
      <DoodleStar className="site-float absolute right-[18%] top-56 hidden size-5 opacity-90 lg:block" />

      <div className="relative mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto max-w-4xl text-center">
          {content.ribbon ? (
            <p data-cpath="ribbon" className="mx-auto mb-6 inline-block rounded-full bg-[var(--site-accent)] px-6 py-2 text-sm font-bold shadow-[0_6px_18px_rgba(232,84,47,0.5)] sm:text-base">
              {content.ribbon}
            </p>
          ) : null}
          <h1 data-cpath="title" className="site-heading text-[2.6rem] sm:text-6xl md:text-7xl">
            {content.title}
          </h1>
          {content.subtitle ? (
            <p data-cpath="subtitle" className="mx-auto mt-6 max-w-[60ch] text-base leading-relaxed text-[var(--site-on-primary)]/85 sm:text-lg">
              {content.subtitle}
            </p>
          ) : null}
          {content.ctas.length > 0 ? (
            <div className="relative mt-9 flex flex-wrap items-center justify-center gap-4">
              {content.ctas.map((cta, i) => (
                <a
                  key={cta.href + cta.label}
                  data-cpath={`ctas.${i}.label`}
                  href={cta.href}
                  className={
                    cta.style === "primary"
                      ? "rounded-full bg-[var(--site-accent)] px-8 py-3.5 text-base font-bold shadow-[0_8px_22px_rgba(232,84,47,0.55)] transition-transform hover:-translate-y-1 active:translate-y-0"
                      : "rounded-full border-2 border-[var(--site-on-primary)]/50 px-8 py-3.5 text-base font-bold transition-all hover:-translate-y-1 hover:border-[var(--site-on-primary)] hover:bg-white/10"
                  }
                >
                  {cta.label}
                </a>
              ))}
              <DoodleArrow className="absolute -left-6 -top-10 hidden w-24 -scale-x-100 lg:block" color="#F5B301" />
            </div>
          ) : null}
        </div>

        {img1 ? (
          <div className="relative mx-auto mt-14 grid max-w-4xl grid-cols-5 items-end gap-5 sm:mt-20 sm:gap-7">
            {img2 ? (
              <div
                data-cpath="images.1.url"
                className="site-frame site-hero-photo col-span-2 rotate-[-2.5deg]"
                style={frame(1)}
              >
                <Image src={img2.url} alt={img2.alt} width={560} height={640} className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="col-span-2" />
            )}
            <div
              data-cpath="images.0.url"
              className="site-frame site-hero-photo col-span-3 rotate-[1.5deg]"
              style={frame(0)}
            >
              <Image src={img1.url} alt={img1.alt} width={840} height={640} className="h-full w-full object-cover" priority />
            </div>
            <DoodleSparkle className="absolute -left-3 bottom-10 hidden size-10 sm:block" />
          </div>
        ) : null}
      </div>

      <CloudDivider className="absolute bottom-[-1px] left-0" />
    </section>
  );
}

// ── Stats band: white card overlapping the hero's clouds ────────────────────

export function StatsSection({ content }: { content: StatsSection }) {
  return (
    <section className="relative z-10 -mt-28 px-4 sm:-mt-32">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-6 gap-y-10 rounded-[2rem] border-2 border-[var(--site-primary)]/10 bg-white px-6 py-10 shadow-[0_20px_50px_rgba(30,58,52,0.12)] sm:grid-cols-4 sm:px-10">
        {content.items.map((stat, i) => (
          <div key={`${stat.label}-${i}`} className="text-center">
            <p data-cpath={`items.${i}.value`} className="site-heading text-4xl sm:text-5xl" style={{ color: FRAMES[i % FRAMES.length] }}>
              {stat.value}
            </p>
            <p data-cpath={`items.${i}.label`} className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--site-ink)]/60 sm:text-sm">
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
    <section className="px-4 py-24 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <h2 data-cpath="title" className="site-heading text-3xl text-[var(--site-primary)] sm:text-4xl md:text-5xl">
            {content.title}
          </h2>
          <p data-cpath="body" className="mt-5 max-w-[60ch] text-base leading-relaxed text-[var(--site-ink)]/75 sm:text-lg">
            {content.body}
          </p>
          {content.ctas.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {content.ctas.map((cta, i) => (
                <a
                  key={cta.href + cta.label}
                  data-cpath={`ctas.${i}.label`}
                  href={cta.href}
                  className={
                    cta.style === "primary"
                      ? "rounded-full bg-[var(--site-accent)] px-7 py-3 font-bold text-white shadow-[0_6px_18px_rgba(232,84,47,0.45)] transition-transform hover:-translate-y-1"
                      : "rounded-full border-2 border-[var(--site-primary)] px-7 py-3 font-bold text-[var(--site-primary)] transition-all hover:-translate-y-1 hover:bg-[var(--site-primary)] hover:text-[var(--site-on-primary)]"
                  }
                >
                  {cta.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        {img1 ? (
          <div className="relative grid grid-cols-2 items-end gap-5">
            <DoodleSparkle className="absolute -left-4 -top-4 z-10 size-8" />
            <div data-cpath="images.0.url" className="site-frame site-hero-photo rotate-[-2deg]" style={frame(0)}>
              <Image src={img1.url} alt={img1.alt} width={520} height={620} className="h-full w-full object-cover" />
            </div>
            {img2 ? (
              <div data-cpath="images.1.url" className="site-frame site-hero-photo mt-12 rotate-[2deg]" style={frame(3)}>
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
        className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
      />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-12 place-items-center rounded-full bg-[var(--site-accent)]/95 shadow-[0_6px_16px_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:scale-110">
          <svg viewBox="0 0 24 24" className="ml-0.5 size-6 fill-white" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
      </span>
    </a>
  );
}

function SiteCard({ card, index }: { card: CardGridSection["cards"][number]; index: number }) {
  const hasMedia = Boolean(card.videoId || card.imageUrl);
  const style = frame(index);

  return (
    <article data-cpath={`cards.${index}`} className="site-reveal flex h-full flex-col">
      {card.videoId ? (
        <div className="site-frame" style={style} data-cpath={`cards.${index}.videoId`}>
          <CardVideo videoId={card.videoId} title={card.title} />
        </div>
      ) : card.imageUrl ? (
        <div className="site-frame relative" style={style} data-cpath={`cards.${index}.imageUrl`}>
          <Image src={card.imageUrl} alt={card.imageAlt ?? card.title} width={640} height={480} className="aspect-[4/3] w-full object-cover" />
          {card.badge ? (
            <span data-cpath={`cards.${index}.badge`} className="site-sticker absolute -left-2 top-4 rounded-full bg-white px-3.5 py-1.5 text-xs font-extrabold" style={{ color: FRAMES[index % FRAMES.length] }}>
              {card.badge}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Text block: soft white sheet under the framed photo */}
      <div className="-mt-3 flex flex-1 flex-col rounded-b-3xl rounded-t-xl bg-white p-6 shadow-[0_10px_28px_rgba(30,58,52,0.09)]">
        {card.badge && !hasMedia ? (
          <span className="mb-2 inline-flex w-fit rounded-full px-3 py-1 text-xs font-extrabold text-white" style={{ background: FRAMES[index % FRAMES.length] }}>
            {card.badge}
          </span>
        ) : null}
        <h3 data-cpath={`cards.${index}.title`} className="site-heading text-xl text-[var(--site-ink)]">{card.title}</h3>
        {card.description ? (
          <p data-cpath={`cards.${index}.description`} className="mt-2.5 text-[15px] leading-relaxed text-[var(--site-ink)]/70">{card.description}</p>
        ) : null}
        {card.bullets && card.bullets.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {card.bullets.map((b, bi) => (
              <li key={`${b}-${bi}`} data-cpath={`cards.${index}.bullets.${bi}`} className="flex gap-2 text-sm text-[var(--site-ink)]/80">
                <span aria-hidden="true" className="mt-0.5 font-bold" style={{ color: FRAMES[index % FRAMES.length] }}>
                  ✓
                </span>
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
            className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
            style={{ background: FRAMES[index % FRAMES.length] }}
          >
            {card.badge && !hasMedia ? "Learn more" : card.badge} <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function CardGridSection({ content }: { content: CardGridSection }) {
  return (
    <section className="px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />
        <div className="mt-14 grid grid-cols-1 gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {content.cards.map((card, i) => (
            // Index-qualified: titles are not unique (three "Sample program"
            // cards would share one key and React would mix up their edits).
            <SiteCard key={`${card.title}-${i}`} card={card} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA banner ──────────────────────────────────────────────────────────────

export function CtaBannerSection({ content }: { content: CtaBannerSection }) {
  return (
    <section className="px-4 pb-28 pt-4 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-[var(--site-accent)] px-6 py-16 text-white shadow-[0_24px_60px_rgba(232,84,47,0.35)] sm:px-14">
        <DoodleSparkle className="absolute left-8 top-8 size-9 opacity-90" />
        <DoodleStar className="absolute bottom-10 left-1/3 hidden size-6 opacity-70 md:block" color="#FFFFFF" />
        {content.imageUrl ? (
          <div className="absolute inset-y-0 right-0 hidden w-[40%] md:block">
            <div
              data-cpath="imageUrl"
              className="site-frame absolute right-[-1rem] top-1/2 w-[115%] -translate-y-1/2 rotate-[3deg]"
              style={{ background: "#155E4B", boxShadow: "0 18px 44px rgba(0,0,0,0.3)" }}
            >
              <Image src={content.imageUrl} alt="" width={900} height={700} className="aspect-[4/3] h-full w-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--site-accent)] via-[var(--site-accent)]/30 to-transparent" />
          </div>
        ) : null}
        <div className="relative max-w-xl">
          <h2 data-cpath="title" className="site-heading text-3xl sm:text-4xl md:text-5xl">{content.title}</h2>
          {content.subtitle ? (
            <p data-cpath="subtitle" className="mt-4 max-w-[46ch] text-base leading-relaxed text-white/90 sm:text-lg">{content.subtitle}</p>
          ) : null}
          {content.ctas.length > 0 ? (
            <div className="mt-9 flex flex-wrap gap-4">
              {content.ctas.map((cta, i) => (
                <a
                  key={cta.href + cta.label}
                  data-cpath={`ctas.${i}.label`}
                  href={cta.href}
                  className={
                    cta.style === "primary"
                      ? "rounded-full bg-[var(--site-primary)] px-8 py-3.5 font-bold text-[var(--site-on-primary)] shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-transform hover:-translate-y-1"
                      : "rounded-full border-2 border-white/70 bg-white/10 px-8 py-3.5 font-bold text-white backdrop-blur-sm transition-all hover:-translate-y-1 hover:bg-white/20"
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
