"use client";

import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * THE LIFECYCLE TRACK — the exam detail page's signature element.
 *
 * An exam is a seven-state walk (draft → scheduled → ongoing → marks
 * entry → verification → published → locked), and the page's single job
 * is answering "where are we, what's next?" The track makes the walk
 * visible: done states carry their check, the current state is filled
 * and labeled, the future is quiet. The transition BUTTONS stay beside
 * it — the track is the map, the buttons are the legs.
 *
 * Purely presentational; the states' order is the service's TRANSITIONS
 * map, mirrored (the server remains the referee).
 */

const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "scheduled", label: "Scheduled" },
  { key: "ongoing", label: "Ongoing" },
  { key: "marks_entry", label: "Marks entry" },
  { key: "under_verification", label: "Verification" },
  { key: "published", label: "Published" },
  { key: "locked", label: "Locked" },
] as const;

export function ExamLifecycleTrack({ status }: { status: string }) {
  const currentIndex = STEPS.findIndex((s) => s.key === status);

  return (
    <ol
      aria-label="Exam progress"
      className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm"
    >
      {STEPS.map((step, index) => {
        const done = currentIndex > index;
        const current = currentIndex === index;
        return (
          <li key={step.key} className="flex items-center gap-1">
            {index > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "mx-1 h-px w-4 sm:w-6",
                  done ? "bg-primary/40" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1",
                current && "bg-primary text-primary-foreground font-medium",
                done && "text-foreground",
                !done && !current && "text-muted-foreground",
              )}
              aria-current={current ? "step" : undefined}
            >
              {done ? (
                <CheckIcon aria-hidden className="size-3.5" />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    current ? "bg-primary-foreground" : "bg-muted-foreground/50",
                  )}
                />
              )}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The status badge's variant per state — the track shows POSITION, the
 * badge carries COLOR at a glance (lists, cards, the hub). Text always
 * names the state, so color is never the only signal.
 */
export function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "published":
      return "secondary";
    case "locked":
      return "destructive";
    case "marks_entry":
    case "under_verification":
      return "default";
    default:
      return "outline";
  }
}
