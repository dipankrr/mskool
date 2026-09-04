"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One consistent filter row for the fees area: wrapping flex, bottom
 * alignment so labels + controls + buttons sit on one line. Every filter
 * control on a fees screen lives in a FilterField — visible label on top,
 * control below — never an aria-only label on a box a clerk must read.
 */
export function FilterRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end gap-3", className)}>{children}</div>;
}

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
