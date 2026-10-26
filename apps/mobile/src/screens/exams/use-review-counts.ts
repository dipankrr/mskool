import { trpc } from "../../lib/trpc";
import { useExamScope } from "./use-exam-data";
import type { EntryGrid, ExamPaper } from "./types";

export type PaperCounts = {
  /** Cells the paper expects: roster × components. */
  expected: number;
  /** Cells with any value (everything but `draft`, verified included). */
  entered: number;
  verified: number;
};

/** Verified or sealed past verification. */
function isDone(status: string): boolean {
  return status === "verified" || status === "published" || status === "locked";
}

/** Reduce a whole entry grid to the three numbers a hub card needs. */
export function countsOf(grid: EntryGrid | null): PaperCounts | null {
  if (!grid) return null;
  let entered = 0;
  let verified = 0;
  for (const entry of grid.entries) {
    if (entry.resultStatus !== "draft") entered += 1;
    if (isDone(entry.resultStatus)) verified += 1;
  }
  return {
    expected: grid.roster.length * grid.components.length,
    entered,
    verified,
  };
}

/**
 * The class's review progress in ONE read (`eligibility.readiness`): expected,
 * entered and verified cells across every paper of the class. The publish
 * facts it also carries belong to a later chunk.
 */
export function useClassReadiness(
  examId: string,
  classId: string | null,
  enabled: boolean,
) {
  const scope = useExamScope();
  return trpc.exam.eligibility.readiness.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: examId,
      classId: classId ?? "",
    },
    {
      enabled: enabled && scope.ready && Boolean(scope.organizationId) && Boolean(classId),
      staleTime: 30_000,
    },
  );
}

/**
 * Per-paper counts for a reviewer's hub: one `marks.entry` read per paper of
 * the active class, reduced to counts at the source (`select`) so the cache
 * holds the numbers this screen renders from. Reviewers only, entry stages
 * only (the caller decides): a teacher's hub never pays for these.
 */
export function usePaperCounts(
  examId: string,
  papers: readonly ExamPaper[],
  enabled: boolean,
): { counts: ReadonlyMap<string, PaperCounts | null>; pending: boolean } {
  const scope = useExamScope();
  const results = trpc.useQueries((t) =>
    papers.map((paper) =>
      t.exam.marks.entry(
        {
          organizationId: scope.organizationId ?? "",
          ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
          examId,
          id: paper.id,
          // A section paper's own section: the same key the paper screen
          // uses, so opening it finds a warm cache.
          ...(paper.sectionId ? { sectionId: paper.sectionId } : {}),
        },
        {
          enabled: enabled && scope.ready && Boolean(scope.organizationId),
          staleTime: 30_000,
          select: countsOf,
        },
      ),
    ),
  );

  const counts = new Map<string, PaperCounts | null>();
  papers.forEach((paper, index) => {
    const data = results[index]?.data;
    if (data !== undefined) counts.set(paper.id, data);
  });
  return { counts, pending: results.some((query) => query.isPending) && enabled };
}
