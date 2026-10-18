import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { trpc } from "../lib/trpc";
import { useMe } from "./use-me";

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
 * `isCurrent` names the session to use. Derived, never stored: a branch
 * switch re-resolves it on the next render.
 */
const ORG_KEY = "mskool.active-org";
const SCHOOL_KEY = "mskool.active-school";

export type AcademicYear = inferRouterOutputs<AppRouter>["academic"]["year"]["list"][number];

type ActiveContextValue = {
  organizationId: string | null;
  schoolId: string | null;
  /** The active branch's current session; null while unset, unreadable or loading. */
  academicYear: AcademicYear | null;
  /** True while the session list is genuinely in flight for a resolved org. */
  yearPending: boolean;
  /** True once `me` has settled (data or honest error) — guards wait for this. */
  ready: boolean;
  select: (organizationId: string, schoolId: string) => void;
  clear: () => void;
};

const ActiveContext = createContext<ActiveContextValue>({
  organizationId: null,
  schoolId: null,
  academicYear: null,
  yearPending: false,
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

export function ActiveContextProvider({ children }: { children: ReactNode }) {
  const { me, isFetched } = useMe();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Resolve defaults on each new identity: persisted ids when still granted,
  // else first org → first granted branch.
  useEffect(() => {
    if (!isFetched) return;
    let cancelled = false;
    (async () => {
      const memberships = me?.memberships ?? [];
      const [storedOrg, storedSchool] = await Promise.all([
        AsyncStorage.getItem(ORG_KEY),
        AsyncStorage.getItem(SCHOOL_KEY),
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
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [me, isFetched]);

  const yearQuery = trpc.academic.year.list.useQuery(
    { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) },
    {
      enabled: hydrated && Boolean(organizationId),
      // A reference list: the year changes at most between sessions.
      staleTime: 300_000,
    },
  );

  // Exactly one `isCurrent` flag, or null. Two flags in one branch is data
  // the app must not guess about — screens render the honest "not set" state
  // instead of silently picking one.
  const academicYear = useMemo(() => {
    const rows = (yearQuery.data ?? []).filter(
      (row) => !schoolId || row.schoolId === schoolId,
    );
    const flagged = rows.filter((row) => row.isCurrent);
    return flagged.length === 1 ? (flagged[0] ?? null) : null;
  }, [yearQuery.data, schoolId]);

  const yearPending = Boolean(organizationId) && yearQuery.isPending;

  const select = useCallback((orgId: string, schoolId: string) => {
    setOrganizationId(orgId);
    setSchoolId(schoolId);
    void Promise.all([
      AsyncStorage.setItem(ORG_KEY, orgId),
      AsyncStorage.setItem(SCHOOL_KEY, schoolId),
    ]);
  }, []);

  const clear = useCallback(() => {
    setOrganizationId(null);
    setSchoolId(null);
    setHydrated(false);
    void Promise.all([
      AsyncStorage.removeItem(ORG_KEY),
      AsyncStorage.removeItem(SCHOOL_KEY),
    ]);
  }, []);

  const value = useMemo(
    () => ({
      organizationId,
      schoolId,
      academicYear,
      yearPending,
      ready: hydrated,
      select,
      clear,
    }),
    [organizationId, schoolId, academicYear, yearPending, hydrated, select, clear],
  );

  return <ActiveContext.Provider value={value}>{children}</ActiveContext.Provider>;
}
