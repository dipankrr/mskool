import { Skeleton } from "@/components/ui/skeleton";

/**
 * What a list looks like while it loads.
 *
 * Skeletons rather than a spinner, and the reason is specific to this deployment:
 * the database is Neon, which cold-starts in roughly half a second after an idle
 * period. A centred spinner for that long reads as a hang, while a skeleton in the
 * shape of the incoming content reads as "nearly there" — and it keeps the page's
 * height stable, so the layout does not jump when rows arrive.
 *
 * Mirrors `DataTable`'s own switch: card-shaped blocks below 768px, rows above.
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  const items = Array.from({ length: rows }, (_, index) => index);

  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      {/* Phones: one card per row. */}
      <div className="flex flex-col gap-3 md:hidden">
        {items.map((item) => (
          <div key={item} className="flex flex-col gap-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Desktop: a header strip and rows. */}
      <div className="hidden flex-col gap-2 rounded-lg border p-4 md:flex">
        <Skeleton className="h-4 w-32" />
        {items.map((item) => (
          <Skeleton key={item} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
