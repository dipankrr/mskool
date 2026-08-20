"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy } from "@/lib/copy";
import { formatIsoDateRange } from "@/lib/format";

/**
 * THE THREE THINGS THAT DECIDE WHAT EVERY SCREEN SHOWS.
 *
 * **Each one renders only when there is a genuine choice**, and that falls out of
 * the authorization model rather than being a special case. `me.get` returns one
 * membership per organization the caller holds a role in, and only the branches
 * their grants reach — so a single-branch principal gets a plain label where a
 * trust admin gets a real switcher. Nobody is shown a dropdown with one item in it,
 * and nobody has to learn what a control does before discovering it does nothing.
 *
 * `DropdownMenu` rather than `Select`, deliberately: the trigger label is written
 * here, so a branch reads as "Main Campus (MAIN)" instead of a uuid, and a session
 * can carry its dates. A `Select` renders the *value*, which for these is an id.
 */

/** Shared trigger: current choice, plus the affordance that there are others. */
function SwitcherTrigger({ label, hint }: { label: string; hint?: string }) {
  return (
    <DropdownMenuTrigger
      render={
        <Button variant="outline" size="sm" className="max-w-52 justify-between">
          <span className="truncate">
            {hint ? <span className="text-muted-foreground">{hint} </span> : null}
            {label}
          </span>
          <ChevronsUpDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      }
    />
  );
}

/**
 * Only for a user with roles in more than one trust — rare, but real for an
 * accountant shared between two societies. Switching clears the branch and session,
 * because they belong to the trust being left.
 */
export function OrgSwitcher({ className }: { className?: string }) {
  const { memberships, membership, organizationId, selectOrganization } =
    useActiveContext();

  if (memberships.length <= 1) {
    return (
      <span className={className} title={membership.organization.name}>
        <span className="block truncate text-sm font-medium">
          {membership.organization.name}
        </span>
      </span>
    );
  }

  return (
    <div className={className}>
      <DropdownMenu>
        <SwitcherTrigger label={membership.organization.name} />
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuRadioGroup
            value={organizationId}
            onValueChange={(value) => selectOrganization(String(value))}
          >
            {memberships.map((option) => (
              <DropdownMenuRadioItem
                key={option.organization.id}
                value={option.organization.id}
              >
                {option.organization.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The branch every write is attributed to.
 *
 * Absent for a caller who can see only one — and for one who can see none at all,
 * which is the normal state for anyone scoped below school level: a class teacher
 * gets `schools: []` from `me`, and has nothing to choose between.
 *
 * When several are visible and none is chosen, the trigger says so rather than
 * showing a blank, because `writeScopeArgs()` returns null in that state and every
 * create button downstream depends on it.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { schools, schoolId, selectSchool, needsBranchChoice } = useActiveContext();

  if (schools.length === 0) return null;

  const selected = schools.find((school) => school.id === schoolId);

  if (schools.length === 1) {
    return (
      <span className={className}>
        <span className="block max-w-40 truncate text-sm text-muted-foreground">
          {selected?.name ?? schools[0]?.name}
        </span>
      </span>
    );
  }

  return (
    <div className={className}>
      <DropdownMenu>
        <SwitcherTrigger
          label={selected ? `${selected.name} (${selected.code})` : copy.nav.chooseBranch}
          hint={needsBranchChoice ? undefined : branchWord(schools.length)}
        />
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup
            value={schoolId ?? ""}
            onValueChange={(value) => selectSchool(String(value) || null)}
          >
            {schools.map((school) => (
              <DropdownMenuRadioItem key={school.id} value={school.id}>
                {school.name} ({school.code})
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Which academic year the screens apply to.
 *
 * A picker appears only when there is history to reach: `academic_year:read_history`
 * (ADR-024) plus more than one session in view. Everyone else gets the running
 * session as a label — which is not a limitation of this component but of the
 * server, which will not return a closed session to them at all. A class teacher
 * therefore sees a name, never a dropdown.
 */
export function SessionPicker({ className }: { className?: string }) {
  const { sessions, activeSession, selectSession, canSeeHistory, needsBranchChoice } =
    useActiveContext();

  /**
   * With several branches in view and none chosen there is no single running
   * session — `isCurrent` is per school — so this would render a dash and offer a
   * list mixing two branches' years. The branch switcher is the control that
   * matters in that state; this one stays out of the way until it means something.
   */
  if (needsBranchChoice) return null;

  if (!activeSession && sessions.length === 0) return null;

  const canChoose = canSeeHistory && sessions.length > 1;

  if (!canChoose) {
    return (
      <span className={className}>
        <span className="block truncate text-sm text-muted-foreground">
          {activeSession?.name ?? copy.common.none}
        </span>
      </span>
    );
  }

  return (
    <div className={className}>
      <DropdownMenu>
        <SwitcherTrigger label={activeSession?.name ?? copy.common.none} />
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuRadioGroup
            value={activeSession?.id ?? ""}
            onValueChange={(value) => selectSession(String(value) || null)}
          >
            {sessions.map((session) => (
              <DropdownMenuRadioItem key={session.id} value={session.id}>
                <span className="flex flex-col gap-0.5">
                  <span>
                    {session.name}
                    {session.isCurrent ? (
                      <CheckIcon data-icon="inline-end" className="opacity-60" />
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatIsoDateRange(session.startDate, session.endDate)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
