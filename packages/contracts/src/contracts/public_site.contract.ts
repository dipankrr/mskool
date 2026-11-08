import { z } from "zod";

/**
 * The public site content vocabulary (ADR-041).
 *
 * NOT derived from a Drizzle table: `org_public_sites` stores content as
 * jsonb, and this contract is the typed shape that jsonb must satisfy. The
 * editor validates writes against `publicSiteContentSchema`; the public
 * renderer validates reads with the same schema, so a bad row can never
 * reach a component as `any`.
 *
 * Design rules baked into the shapes:
 *  - Sections are a discriminated union on `key`. The renderer's registry
 *    maps key → component; the editor gets the union for free.
 *  - Cards are one generic shape (`siteCardSchema`) reused by programs,
 *    campuses, achievements, projects and resources — a "new section" is
 *    usually new content in an existing shape.
 *  - Everything is plain strings/URLs. Images are URLs (ADR-041 §6: static
 *    assets for v1), never object ids — the public path is anonymous.
 *
 * Zod 4: `z.email()`, not `z.string().email()`.
 */

// ── Theme tokens ────────────────────────────────────────────────────────────
// CSS-variable values; the renderer maps them onto the site shell's style.
// Hex colors validated loosely (3/6/8-digit hex) so editors can paste brand
// colors without us re-implementing a color picker's grammar.

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

export const siteThemeSchema = z.object({
  colorPrimary: hexColor, // the deep brand surface (nav, footer, hero wash)
  colorAccent: hexColor, // the single accent (CTAs, highlights)
  colorSurface: hexColor, // page background
  colorSurfaceAlt: hexColor, // alternating section background
  colorInk: hexColor, // body text
  colorOnPrimary: hexColor, // text on colorPrimary
  fontHeading: z.string().min(1).max(100),
  fontBody: z.string().min(1).max(100),
});
export type SiteTheme = z.infer<typeof siteThemeSchema>;

// ── Shared building blocks ──────────────────────────────────────────────────

export const siteLinkSchema = z.object({
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(500),
});
export type SiteLink = z.infer<typeof siteLinkSchema>;

export const siteCtaSchema = z.object({
  label: z.string().min(1).max(40),
  href: z.string().min(1).max(500),
  style: z.enum(["primary", "secondary"]).default("primary"),
});
export type SiteCta = z.infer<typeof siteCtaSchema>;

export const siteImageSchema = z.object({
  url: z.string().min(1).max(1000),
  alt: z.string().max(300).default(""),
});
export type SiteImage = z.infer<typeof siteImageSchema>;

/** The one card shape that powers programs, campuses, achievements, projects. */
export const siteCardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(1000).optional(),
  imageAlt: z.string().max(300).optional(),
  badge: z.string().max(60).optional(), // "AGES 3-5", "Completed", "Main Campus"
  bullets: z.array(z.string().min(1).max(200)).max(10).optional(),
  // Optional destination: a campus card has none, a resource card links out.
  href: z.string().max(500).optional(),
  // Optional YouTube id — the projects section embeds/links it.
  videoId: z.string().max(20).optional(),
});
export type SiteCard = z.infer<typeof siteCardSchema>;

export const siteStatSchema = z.object({
  value: z.string().min(1).max(20), // "10,000+", "4.9/5"
  label: z.string().min(1).max(80),
});
export type SiteStat = z.infer<typeof siteStatSchema>;

// ── Sections ────────────────────────────────────────────────────────────────

export const heroSectionSchema = z.object({
  badge: z.string().max(60).optional(), // "Award Winning"
  ribbon: z.string().max(80).optional(), // "Admissions Open for 2026-2027"
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  images: z.array(siteImageSchema).max(6).default([]),
  ctas: z.array(siteCtaSchema).max(2).default([]),
});
export type HeroSection = z.infer<typeof heroSectionSchema>;

export const statsSectionSchema = z.object({
  items: z.array(siteStatSchema).min(1).max(6),
});
export type StatsSection = z.infer<typeof statsSectionSchema>;

/** Split "about" block: text one side, image collage the other. */
export const aboutSectionSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(3000),
  images: z.array(siteImageSchema).max(4).default([]),
  ctas: z.array(siteCtaSchema).max(2).default([]),
});
export type AboutSection = z.infer<typeof aboutSectionSchema>;

export const cardGridSectionSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  cards: z.array(siteCardSchema).min(1).max(24),
});
export type CardGridSection = z.infer<typeof cardGridSectionSchema>;

export const gallerySectionSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  images: z.array(siteImageSchema).min(1).max(200),
});
export type GallerySection = z.infer<typeof gallerySectionSchema>;

export const facultySectionSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        designation: z.string().min(1).max(120),
        qualification: z.string().max(200).optional(),
        imageUrl: z.string().max(1000).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type FacultySection = z.infer<typeof facultySectionSchema>;

export const faqSectionSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  items: z
    .array(z.object({ question: z.string().min(1).max(300), answer: z.string().min(1).max(3000) }))
    .min(1)
    .max(30),
});
export type FaqSection = z.infer<typeof faqSectionSchema>;

export const contactSectionSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  address: z.string().max(400),
  email: z.email(),
  phones: z.array(z.string().min(6).max(20)).min(1).max(3),
  hours: z.string().max(200),
  mapEmbedUrl: z.string().max(1000).optional(),
});
export type ContactSection = z.infer<typeof contactSectionSchema>;

/** The big pre-footer call-to-action banner. */
export const ctaBannerSectionSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(400).optional(),
  imageUrl: z.string().max(1000).optional(),
  ctas: z.array(siteCtaSchema).max(2).default([]),
});
export type CtaBannerSection = z.infer<typeof ctaBannerSectionSchema>;

export const sectionKeySchema = z.enum([
  "hero",
  "stats",
  "about",
  "cardGrid",
  "gallery",
  "faculty",
  "faq",
  "contact",
  "ctaBanner",
]);
export type SectionKey = z.infer<typeof sectionKeySchema>;

/**
 * Each key pairs with exactly one content schema. Writing this as an explicit
 * record (not a z.union over wrappers) gives the editor a key→schema lookup
 * and keeps the renderer's registry honest about the same pairing.
 */
export const SECTION_SCHEMAS = {
  hero: heroSectionSchema,
  stats: statsSectionSchema,
  about: aboutSectionSchema,
  cardGrid: cardGridSectionSchema,
  gallery: gallerySectionSchema,
  faculty: facultySectionSchema,
  faq: faqSectionSchema,
  contact: contactSectionSchema,
  ctaBanner: ctaBannerSectionSchema,
} as const satisfies Record<SectionKey, z.ZodType>;

export const siteSectionSchema = z.object({
  key: sectionKeySchema,
  // Optional anchor for the site nav (#programs etc.) — absent sections are
  // just unreachable by nav, which is how an org "removes" a section from
  // the menu without deleting its content.
  id: z.string().max(40).regex(/^[a-z0-9-]*$/).optional(),
  content: z.unknown(), // validated against SECTION_SCHEMAS[key] by refine below
});
export type SiteSection = { key: SectionKey; id?: string; content: unknown };

export const siteChromeSchema = z.object({
  orgName: z.string().min(1).max(200),
  logoUrl: z.string().max(1000).optional(),
  tagline: z.string().max(200).optional(),
  topbar: z
    .object({
      phone: z.string().max(20).optional(),
      email: z.email().optional(),
      hours: z.string().max(120).optional(),
    })
    .optional(),
});
export type SiteChrome = z.infer<typeof siteChromeSchema>;

export const siteFooterSchema = z.object({
  blurb: z.string().max(600).optional(),
  tagline: z.string().max(100).optional(),
  columns: z.array(z.object({ heading: z.string().max(80), links: z.array(siteLinkSchema).max(8) })).max(4).default([]),
  social: z.array(z.object({ label: z.string().max(40), href: z.string().max(500) })).max(6).default([]),
  copyright: z.string().max(200).optional(),
});
export type SiteFooter = z.infer<typeof siteFooterSchema>;

/** Validating refinement: each section's content must satisfy its key's schema. */
function validateSection(section: SiteSection): boolean {
  return SECTION_SCHEMAS[section.key].safeParse(section.content).success;
}

export const publicSiteContentSchema = z.object({
  chrome: siteChromeSchema,
  nav: z.array(siteLinkSchema).max(10),
  theme: siteThemeSchema,
  sections: z.array(siteSectionSchema).max(16).refine((sections) => sections.every(validateSection), {
    message: "A section's content does not match its key's schema.",
  }),
  footer: siteFooterSchema,
});
export type PublicSiteContent = z.infer<typeof publicSiteContentSchema>;

/** Input shape for the staff editor: draft only, publish is a separate act. */
export const publicSiteContentInputSchema = publicSiteContentSchema;
export type PublicSiteContentInput = z.infer<typeof publicSiteContentInputSchema>;

/** Public read shape: what `{slug}.mskool.in` is allowed to receive. */
export const publicSitePayloadSchema = z.object({
  orgName: z.string(),
  preset: z.string(),
  content: publicSiteContentSchema,
  publishedAt: z.iso.datetime().nullable(),
});
export type PublicSitePayload = z.infer<typeof publicSitePayloadSchema>;
