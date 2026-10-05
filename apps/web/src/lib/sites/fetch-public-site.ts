import { publicSitePayloadSchema, type PublicSitePayload } from "@repo/contracts";
import { env } from "@/env";

/**
 * Server-side fetch of the published site snapshot through the tRPC
 * endpoint (type-only import of AppRouter elsewhere; this helper talks HTTP
 * exactly like the browser client does). The response is validated against
 * the same contract the API promises, so a drifted server fails here —
 * loudly — instead of rendering `undefined` into a school's homepage.
 *
 * Cached briefly: the snapshot only changes on publish, and the public
 * audience is anonymous (no per-request cookies to key a cache on).
 */
export async function fetchPublicSite(slug: string): Promise<PublicSitePayload | null> {
  const input = encodeURIComponent(JSON.stringify({ slug }));
  const res = await fetch(
    `${env.NEXT_PUBLIC_API_URL}/trpc/publicSite.bySlug?input=${input}`,
    { next: { revalidate: 60 } },
  ).catch(() => null);

  if (!res || !res.ok) return null;

  const body = (await res.json().catch(() => null)) as
    | { result?: { data?: unknown } }
    | null;
  // tRPC v11 wraps non-superjson payloads as { result: { data } } directly —
  // there is no `.json` envelope unless a transformer is in play.
  const json = body?.result?.data;
  if (json === null || json === undefined) return null;

  const parsed = publicSitePayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
