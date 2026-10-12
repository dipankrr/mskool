"use client";

import { Input } from "@/components/ui/input";

/**
 * THE YOUTUBE ID FIELD. The contract stores a bare 11-character video id
 * (`videoId`, max 20 — a full watch URL fails validation with a cryptic
 * section-level error), but every human pastes the link. So this field
 * accepts a bare id, a youtu.be share link, or a youtube.com watch/embed/
 * shorts URL, and stores the extracted id immediately. Anything else is
 * stored raw so validation — not silence — answers.
 */

const BARE_ID = /^[A-Za-z0-9_-]{11}$/;
const URL_ID = /(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function extractVideoId(raw: string): string | null {
  const value = raw.trim();
  if (BARE_ID.test(value)) return value;
  const m = value.match(URL_ID);
  return m?.[1] ?? null;
}

export function VideoIdField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const valid = BARE_ID.test(value.trim());

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          const id = extractVideoId(raw);
          // A pasted link collapses to its id on the spot; anything else
          // passes through so the contract (not an empty box) judges it.
          onChange(id ?? raw);
        }}
        placeholder="YouTube video ID or link — e.g. dQw4w9WgXcQ"
        className="font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        {valid ? (
          <>
            Video:{" "}
            <a
              href={`https://www.youtube.com/watch?v=${value.trim()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[var(--site-accent)] hover:underline"
            >
              watch on YouTube
            </a>
          </>
        ) : value.trim() === "" ? (
          "Empty shows no video. Paste a link or an 11-character ID."
        ) : (
          "Not a recognizable YouTube ID or link — saving will refuse it."
        )}
      </p>
    </div>
  );
}
