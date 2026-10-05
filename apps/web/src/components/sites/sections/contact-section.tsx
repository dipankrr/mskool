import { Clock, Mail, MapPin, Phone } from "lucide-react";
import type { ContactSection } from "@repo/contracts";
import { SectionHeader } from "./core-sections";

/** Contact details + optional map embed. No form yet (ADR-041 non-goal). */
export function ContactSectionView({ content }: { content: ContactSection }) {
  return (
    <section className="px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          accentWords={[content.title.split(" ").length - 1]}
        />

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-7 shadow-[0_2px_14px_rgba(30,58,52,0.08)]">
            <span className="grid size-11 place-items-center rounded-full bg-[var(--site-surface-alt)] text-[var(--site-accent)]">
              <MapPin className="size-5" strokeWidth={2} />
            </span>
            <h3 className="site-heading mt-4 text-lg">Visit Our Campus</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--site-ink)]/75">{content.address}</p>
          </div>

          <div className="rounded-2xl bg-white p-7 shadow-[0_2px_14px_rgba(30,58,52,0.08)]">
            <span className="grid size-11 place-items-center rounded-full bg-[var(--site-surface-alt)] text-[var(--site-accent)]">
              <Phone className="size-5" strokeWidth={2} />
            </span>
            <h3 className="site-heading mt-4 text-lg">Call Us</h3>
            <ul className="mt-2 space-y-1">
              {content.phones.map((p) => (
                <li key={p}>
                  <a href={`tel:${p.replace(/\s/g, "")}`} className="text-[15px] font-semibold text-[var(--site-ink)]/85 hover:text-[var(--site-accent)] hover:underline">
                    {p}
                  </a>
                </li>
              ))}
            </ul>
            <a href={`mailto:${content.email}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--site-accent)] hover:underline">
              <Mail className="size-4" strokeWidth={2} /> {content.email}
            </a>
          </div>

          <div className="rounded-2xl bg-white p-7 shadow-[0_2px_14px_rgba(30,58,52,0.08)]">
            <span className="grid size-11 place-items-center rounded-full bg-[var(--site-surface-alt)] text-[var(--site-accent)]">
              <Clock className="size-5" strokeWidth={2} />
            </span>
            <h3 className="site-heading mt-4 text-lg">Office Hours</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--site-ink)]/75">{content.hours}</p>
          </div>
        </div>

        {content.mapEmbedUrl ? (
          <div className="mx-auto mt-10 max-w-5xl overflow-hidden rounded-2xl shadow-[0_2px_14px_rgba(30,58,52,0.10)]">
            <iframe
              src={content.mapEmbedUrl}
              title="Campus location map"
              loading="lazy"
              className="h-80 w-full border-0"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
