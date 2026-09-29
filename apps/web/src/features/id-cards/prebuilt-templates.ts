import type { IdCardTemplateDataInput } from "@repo/contracts";

/**
 * THE STARTER GALLERY (slice 2a).
 *
 * 4–5 prebuilt card designs as CODE constants — the app's own template
 * vocabulary, rendered by the same renderer an adopted row uses. "Adopt"
 * posts the constant to `idCard.template.adopt`, which clones it into a
 * school-owned row; from then on the school's copy diverges freely (that is
 * the 2b designer's surface). The server holds no copy of these constants —
 * the client gallery is their source of truth, and the adopt endpoint
 * validates the payload with the same schema every other write uses.
 *
 * Geometry is percent-of-card (86 × 54mm landscape / 54 × 86mm portrait), so
 * every coordinate here reads as "share of the card", and the ids are
 * stable within a design (the designer's future drag keys).
 */

export interface PrebuiltTemplate {
  /** Stable public id — the adopt mutation's provenance string. */
  id: string;
  name: string;
  description: string;
  data: IdCardTemplateDataInput;
}

const A = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
  visible: true,
});

export const PREBUILT_TEMPLATES: PrebuiltTemplate[] = [
  {
    id: "classic-blue",
    name: "Classic Blue",
    description: "Photo left, details right, school header. The safe default.",
    data: {
      orientation: "landscape",
      canvas: { backgroundAssetId: null },
      elements: [
        {
          id: "header-band",
          type: "text",
          ...A(0, 0, 100, 16),
          binding: "schoolName",
          fontSize: 11,
          fontWeight: "bold",
          color: "#ffffff",
          align: "center",
          visible: true,
        },
        { id: "photo", type: "photo", ...A(4, 22, 24, 62), visible: true },
        {
          id: "name",
          type: "text",
          ...A(32, 24, 62, 14),
          binding: "studentName",
          fontSize: 10,
          fontWeight: "bold",
          visible: true,
        },
        {
          id: "class-line",
          type: "text",
          ...A(32, 38, 62, 10),
          binding: "className",
          fontSize: 8,
          visible: true,
        },
        {
          id: "admission",
          type: "text",
          ...A(32, 48, 62, 10),
          binding: "admissionNumber",
          fontSize: 8,
          visible: true,
        },
        {
          id: "dob",
          type: "text",
          ...A(32, 58, 62, 10),
          binding: "dateOfBirth",
          fontSize: 8,
          visible: true,
        },
        {
          id: "blood",
          type: "text",
          ...A(32, 68, 62, 10),
          binding: "bloodGroup",
          fontSize: 8,
          visible: true,
        },
        { id: "qr", type: "qr", ...A(84, 70, 12, 24), visible: true },
        {
          id: "validity",
          type: "text",
          ...A(4, 88, 78, 9),
          binding: "validTill",
          fontSize: 6,
          color: "#6b7280",
          visible: true,
        },
      ],
    },
  },
  {
    id: "portrait-compact",
    name: "Portrait Compact",
    description: "54×86mm lanyard card — photo on top, QR at the back-bottom.",
    data: {
      orientation: "portrait",
      canvas: { backgroundAssetId: null },
      elements: [
        {
          id: "school",
          type: "text",
          ...A(0, 3, 100, 12),
          binding: "schoolName",
          fontSize: 9,
          fontWeight: "bold",
          align: "center",
          visible: true,
        },
        { id: "photo", type: "photo", ...A(25, 17, 50, 34), visible: true },
        {
          id: "name",
          type: "text",
          ...A(6, 54, 88, 12),
          binding: "studentName",
          fontSize: 9,
          fontWeight: "bold",
          align: "center",
          visible: true,
        },
        {
          id: "class",
          type: "text",
          ...A(6, 66, 88, 8),
          binding: "className",
          fontSize: 7,
          align: "center",
          visible: true,
        },
        {
          id: "admission",
          type: "text",
          ...A(6, 74, 88, 8),
          binding: "admissionNumber",
          fontSize: 7,
          align: "center",
          visible: true,
        },
        { id: "qr", type: "qr", ...A(62, 84, 30, 13), visible: true },
        {
          id: "valid",
          type: "text",
          ...A(6, 84, 50, 13),
          binding: "validTill",
          fontSize: 6,
          color: "#6b7280",
          visible: true,
        },
      ],
    },
  },
  {
    id: "modern-dark",
    name: "Modern Dark",
    description: "Dark band on the left, light details panel on the right.",
    data: {
      orientation: "landscape",
      canvas: { backgroundAssetId: null },
      elements: [
        { id: "photo", type: "photo", ...A(4, 18, 26, 52), visible: true },
        {
          id: "school",
          type: "text",
          ...A(38, 6, 58, 14),
          binding: "schoolName",
          fontSize: 9,
          fontWeight: "bold",
          color: "#1e3a8a",
          visible: true,
        },
        {
          id: "name",
          type: "text",
          ...A(38, 22, 58, 13),
          binding: "studentName",
          fontSize: 11,
          fontWeight: "bold",
          visible: true,
        },
        {
          id: "roll",
          type: "text",
          ...A(38, 36, 58, 9),
          binding: "rollNumber",
          fontSize: 8,
          visible: true,
        },
        {
          id: "class-section",
          type: "text",
          ...A(38, 46, 58, 9),
          binding: "className",
          fontSize: 8,
          visible: true,
        },
        {
          id: "blood",
          type: "text",
          ...A(38, 56, 58, 9),
          binding: "bloodGroup",
          fontSize: 8,
          visible: true,
        },
        {
          id: "phone-guardian",
          type: "text",
          ...A(38, 66, 58, 9),
          binding: "guardianName",
          fontSize: 7,
          color: "#374151",
          visible: true,
        },
        { id: "qr", type: "qr", ...A(38, 76, 18, 18), visible: true },
        {
          id: "validity",
          type: "text",
          ...A(58, 80, 38, 10),
          binding: "validTill",
          fontSize: 6,
          color: "#6b7280",
          align: "right",
          visible: true,
        },
      ],
    },
  },
  {
    id: "minimal-lines",
    name: "Minimal Lines",
    description: "Type-first: no photo frame box, generous whitespace.",
    data: {
      orientation: "landscape",
      canvas: { backgroundAssetId: null },
      elements: [
        {
          id: "school",
          type: "text",
          ...A(4, 5, 70, 12),
          binding: "schoolName",
          fontSize: 8,
          fontWeight: "bold",
          color: "#111827",
          visible: true,
        },
        {
          id: "name",
          type: "text",
          ...A(4, 22, 60, 16),
          binding: "studentName",
          fontSize: 13,
          fontWeight: "bold",
          visible: true,
        },
        {
          id: "class-line",
          type: "text",
          ...A(4, 40, 60, 9),
          binding: "className",
          fontSize: 8,
          color: "#374151",
          visible: true,
        },
        {
          id: "admission",
          type: "text",
          ...A(4, 50, 60, 9),
          binding: "admissionNumber",
          fontSize: 8,
          color: "#374151",
          visible: true,
        },
        {
          id: "dob",
          type: "text",
          ...A(4, 60, 60, 9),
          binding: "dateOfBirth",
          fontSize: 8,
          color: "#374151",
          visible: true,
        },
        {
          id: "blood",
          type: "text",
          ...A(4, 70, 60, 9),
          binding: "bloodGroup",
          fontSize: 8,
          color: "#374151",
          visible: true,
        },
        {
          id: "address",
          type: "text",
          ...A(4, 80, 70, 14),
          binding: "address",
          fontSize: 6,
          color: "#6b7280",
          visible: true,
        },
        { id: "photo", type: "photo", ...A(66, 14, 20, 46), visible: true },
        { id: "qr", type: "qr", ...A(76, 66, 18, 28), visible: true },
      ],
    },
  },
  {
    id: "guardian-emphasis",
    name: "Guardian Emphasis",
    description: "Emergency-first: guardian and mother lines get the space.",
    data: {
      orientation: "landscape",
      canvas: { backgroundAssetId: null },
      elements: [
        {
          id: "school",
          type: "text",
          ...A(0, 0, 100, 14),
          binding: "schoolName",
          fontSize: 9,
          fontWeight: "bold",
          align: "center",
          visible: true,
        },
        { id: "photo", type: "photo", ...A(3, 18, 22, 60), visible: true },
        {
          id: "name",
          type: "text",
          ...A(28, 18, 50, 12),
          binding: "studentName",
          fontSize: 9,
          fontWeight: "bold",
          visible: true,
        },
        {
          id: "class",
          type: "text",
          ...A(28, 30, 50, 9),
          binding: "className",
          fontSize: 7,
          visible: true,
        },
        {
          id: "admission",
          type: "text",
          ...A(28, 39, 50, 9),
          binding: "admissionNumber",
          fontSize: 7,
          visible: true,
        },
        {
          id: "guardian",
          type: "text",
          ...A(3, 66, 60, 10),
          binding: "guardianName",
          fontSize: 8,
          fontWeight: "bold",
          visible: true,
        },
        {
          id: "mother",
          type: "text",
          ...A(3, 76, 60, 10),
          binding: "motherName",
          fontSize: 8,
          visible: true,
        },
        {
          id: "blood",
          type: "text",
          ...A(3, 88, 30, 9),
          binding: "bloodGroup",
          fontSize: 7,
          color: "#b91c1c",
          fontWeight: "bold",
          visible: true,
        },
        { id: "qr", type: "qr", ...A(82, 64, 14, 32), visible: true },
      ],
    },
  },
];
