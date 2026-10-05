import { NextRequest, NextResponse } from "next/server";

/**
 * Tenant-host routing for public sites (ADR-041). Next 16: the file convention is proxy.ts (formerly middleware.ts).
 *
 * `{slug}.mskool.in/*` rewrites onto the `(public)` route group's
 * `/sites/{slug}` single-page site. The apex/app hosts and localhost keep
 * serving the staff/portal app untouched. `?org=slug` is a dev/QA override
 * so tenant rendering works without wildcard DNS.
 *
 * NEXT_PUBLIC_SITE_BASE_DOMAIN is read here directly rather than via
 * apps/web/src/env.ts: it is deploy topology (public by definition, needed
 * on the edge where the client-bundle literal-replacement machinery does
 * not apply), not an app secret.
 */
const DEFAULT_BASE_DOMAIN = "mskool.in";

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const url = req.nextUrl;

  const orgParam = url.searchParams.get("org");
  const baseDomain = (
    process.env.NEXT_PUBLIC_SITE_BASE_DOMAIN ?? DEFAULT_BASE_DOMAIN
  ).toLowerCase();
  const baseParts = baseDomain.split(".").length;

  let slug: string | undefined = orgParam ?? undefined;
  if (!slug && host && !host.startsWith("localhost") && !host.startsWith("127.")) {
    const parts = host.split(".");
    // Exactly one label above the base domain = a tenant subdomain. The app
    // host (app.mskool.in) and deeper wildcards (a.b.mskool.in) do not match.
    if (parts.length === baseParts + 1 && parts[0] !== "app" && parts[0] !== "www") {
      slug = parts[0];
    }
  }

  if (slug && slug !== url.pathname.split("/")[2] && !url.pathname.startsWith("/sites/")) {
    const rewrite = url.clone();
    rewrite.pathname = `/sites/${slug}`;
    const res = NextResponse.rewrite(rewrite);
    // Keep the visitor on the tenant host for nav links and assets.
    res.headers.set("x-org-slug", slug);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|sites|favicon.ico|.*\\.).*)"],
};
