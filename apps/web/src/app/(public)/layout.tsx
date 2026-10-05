import type { Metadata } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./site.css";

/**
 * The public-site shell (ADR-041): no dashboard chrome, no auth, no theme
 * provider — a tenant site is one locked visual theme (the org's), not a
 * light/dark preference. Fonts load per preset; the ujjwal-kids preset uses
 * Baloo 2 (rounded display) + Nunito (body), mapped onto the theme tokens
 * `fontHeading`/`fontBody` by the site renderer.
 */
const display = Baloo_2({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--site-font-baloo2",
  display: "swap",
});

const body = Nunito({
  subsets: ["latin"],
  variable: "--site-font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} ${body.variable} site-root`}>
      {children}
    </div>
  );
}
