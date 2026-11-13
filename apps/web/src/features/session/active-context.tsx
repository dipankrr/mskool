"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/lib/copy";
import { errorMessage, toFriendlyError } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
// Type-only, per the CONVENTIONS.md sanction: a type has no runtime, so nothing
// from @repo/authz reaches the browser bundle.
import type { Permission } from "@repo/authz";
// Wire shapes, not contract shapes: `createdAt` is a string here. See the note in
// that file — the two differ because this client has no superjson transformer.
import type {
  AcademicYear,
  Me,
  Membership,
  OrgScopeArgs,
  School,
  StaffScopeArgs,
  WriteScopeArgs,
} from "@/lib/trpc/types";
import { useMe } from "./use-me";

/**
 * WHICH ORGANIZATION, WHICH BRANCH, WHICH SESSION — resolved once, for everything.
 *
 * Every staff call names the org AND the branch (ADR-067). The list builder clips the
 * caller's grants to that branch, so an org admin sees one branch's rows rather than
 * every branch's, and a class teacher sees what their grant reaches inside it. Only
 * the org-wide lists (branches, roles) send the org alone. `scopeArgs()`,
 * `orgScopeArgs()` and `writeScopeArgs()` are those answers, so no screen has to
 * remember which one it needs.
 *
 * **There is always a branch when the user can see one:** the last one chosen on this
 * device, else their home branch (`homeSchoolId`, from their staff record), else the
 * first by name. With none visible, `ActiveContextGate` explains it instead of
 * rendering branch screens.
 *
 * **The session comes from `academic.year.list`, not `academic.year.current`.**
 * `current` is a strict `staffProcedure`, so a class teacher, whose grant does not
 * cover the school node, would get a 403. The permissive list returns the rows their
 * grant reaches, and is the same query the session picker needs anyway.
 *
 * **Persisted selections are validated, never trusted.** A branch id left in
 * localStorage after the grant was revoked would make every subsequent call fail
 * authorization, with no clue why. Anything absent from the `me` response is
 * dropped on load.
 */

const STORAGE_KEY = "mskool.active-context.v1";

/** Keep the query cheap; it is read by the shell on every navigation. */
const ONE_MINUTE = 60 * 1000;

const NO_SESSIONS: AcademicYear[] = [];

type StoredContext = {
  organizationId?: string;
  schoolId?: string;
  academicYearId?: string;
};

/**
 * Reads the persisted selection, defensively.
 *
 * Every failure mode here is normal rather than exceptional: localStorage throws
 * outright in some private-browsing modes, the value may be JSON written by an
 * older version of this app, and a user can edit it by hand. All of them mean the
 * same thing — no usable selection — so all of them return `{}` and let the
 * resolution below pick sensible defaults.
 */
function readStoredContext(): StoredContext {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const fields = parsed as Record<string, unknown>;
    const text = (value: unknown) =>
      typeof value === "string" && value.length > 0 ? value : undefined;

    return {
      organizationId: text(fields.organizationId),
      schoolId: text(fields.schoolId),
      academicYearId: text(fields.academicYearId),
    };
  } catch {
    return {};
  }
}

function writeStoredContext(next: StoredContext): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage being unavailable costs the user their selection between visits,
    // which is a small annoyance and not worth breaking a render over.
  }
}

/**
 * Stable ordering, because the default selection is "the first one".
 *
 * `getMemberships` and `listSchools` make no ordering promise, so without this an
 * admin with two branches could land in a different one on each load. Sorting by
 * name makes the default deterministic and matches how the switcher lists them.
 */
function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The persisted org if the caller still has a role in it, else the only one, else
 * the first. Defaulting rather than demanding a choice is deliberate: nothing here
 * is destructive, the active org is named in the shell, and a switcher is one tap
 * away — whereas a blank screen asking an unanswerable question is a dead end.
 */
function resolveOrganizationId(
  memberships: readonly Membership[],
  storedId: string | undefined,
): string | null {
  if (storedId && memberships.some((m) => m.organization.id === storedId)) {
    return storedId;
  }

  return memberships[0]?.organization.id ?? null;
}

/**
 * The default branch (ADR-067 point 5): the one last chosen on this device if still
 * visible, else the user's home branch from their staff record, else the first.
 *
 * This used to stop at "the only one" and leave a multi-branch admin on no branch,
 * where lists ran org-wide and mixed every branch's rows. Every list now names a
 * branch, so there is always one unless the user can see none. The active branch is
 * named in the shell and the switcher is one click away.
 */
function resolveSchoolId(
  schools: readonly School[],
  storedId: string | undefined,
  homeSchoolId: string | null | undefined,
): string | null {
  if (storedId && schools.some((s) => s.id === storedId)) return storedId;
  if (homeSchoolId && schools.some((s) => s.id === homeSchoolId)) return homeSchoolId;

  return schools[0]?.id ?? null;
}

/**
 * Pages about the organisation itself, which work without a branch. Branches must
 * stay reachable: a new org has none until its admin creates the first one there.
 */
const ORG_PAGES = ["/branches", "/roles", "/profile"];

export type ActiveContextValue = {
  me: Me;
  /** Every org this user holds a role in, ordered by name. */
  memberships: Membership[];
  /** The active org's membership. Non-null: children render only when resolved. */
  membership: Membership;

  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;

  /** Branches visible in the active org, ordered by name. */
  schools: School[];
  /** Sessions in the active org, narrowed to the active branch when one is chosen. */
  sessions: AcademicYear[];
  /** The session the user is working in. Undefined until one can be determined. */
  activeSession: AcademicYear | undefined;
  /** The branch's running session, if exactly one is identifiable. */
  currentSession: AcademicYear | undefined;
  sessionsLoading: boolean;

  /** True when a write needs a branch and the user has not picked one. */
  needsBranchChoice: boolean;
  /** `academic_year:read_history` (ADR-024) — decides whether past sessions show. */
  canSeeHistory: boolean;
  /**
   * A render hint from `me`, never a gate (ADR-017). The server re-checks every
   * call, so a tampered permission list buys a visible button and a 403.
   *
   * The argument is the real `Permission` union, so a misspelled permission in a
   * `has("school:read")` call is a compile error rather than a silently hidden
   * control.
   */
  has: (permission: Permission) => boolean;

  selectOrganization: (organizationId: string) => void;
  selectSchool: (schoolId: string | null) => void;
  selectSession: (academicYearId: string | null) => void;

  /**
   * For every staff call (ADR-067): the org and the active branch. Screens behind
   * `ActiveContextGate` always have a branch; on an org page with none, the branch
   * is empty and a branch list would be refused, which is why those pages only call
   * org-wide lists (`orgScopeArgs`).
   */
  scopeArgs: () => StaffScopeArgs;
  /** For the org-wide lists only: branches, roles and permissions. */
  orgScopeArgs: () => OrgScopeArgs;
  /** For mutations. Null means "ask the user for a branch first". */
  writeScopeArgs: () => WriteScopeArgs | null;
};

/**
 * What the shell may know before the page may render.
 *
 * Two consumers with different needs, which is why this is a state machine rather
 * than a nullable value. A **screen** requires a resolved organization — every call
 * it makes needs one — so it reads `useActiveContext()` and is not rendered until
 * `ready`. The **shell** must stay on screen throughout, including while `me.get`
 * is in flight, so it reads `useActiveContextState()` and renders skeletons in the
 * switcher slots instead of disappearing.
 *
 * That split is the whole reason the chrome does not blink on a cold start.
 */
export type ActiveContextState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  /** A valid session with no staff role: a student, or every grant revoked. */
  | { status: "no-access" }
  | { status: "ready"; value: ActiveContextValue };

const ActiveContext = createContext<ActiveContextState | null>(null);

/**
 * For screens. Guaranteed resolved, because `ActiveContextGate` does not render
 * children until it is — so `organizationId` is a string, not `string | null`, at
 * every call site in the app.
 */
export function useActiveContext(): ActiveContextValue {
  const state = useContext(ActiveContext);

  if (!state) {
    throw new Error("useActiveContext must be used inside ActiveContextProvider.");
  }

  if (state.status !== "ready") {
    throw new Error(
      "useActiveContext must be used inside ActiveContextGate, which renders its children only when the context has resolved.",
    );
  }

  return state.value;
}

/** For the shell, which renders in every state including the failures. */
export function useActiveContextState(): ActiveContextState {
  const state = useContext(ActiveContext);

  if (!state) {
    throw new Error("useActiveContextState must be used inside ActiveContextProvider.");
  }

  return state;
}

/**
 * Holds page content back until the context resolves, and explains it when it does
 * not. Mounted *inside* the shell, so the navigation, the org name and the theme
 * toggle stay usable while this shows a skeleton.
 */
export function ActiveContextGate({ children }: { children: ReactNode }) {
  const state = useActiveContextState();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();

  if (state.status === "loading") return <ContextSkeleton />;

  // No branch to open (ADR-067 point 7): every branch screen would be refused, so
  // say so once instead. Org pages still render — Branches is where a new org
  // creates its first one.
  if (
    state.status === "ready" &&
    !state.value.schoolId &&
    !ORG_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
  ) {
    return (
      <ContextMessage title={copy.access.noBranchTitle} body={copy.access.noBranchBody} />
    );
  }

  if (state.status === "error") {
    return (
      <ContextMessage
        title={copy.access.loadFailedTitle}
        body={state.message}
        onRetry={state.retry}
      />
    );
  }

  if (state.status === "no-access") {
    // A family login (ADR-007/008) is the EXPECTED no-access case, not a
    // dead end: it owns children but holds no staff role, so this console
    // is not its half of the product. Route it home to the portal instead
    // of explaining what it cannot have. A genuinely role-less staff
    // account gets the explanation.
    if (me.data?.portal) {
      router.replace("/portal/results");
      return <ContextSkeleton />;
    }
    return (
      <ContextMessage
        title={copy.access.noStaffAccessTitle}
        body={copy.access.noStaffAccessBody}
      />
    );
  }

  return <>{children}</>;
}

function ContextSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function ContextMessage({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button onClick={onRetry}>{copy.common.retry}</Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function ActiveContextProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useMe();

  /**
   * `null` means "localStorage has not been read yet", which is not the same as
   * "nothing was stored". The read happens in an effect rather than in a state
   * initialiser because the server render has no localStorage: initialising from it
   * would make the first client render disagree with the server's HTML, and React
   * would discard the tree with a hydration error.
   */
  const [stored, setStored] = useState<StoredContext | null>(null);

  useEffect(() => {
    setStored(readStoredContext());
  }, []);

  /** A selection is a merge, and always persists what it resolved to. */
  const select = useCallback((patch: StoredContext) => {
    setStored((previous) => {
      const next = { ...(previous ?? {}), ...patch };
      writeStoredContext(next);
      return next;
    });
  }, []);

  const memberships = useMemo(
    () =>
      [...(me.data?.memberships ?? [])].sort((a, b) =>
        a.organization.name.localeCompare(b.organization.name),
      ),
    [me.data],
  );

  const organizationId = resolveOrganizationId(memberships, stored?.organizationId);
  const membership = memberships.find((m) => m.organization.id === organizationId);

  const schools = useMemo(() => byName(membership?.schools ?? []), [membership]);
  const schoolId = resolveSchoolId(schools, stored?.schoolId, membership?.homeSchoolId);

  /**
   * The active branch's sessions, so that `isCurrent` identifies exactly one row.
   * The permissive builder clips a class teacher's grant to the branch it sits in.
   */
  const sessionsQuery = trpc.academic.year.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
    },
    {
      enabled: Boolean(organizationId) && Boolean(schoolId) && stored !== null,
      staleTime: ONE_MINUTE,
      // Retry policy comes from the QueryClient default (see provider.tsx). A
      // role without `academic_year:read` gets FORBIDDEN here, and that is a
      // legitimate state — a librarian has no business reading sessions. The
      // default never retries it, and the shell must still render.
    },
  );

  // The branch is in the query key, so a cached list is always this branch's.
  const branchSessions = sessionsQuery.data ?? NO_SESSIONS;

  const currentSession = useMemo(() => {
    const flagged = branchSessions.filter((s) => s.isCurrent);
    // Several means several branches are in view, so no single session is "the"
    // current one. One means it is unambiguous. None is normal before setup.
    return flagged.length === 1 ? flagged[0] : undefined;
  }, [branchSessions]);

  const activeSession = useMemo(() => {
    const persisted = stored?.academicYearId;
    const chosen = persisted
      ? branchSessions.find((s) => s.id === persisted)
      : undefined;

    // A persisted session that is no longer in the list — closed, another branch's,
    // or now hidden because the caller lacks read_history — is dropped rather than
    // sent to the server, where it would 404 on every request.
    return chosen ?? currentSession;
  }, [branchSessions, stored?.academicYearId, currentSession]);

  const permissions = useMemo(
    () => new Set(membership?.permissions ?? []),
    [membership],
  );

  /**
   * A session that expired while the tab was open. The server layout only gates
   * navigation, so this is the client-side half of the same rule.
   */
  const meRequiresSignIn = Boolean(me.error) && toFriendlyError(me.error).requiresSignIn;

  useEffect(() => {
    if (meRequiresSignIn) router.replace("/login");
  }, [meRequiresSignIn, router]);

  const selectOrganization = useCallback(
    (nextOrganizationId: string) => {
      // The branch and session belong to the org being left, so they cannot carry
      // over. Clearing them here is what stops a cross-tenant id reaching the API.
      select({
        organizationId: nextOrganizationId,
        schoolId: undefined,
        academicYearId: undefined,
      });
    },
    [select],
  );

  const selectSchool = useCallback(
    (nextSchoolId: string | null) => {
      // Sessions are per branch, so the chosen one is meaningless in another.
      select({ schoolId: nextSchoolId ?? undefined, academicYearId: undefined });
    },
    [select],
  );

  const selectSession = useCallback(
    (nextSessionId: string | null) => {
      select({ academicYearId: nextSessionId ?? undefined });
    },
    [select],
  );

  const value = useMemo<ActiveContextValue | null>(() => {
    if (!me.data || !membership || !organizationId) return null;

    return {
      me: me.data,
      memberships,
      membership,
      organizationId,
      schoolId,
      academicYearId: activeSession?.id ?? null,
      schools,
      sessions: branchSessions,
      activeSession,
      currentSession,
      sessionsLoading: sessionsQuery.isPending,
      needsBranchChoice: schools.length > 1 && !schoolId,
      canSeeHistory: permissions.has("academic_year:read_history"),
      has: (permission: Permission) => permissions.has(permission),
      selectOrganization,
      selectSchool,
      selectSession,
      scopeArgs: () => ({ organizationId, schoolId: schoolId ?? "" }),
      orgScopeArgs: () => ({ organizationId }),
      writeScopeArgs: () => (schoolId ? { organizationId, schoolId } : null),
    };
  }, [
    me.data,
    memberships,
    membership,
    organizationId,
    schoolId,
    schools,
    branchSessions,
    activeSession,
    currentSession,
    sessionsQuery.isPending,
    permissions,
    selectOrganization,
    selectSchool,
    selectSession,
  ]);

  /**
   * The state, rather than an early return. The provider always renders its
   * children now — the shell is one of them, and it must not vanish while `me.get`
   * is in flight. `ActiveContextGate`, mounted inside the shell, is what holds page
   * content back.
   */
  // Bound outside the memo so the retry closure captures a stable function
  // instead of the per-render `me` object.
  const refetchMe = me.refetch;
  const state = useMemo<ActiveContextState>(() => {
    // Storage not yet read, the bootstrap call still in flight, or a redirect to
    // /login already scheduled. All three are "not yet", not "broken".
    if (stored === null || me.isPending || meRequiresSignIn) {
      return { status: "loading" };
    }

    if (me.error) {
      return {
        status: "error",
        message: errorMessage(me.error),
        retry: () => void refetchMe(),
      };
    }

    /**
     * A valid session with no staff role. Not an error — a student, or someone
     * whose assignments were all revoked — so it gets an explanation and no retry.
     */
    if (!value) return { status: "no-access" };

    return { status: "ready", value };
  }, [stored, me.isPending, me.error, refetchMe, meRequiresSignIn, value]);

  return <ActiveContext.Provider value={state}>{children}</ActiveContext.Provider>;
}
