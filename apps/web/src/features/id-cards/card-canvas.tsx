"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

import type {
  IdCardElementInput,
  IdCardStudentCard,
  IdCardTemplateDataInput,
} from "@repo/contracts";

import { resolveBinding } from "./template";

/**
 * THE CARD SURFACE (extracted in slice 2b) — everything INSIDE the card,
 * shared by the print preview and the designer so what is designed is what
 * prints. `IdCardPreview` wraps this with the CR80 mm sizing and the print
 * sheet reuses it at scale 1; the designer renders each element through the
 * same `ElementContent` inside its own interactive wrapper.
 *
 * The browser invents nothing here either: a binding the card payload cannot
 * satisfy renders empty, and a missing object is an empty slot, never a
 * broken card. Objects load from `/api/storage/:id` (ADR-038) — session
 * cookies flow, no signed URLs.
 */

/** One element's inner content — the visual, without any positioning. */
export function ElementContent({
  element,
  card,
}: {
  element: IdCardElementInput;
  card: IdCardStudentCard | null;
}) {
  if (element.type === "text") {
    const value = card ? resolveBinding(element, card) : "";
    return (
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
    );
  }

  if (element.type === "photo") {
    const photoUrl = card?.photoObjectId
      ? `/api/storage/${card.photoObjectId}`
      : null;
    return photoUrl ? (
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
    );
  }

  if (element.type === "qr") {
    return <QrImage value={card ? studentPageUrl(card.studentId) : null} />;
  }

  // logo — renders only if a logo asset was uploaded; a missing asset is an
  // empty slot, never a broken card.
  const logoUrl = element.assetId ? `/api/storage/${element.assetId}` : null;
  return logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }}
    />
  ) : null;
}

/** The positioned wrapper — percent geometry, origin top-left. */
export function ElementBox({
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
        borderRadius: element.borderRadius
          ? `${element.borderRadius}%`
          : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** The full-card background image, object-cover like a printed pre-cut card. */
export function CardBackground({ template }: { template: IdCardTemplateDataInput }) {
  const backgroundUrl = template.canvas.backgroundAssetId
    ? `/api/storage/${template.canvas.backgroundAssetId}`
    : null;
  return backgroundUrl ? (
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
  ) : null;
}

/**
 * The card's rendered layer — background plus every VISIBLE element in
 * template order. This is exactly what print outputs; the designer draws the
 * invisible ones itself, dimmed, rather than hiding them from the operator.
 */
export function CardLayer({
  template,
  card,
}: {
  template: IdCardTemplateDataInput;
  card: IdCardStudentCard | null;
}) {
  return (
    <>
      <CardBackground template={template} />
      {template.elements
        .filter((element) => element.visible !== false)
        .map((element) => (
          <ElementBox key={element.id} element={element}>
            <ElementContent element={element} card={card} />
          </ElementBox>
        ))}
    </>
  );
}

/** resolveBinding lives in template.ts (the render model) — one copy only. */

/**
 * The QR encodes a link to the student's OWN PAGE on the branch that
 * printed the card — staff scan it and land on the record. Absolute URL:
 * a QR on paper is scanned by a phone that has no idea of this origin.
 */
function studentPageUrl(studentId: string): string {
  if (typeof window === "undefined") return `/students/${studentId}`;
  return `${window.location.origin}/students/${studentId}`;
}

/** QR of the studentId, rendered async — the print page's exact behavior. */
function QrImage({ value }: { value: string | null }) {
  const dataUrl = useQrDataUrl(value);
  return dataUrl ? (
    <img
      src={dataUrl}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }}
    />
  ) : null;
}

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
