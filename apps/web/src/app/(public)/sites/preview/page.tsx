import type { Metadata } from "next";
import { SitePreview } from "@/features/site/preview";

/**
 * The live preview canvas for the site editor (ADR-041). Rendered in the
 * editor's iframe; renders nothing until the editor posts a draft. Never
 * indexed — it is an editing surface, not a page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SitePreviewPage() {
  return <SitePreview />;
}
