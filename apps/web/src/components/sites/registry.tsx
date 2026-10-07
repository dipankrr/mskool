import type { SectionKey, SiteSection } from "@repo/contracts";
import {
  AboutSection,
  CardGridSection,
  CtaBannerSection,
  HeroSection,
  StatsSection,
} from "./sections/core-sections";
import { ContactSectionView } from "./sections/contact-section";
import { FaqSectionView, FacultySectionView, GallerySectionView } from "./sections/info-sections";

/**
 * The section library registry (ADR-041 §1): section key → renderer. The
 * pairing MUST mirror SECTION_SCHEMAS in @repo/contracts — the contract
 * validates the content shape, this maps it to a component. A new section
 * type = a schema here's twin + an entry in both places.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the union's members are validated by SECTION_SCHEMAS before reaching here
type SectionComponent = (props: { content: any }) => React.ReactElement;

export const SECTION_REGISTRY: Record<SectionKey, SectionComponent> = {
  hero: HeroSection,
  stats: StatsSection,
  about: AboutSection,
  cardGrid: CardGridSection,
  gallery: GallerySectionView,
  faculty: FacultySectionView,
  faq: FaqSectionView,
  contact: ContactSectionView,
  ctaBanner: CtaBannerSection,
};

/**
 * Renders a section with its optional anchor id. Unknown keys cannot occur
 * (the contract's enum + the API's output schema), but a missing entry here
 * would crash the whole page — so the renderer skips defensively and loudly.
 */
export function renderSection(section: SiteSection, index: number) {
  const Component = SECTION_REGISTRY[section.key];
  if (!Component) {
    console.error(`[site] no renderer registered for section key "${section.key}"`);
    return null;
  }
  return (
    // data-section-index: the live preview's click-to-select hook (the site
    // editor postMessages the index back to the outline). Inert on the
    // public site — it discloses nothing beyond DOM order.
    <div key={`${section.key}-${section.id ?? index}`} id={section.id} data-section-index={index}>
      <Component content={section.content} />
    </div>
  );
}
