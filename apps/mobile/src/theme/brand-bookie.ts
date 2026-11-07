/**
 * Bookie's colours, the mskool mascot. Lifted from `brand/bookie/mascot.svg`
 * (the brand pack is the source of truth): change them there first, then
 * here. Shared by the staff and family shells, so they sit apart from
 * `brand-admin.ts` and never feed status meaning.
 */
export const bookie = {
  /** The book body. */
  body: "#2F6BFF",
  /** The page edge below the body and the spine line. */
  depth: "#1C3FB0",
  /** Pupils and the smile. */
  ink: "#0E1A4F",
  /** Eye whites, catchlights and the sticker outline. */
  white: "#FFFFFF",
} as const;
