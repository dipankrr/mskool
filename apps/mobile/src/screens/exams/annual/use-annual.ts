import { useMemo } from "react";

import { trpc } from "../../../lib/trpc";
import type { AnnualPayload, TermLite } from "../../../lib/annual";
import { useClassSubjectNames, useExamScope } from "../use-exam-data";

/**
 * ANNUAL RESULTS (chunk 7G, ADR-053) - reads and writes for the year-end
 * screens. The server owns every number; these hooks only fetch, invalidate
 * and surface the server's refusal intact (no optimistic writes: a generate
 * or a publish is rare and its refusal is an instruction).
 *
 * Reads are enabled only with a branch AND the running session: the year is
 * the unit, and an org-wide read would mix campuses.
 */

const CONFIG_STALE = 60_000;
const LIVE_STALE = 15_000;

function useArgs() {
  const scope = useExamScope();
  return {
    scope,
    args: {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    },
    yearId: scope.academicYear?.id ?? "",
    ready:
      scope.ready &&
      Boolean(scope.organizationId) &&
      Boolean(scope.schoolId) &&
      Boolean(scope.academicYear?.id),
  };
}

export function useAnnualPolicies() {
  const { scope, args, yearId, ready } = useArgs();
  return trpc.exam.annual.policies.list.useQuery(
    { ...args, academicYearId: yearId },
    { enabled: ready && scope.canRead, staleTime: CONFIG_STALE },
  );
}

/** The session's terms, in report-card order - what a rule can pick from. */
export function useYearTerms() {
  const { scope, yearId, ready } = useArgs();
  const query = trpc.academic.term.list.useQuery(
    { organizationId: scope.organizationId ?? "", academicYearId: yearId },
    { enabled: ready && scope.canRead, staleTime: CONFIG_STALE },
  );
  const terms = useMemo<TermLite[]>(
    () =>
      [...(query.data ?? [])]
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
        .map((t) => ({ id: t.id, name: t.name, sequenceNumber: t.sequenceNumber })),
    [query.data],
  );
  return { query, terms };
}

export function useAnnualPolicyActions() {
  const { args } = useArgs();
  const utils = trpc.useUtils();
  const refresh = async () => {
    await Promise.all([
      utils.exam.annual.policies.list.invalidate(),
      utils.exam.annual.readiness.invalidate(),
      utils.exam.annual.overview.invalidate(),
    ]);
  };
  const save = trpc.exam.annual.policies.save.useMutation({ onSuccess: () => void refresh() });
  return {
    save: (payload: AnnualPayload) =>
      save.mutateAsync({ ...args, ...payload } as Parameters<typeof save.mutateAsync>[0]),
    pending: save.isPending,
  };
}

export function useAnnualOverview() {
  const { scope, args, yearId, ready } = useArgs();
  return trpc.exam.annual.overview.useQuery(
    { ...args, academicYearId: yearId },
    { enabled: ready && scope.canRead, staleTime: LIVE_STALE },
  );
}

export function useAnnualReadiness(classId: string) {
  const { scope, args, yearId, ready } = useArgs();
  return trpc.exam.annual.readiness.useQuery(
    { ...args, academicYearId: yearId, classId },
    { enabled: ready && scope.canRead && Boolean(classId), staleTime: LIVE_STALE },
  );
}

export function useAnnualTable(classId: string) {
  const { scope, args, yearId, ready } = useArgs();
  return trpc.exam.annual.table.useQuery(
    { ...args, academicYearId: yearId, classId },
    { enabled: ready && scope.canRead && Boolean(classId), staleTime: LIVE_STALE },
  );
}

export function useAnnualCard(classId: string, studentId: string) {
  const { scope, args, yearId, ready } = useArgs();
  return trpc.exam.annual.card.useQuery(
    { ...args, academicYearId: yearId, classId, studentId },
    {
      enabled: ready && scope.canReadCards && Boolean(classId) && Boolean(studentId),
      staleTime: LIVE_STALE,
    },
  );
}

export function useAnnualClassActions(classId: string) {
  const { args, yearId } = useArgs();
  const utils = trpc.useUtils();
  const refresh = async () => {
    await Promise.all([
      utils.exam.annual.readiness.invalidate(),
      utils.exam.annual.table.invalidate(),
      utils.exam.annual.overview.invalidate(),
      utils.exam.annual.card.invalidate(),
    ]);
  };
  const generate = trpc.exam.annual.generate.useMutation({ onSettled: () => void refresh() });
  const publish = trpc.exam.annual.publishClass.useMutation({ onSettled: () => void refresh() });
  const input = { ...args, academicYearId: yearId, classId };
  return {
    generate: () => generate.mutateAsync(input),
    publish: () => publish.mutateAsync(input),
    generating: generate.isPending,
    publishing: publish.isPending,
  };
}

/** Class and subject names + the class order the lists use. */
export function useAnnualNames() {
  return useClassSubjectNames();
}
