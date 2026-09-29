"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

import type {
  IdCardElementInput,
  IdCardStudentCard,
  IdCardTemplateDataInput,
} from "@repo/contracts";

import { cardSizeMm, MM_PX, resolveBinding } from "./template";

/**
 * THE CARD RENDERER (slice 2a).
 *
 * Lays a template's elements out over a CR80 card (86 × 54mm landscape /
 * 54 × 86mm portrait) against ONE student's server-resolved card payload.
 * Every element positions in percent-of-card, so the same template prints
 * identically on paper and previews on screen — the only difference is the
 * `scale` wrapper. The browser invents nothing: a binding the payload cannot
 * satisfy renders empty.
 *
 * Objects (background, photo, logo) load from `/api/storage/:id`, which the
 * web app proxies to the API same-origin — session cookies flow, no signed
 * URLs (ADR-038). The QR encodes the studentId.
 */

function useQrDataUrl(value: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 0, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return dataUrl;
}

function ElementBox({
  element,
  children,
}: {
  element: IdCardElementInput;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${element.x}%`,
        top: `${element.y}%`,
        width: `${element.width}%`,
        height: `${element.height}%`,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

export function IdCardPreview({
  template,
  card,
  scale = 1,
  cutGuide = false,
  className,
}: {
  /** The write shape — defaults (weight/color/align/visible) may be absent. */
  template: IdCardTemplateDataInput;
  card: IdCardStudentCard | null;
  /** Screen preview scale; print renders at 1 (physical mm) elsewhere. */
  scale?: number;
  /** Dashed cut guide around the card (print sheets use it). */
  cutGuide?: boolean;
  className?: string;
}) {
  const { widthMm, heightMm } = cardSizeMm(template.orientation);
  const qr = useQrDataUrl(card?.studentId ?? null);
  const photoUrl = card?.photoObjectId ? `/api/storage/${card.photoObjectId}` : null;
  const backgroundUrl = template.canvas.backgroundAssetId
    ? `/api/storage/${template.canvas.backgroundAssetId}`
    : null;

  return (
    <div
      className={className}
      style={{
        width: widthMm * MM_PX * scale,
        height: heightMm * MM_PX * scale,
      }}
    >
      <div
        style={{
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
          overflow: "hidden",
          background: "#ffffff",
          color: "#111827",
          outline: cutGuide ? "0.2mm dashed #9ca3af" : undefined,
          outlineOffset: cutGuide ? "0.5mm" : undefined,
          fontFamily: "var(--font-sans, sans-serif)",
        }}
      >
        {backgroundUrl ? (
          // Full-card background: object-cover like a printed pre-cut card.
          <img
            src={backgroundUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}

        {template.elements
          .filter((element) => element.visible !== false)
          .map((element) => {
            if (element.type === "text") {
              const value = card ? resolveBinding(element, card) : "";
              return (
                <ElementBox key={element.id} element={element}>
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent:
                        element.align === "right"
                          ? "flex-end"
                          : element.align === "center"
                            ? "center"
                            : "flex-start",
                      fontSize: `${element.fontSize}pt`,
                      fontWeight: element.fontWeight === "bold" ? 700 : 400,
                      color: element.color ?? "#111827",
                      lineHeight: 1.15,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {value}
                  </div>
                </ElementBox>
              );
            }

            if (element.type === "photo") {
              return (
                <ElementBox key={element.id} element={element}>
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        background: "#f3f4f6",
                      }}
                    />
                  )}
                </ElementBox>
              );
            }

            if (element.type === "qr") {
              return (
                <ElementBox key={element.id} element={element}>
                  {qr ? (
                    <img
                      src={qr}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  ) : null}
                </ElementBox>
              );
            }

            // logo — renders only if the school uploaded a logo asset; a
            // missing asset is an empty slot, never a broken card.
            const logoUrl = element.assetId ? `/api/storage/${element.assetId}` : null;
            return (
              <ElementBox key={element.id} element={element}>
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : null}
              </ElementBox>
            );
          })}
      </div>
    </div>
  );
}
