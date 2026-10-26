import { useMemo } from "react";

import { trpc } from "../../lib/trpc";

import type { PaperDraft } from "../../lib/exam-draft";
import { partitionBySection } from "../../lib/exams";
import type { RosterStudent } from "./types";
import { useSectionByStudent, useVerifyMutations } from "./use-verification";

/** Why the verify scope is (not yet) known. */
export type ScopeState =
  | "ready"
  | "loading"
  | "needsSection"
  | "unknown";

export type ReviewScope = {
  state: ScopeState;
  /** The section a batch is addressed with; null until one is known. */
  sectionId: string | null;
  /** The students a Verify tap may include (the section's, plus sectionless). */
  students: RosterStudent[];
  /** True when `students` is a strict part of the roster. */
  partitioned: boolean;
  /** Students with no section who ride along in any section's batch. */
  sectionless: number;
  /** Each student's own section, when the enrollment read is available. */
  sectionOf: (studentId: string) => string | null;
};

/**
 * Whom a verify batch may contain.
 *
 * A section paper is its section: the whole roster. A class-wide paper is
 * verified section by section, so the roster is partitioned by the section the
 * reviewer is verifying — which needs one enrollment read of the class, because
 * the entry grid does not say which section each student sits in. With a single
 * visible section the partition adds nothing and is skipped (every student is
 * in it, or in none).
 */
export function useReviewScope(args: {
  enabled: boolean;
  paper: { classId: string; sectionId: string | null } | null;
  roster: RosterStudent[];
  effectiveSection: string | null;
  sectionCount: number;
}): ReviewScope {
  const { enabled, paper, roster, effectiveSection, sectionCount } = args;
  const classWide = Boolean(paper) && !paper?.sectionId;
  const needsPartition = enabled && classWide && sectionCount > 1;
  const enrollments = useSectionByStudent(paper?.classId ?? null, needsPartition);

  const sectionId = paper?.sectionId ?? effectiveSection;

  return useMemo<ReviewScope>(() => {
    const sectionOf = (studentId: string) =>
      enrollments.sectionByStudent?.get(studentId) ?? null;
    if (!enabled || !paper) {
      return { state: "ready", sectionId, students: roster, partitioned: false, sectionless: 0, sectionOf };
    }
    if (!sectionId) {
      return { state: "needsSection", sectionId: null, students: [], partitioned: false, sectionless: 0, sectionOf };
    }
    if (!needsPartition) {
      return { state: "ready", sectionId, students: roster, partitioned: false, sectionless: 0, sectionOf };
    }
    if (enrollments.pending) {
      return { state: "loading", sectionId, students: [], partitioned: false, sectionless: 0, sectionOf };
    }
    if (!enrollments.sectionByStudent) {
      return { state: "unknown", sectionId, students: [], partitioned: false, sectionless: 0, sectionOf };
    }
    const split = partitionBySection(roster, enrollments.sectionByStudent, sectionId);
    return {
      state: "ready",
      sectionId,
      students: split.inScope,
      partitioned: split.outOfScope.length > 0,
      sectionless: split.sectionless,
      sectionOf,
    };
  }, [enabled, paper, roster, sectionId, needsPartition, enrollments.pending, enrollments.sectionByStudent]);
}

export type ReviewActions = {
  /** Verify rows of one paper + section; merges the returned rows into the draft. */
  verify: (args: { rowIds: string[]; sectionId: string; subjectId: string }) => Promise<void>;
  /** Reopen verified rows; merges the returned rows into the draft. */
  unverify: (args: { rowIds: string[]; sectionId: string; subjectId: string }) => Promise<void>;
};

/**
 * The two writes, each followed by a `sync` of the rows the server returned so
 * the seals (or their removal) appear only after the server has answered.
 * Errors are thrown to the caller, which shows them in its sheet.
 */
export function useReviewActions(draft: PaperDraft): ReviewActions {
  const mutations = useVerifyMutations();
  const utils = trpc.useUtils();
  // The hub's class and per-paper counts read these; both just changed.
  const refreshCounts = () =>
    Promise.all([
      utils.exam.eligibility.readiness.invalidate(),
      utils.exam.marks.entry.invalidate(),
    ]);
  return {
    verify: async (args) => {
      const rows = await mutations.verify(args);
      draft.sync(rows);
      void refreshCounts();
    },
    unverify: async (args) => {
      const rows = await mutations.unverify(args);
      draft.sync(rows);
      void refreshCounts();
    },
  };
}
