// Site-wide settings that are still open. Fill these in before launch.

/** WhatsApp number in international form, digits only (e.g. "9198XXXXXXXX"). Empty = links stay inert. */
export const WHATSAPP_NUMBER = "";

/** Public address of the site, used for canonical and language links. */
export const SITE_URL = "https://mskool.in";

export function whatsappHref(text?: string): string {
  if (!WHATSAPP_NUMBER) return "#apply";
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${WHATSAPP_NUMBER}${q}`;
}
