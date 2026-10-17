import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useMe } from "./use-me";

/**
 * Organization → granted branch context (Step 0). Academic-year resolution
 * lands with Step 1 (academic.year.*); until then screens address staff calls
 * with organizationId + schoolId from here.
 *
 * Persisted ids are convenience only: every new session revalidates them
 * against `me` and drops anything the grants no longer contain — a revoked
 * grant must never poison addressing. Sign-in/out clears both cache and
 * persisted context (see use-session-boundary).
 */
const ORG_KEY = "mskool.active-org";
const SCHOOL_KEY = "mskool.active-school";

type ActiveContextValue = {
  organizationId: string | null;
  schoolId: string | null;
  /** True once `me` has settled (data or honest error) — guards wait for this. */
  ready: boolean;
  select: (organizationId: string, schoolId: string) => void;
  clear: () => void;
};

const ActiveContext = createContext<ActiveContextValue>({
  organizationId: null,
  schoolId: null,
  ready: false,
  select: () => {},
  clear: () => {},
});

export function useActiveContext() {
  return useContext(ActiveContext);
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
    () => ({ organizationId, schoolId, ready: hydrated, select, clear }),
    [organizationId, schoolId, hydrated, select, clear],
  );

  return <ActiveContext.Provider value={value}>{children}</ActiveContext.Provider>;
}
