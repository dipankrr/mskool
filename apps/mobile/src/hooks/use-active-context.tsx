import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { trpc } from "../lib/trpc";
import { useMe } from "./use-me";
import type { Me } from "./use-me";

/**
 * Organization → granted branch → academic year (Step 1).
 *
 * Persisted ids are convenience only: every new session revalidates them
 * against `me` and drops anything the grants no longer contain — a revoked
 * grant must never poison addressing. Sign-in/out clears both cache and
 * persisted context (see use-session-boundary).
 *
 * The year comes from `academic.year.list`, NOT `year.current`: the strict
 * `current` procedure demands the caller COVER the school node, and a
 * class/section-scoped teacher does not — it would 403 for exactly the
 * persona this app ships to first (same reasoning as web's
 * active-context.tsx). The permissive list clips to the caller's grants and
 * `isCurrent` names the branch's running session.
 *
 * The session the screens work in is the one the person chose, else the
 * running one (ADR-066, superseding ADR-047's "no year in the shell" — same
 * as web's picker). Only a holder of `academic_year:read_history` is offered
 * other sessions; for everyone else the list already holds the running one
 * only. A chosen id is persisted like the branch and dropped when it is no
 * longer in the branch's list (another branch's, or history revoked), so a
 * stale id never reaches the server. Switching org or branch clears it.
 */
const ORG_KEY = "mskool.active-org";
const SCHOOL_KEY = "mskool.active-school";
const YEAR_KEY = "mskool.active-year";

export type AcademicYear = inferRouterOutputs<AppRouter>["academic"]["year"]["list"][number];
export type Branch = Me["memberships"][number]["schools"][number];

type ActiveContextValue = {
  organizationId: string | null;
  schoolId: string | null;
  /** Every branch the active org grants, ordered by the server (name). */
  branches: Branch[];
  /**
   * The session every screen works in: the chosen one, else the branch's
   * running one. Null while unset, unreadable or loading.
   */
  academicYear: AcademicYear | null;
  /** The branch's running session (`isCurrent`), whatever is chosen. */
  currentYear: AcademicYear | null;
  /** The active branch's sessions the caller may see, newest first. */
  years: AcademicYear[];
  /** Picks the session to view; null goes back to the running one. */
  selectYear: (academicYearId: string | null) => void;
  /** True while the session list is genuinely in flight for a resolved org. */
  yearPending: boolean;
  /** True when the session list failed; the caller offers a retry. */
  yearError: boolean;
  /** Reloads the session list (the More screen's retry). */
  retryYears: () => void;
  /** True once `me` has settled (data or honest error) — guards wait for this. */
  ready: boolean;
  select: (organizationId: string, schoolId: string) => void;
  clear: () => void;
};

const ActiveContext = createContext<ActiveContextValue>({
  organizationId: null,
  schoolId: null,
  branches: [],
  academicYear: null,
  currentYear: null,
  years: [],
  selectYear: () => {},
  yearPending: false,
  yearError: false,
  retryYears: () => {},
  ready: false,
  select: () => {},
  clear: () => {},
});

export function useActiveContext() {
  return useContext(ActiveContext);
}

/**
 * The active branch's name, read from the settled `me` grants — the same data
 * `school.list` would return, with no second fetch and no loading flash.
 */
export function useActiveBranchName(): string | null {
  const { me } = useMe();
  const { organizationId, schoolId } = useActiveContext();
  const membership = me?.memberships.find(
    (m) => m.organization.id === organizationId,
  );
  return membership?.schools.find((s) => s.id === schoolId)?.name ?? null;
}

/**
 * The line under a screen's heading: the branch's name, only when the person
 * has more than one branch to tell apart, and the session's name, only when it
 * is not the running one. A single-school admin doesn't need their own school
 * repeated on every screen, and the running session needs no label; a past
 * one does, so nobody reads last year's numbers as this year's.
 */
export function useBranchMeta(): string | null {
  const name = useActiveBranchName();
  const { branches, academicYear, currentYear } = useActiveContext();
  // Session first: a long branch name truncates, and the session is the part
  // that must not be cut off.
  const parts = [
    academicYear && academicYear.id !== currentYear?.id ? academicYear.name : null,
    branches.length > 1 ? name : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The active organization's name, from the same settled membership data. */
export function useActiveOrganizationName(): string | null {
  const { me } = useMe();
  const { organizationId } = useActiveContext();
  return (
    me?.memberships.find((m) => m.organization.id === organizationId)
      ?.organization.name ?? null
  );
}

export function ActiveContextProvider({ children }: { children: ReactNode }) {
  const { me, isFetched } = useMe();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [chosenYearId, setChosenYearId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Resolve defaults on each new identity: persisted ids when still granted,
  // else first org → first granted branch.
  useEffect(() => {
    if (!isFetched) return;
    let cancelled = false;
    (async () => {
      const memberships = me?.memberships ?? [];
      const [storedOrg, storedSchool, storedYear] = await Promise.all([
        AsyncStorage.getItem(ORG_KEY),
        AsyncStorage.getItem(SCHOOL_KEY),
        AsyncStorage.getItem(YEAR_KEY),
      ]);
      if (cancelled) return;

      const org =
        memberships.find((m) => m.organization.id === storedOrg) ??
        memberships[0] ??
        null;
      const school =
        org?.schools.find((s) => s.id === storedSchool) ?? org?.schools[0] ?? null;

      setOrganizationId(org?.organization.id ?? null);
      setSchoolId(school?.id ?? null);
      // Kept only if the branch it belonged to is still the one resolved;
      // the list check below drops it otherwise.
      setChosenYearId(school && school.id === storedSchool ? storedYear : null);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [me, isFetched]);

  /**
   * The org's sessions, fetched once and narrowed to the active branch below.
   *
   * `schoolId` is deliberately NOT in the input: the permissive list returns
   * every session the caller's grants cover, and keeping it out of the query
   * key means a branch switch resolves the new year from data already in hand
   * instead of flashing a loading state. The `schoolId` filter in `useMemo` is
   * what makes the active-year pick branch-correct.
   */
  const yearQuery = trpc.academic.year.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: hydrated && Boolean(organizationId),
      // A reference list: the year changes at most between sessions.
      staleTime: 300_000,
    },
  );

  const branches = useMemo(() => {
    const membership = me?.memberships.find(
      (candidate) => candidate.organization.id === organizationId,
    );
    return membership?.schools ?? [];
  }, [me, organizationId]);

  // Exactly one `isCurrent` flag, or null. Two flags in one branch is data
  // the app must not guess about — screens render the honest "not set" state
  // instead of silently picking one.
  const years = useMemo(
    () =>
      (yearQuery.data ?? [])
        .filter((row) => !schoolId || row.schoolId === schoolId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [yearQuery.data, schoolId],
  );

  const currentYear = useMemo(() => {
    const flagged = years.filter((row) => row.isCurrent);
    return flagged.length === 1 ? (flagged[0] ?? null) : null;
  }, [years]);

  const academicYear = useMemo(() => {
    const chosen = chosenYearId
      ? years.find((row) => row.id === chosenYearId)
      : undefined;
    return chosen ?? currentYear;
  }, [years, chosenYearId, currentYear]);

  const yearPending = Boolean(organizationId) && yearQuery.isPending;
  const yearError = yearQuery.isError;
  const { refetch: refetchYears } = yearQuery;
  const retryYears = useCallback(() => {
    void refetchYears();
  }, [refetchYears]);

  const select = useCallback((orgId: string, schoolId: string) => {
    setOrganizationId(orgId);
    setSchoolId(schoolId);
    // Sessions are per branch: a chosen one means nothing in another.
    setChosenYearId(null);
    void Promise.all([
      AsyncStorage.setItem(ORG_KEY, orgId),
      AsyncStorage.setItem(SCHOOL_KEY, schoolId),
      AsyncStorage.removeItem(YEAR_KEY),
    ]);
  }, []);

  const selectYear = useCallback((academicYearId: string | null) => {
    setChosenYearId(academicYearId);
    void (academicYearId
      ? AsyncStorage.setItem(YEAR_KEY, academicYearId)
      : AsyncStorage.removeItem(YEAR_KEY));
  }, []);

  const clear = useCallback(() => {
    setOrganizationId(null);
    setSchoolId(null);
    setChosenYearId(null);
    setHydrated(false);
    void Promise.all([
      AsyncStorage.removeItem(ORG_KEY),
      AsyncStorage.removeItem(SCHOOL_KEY),
      AsyncStorage.removeItem(YEAR_KEY),
    ]);
  }, []);

  const value = useMemo(
    () => ({
      organizationId,
      schoolId,
      branches,
      academicYear,
      currentYear,
      years,
      selectYear,
      yearPending,
      yearError,
      retryYears,
      ready: hydrated,
      select,
      clear,
    }),
    [
      organizationId,
      schoolId,
      branches,
      academicYear,
      currentYear,
      years,
      selectYear,
      yearPending,
      yearError,
      retryYears,
      hydrated,
      select,
      clear,
    ],
  );

  return <ActiveContext.Provider value={value}>{children}</ActiveContext.Provider>;
}
