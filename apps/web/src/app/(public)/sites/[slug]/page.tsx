import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPublicSite } from "@/lib/sites/fetch-public-site";
import { SiteRenderer } from "@/components/sites/site-renderer";

/**
 * `{slug}.mskool.in` (ADR-041). The middleware rewrites the tenant host onto
 * this page; `?org=slug` does the same job in dev. Reads the PUBLISHED
 * snapshot only — an unpublished, inactive, or unknown slug renders the
 * branded not-found, identically, so nothing can be probed.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await fetchPublicSite(slug);
  if (!site) return { title: "Site not found" };
  const hero = site.content.sections.find((s) => s.key === "hero");
  const subtitle = hero ? (hero.content as { subtitle?: string }).subtitle : undefined;
  return { title: site.orgName, description: subtitle };
}

export default async function PublicSitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // The slug is validated by the API's input schema; this guard keeps
  // malformed paths from reaching a fetch at all.
  if (!/^[a-z0-9-]{2,100}$/.test(slug)) notFound();

  const site = await fetchPublicSite(slug);
  if (!site) notFound();

  return <SiteRenderer content={site.content} />;
}
