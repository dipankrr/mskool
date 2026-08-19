"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy } from "@/lib/copy";
import { formatIsoDateRange } from "@/lib/format";

/**
 * TEMPORARY. A readout of whatever the active context resolved to, so Chunk 5 can
 * be verified against all three seeded roles before any real screen exists.
 * Chunk 7 replaces this with the shell, and Chunk 12 with the setup checklist.
 */
export default function DashboardPage() {
  const {
    me,
    memberships,
    membership,
    organizationId,
    schoolId,
    schools,
    sessions,
    activeSession,
    currentSession,
    sessionsLoading,
    needsBranchChoice,
    canSeeHistory,
    has,
    selectSchool,
    selectSession,
    scopeArgs,
    writeScopeArgs,
  } = useActiveContext();

  const writeArgs = writeScopeArgs();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{me.user.name}</CardTitle>
          <CardDescription>
            {me.user.email ?? copy.common.none} · {membership.organization.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {membership.roleTypes.map((role) => (
              <Badge key={role} variant="secondary">
                {role}
              </Badge>
            ))}
            {membership.scopeTypes.map((scope) => (
              <Badge key={scope} variant="outline">
                scope: {scope}
              </Badge>
            ))}
            <Badge variant="outline">{membership.permissions.length} permissions</Badge>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">organizationId</dt>
            <dd className="font-mono text-xs">{organizationId}</dd>

            <dt className="text-muted-foreground">schoolId</dt>
            <dd className="font-mono text-xs">{schoolId ?? "null"}</dd>

            <dt className="text-muted-foreground">academicYearId</dt>
            <dd className="font-mono text-xs">{activeSession?.id ?? "null"}</dd>

            <dt className="text-muted-foreground">scopeArgs()</dt>
            <dd className="font-mono text-xs">{JSON.stringify(scopeArgs())}</dd>

            <dt className="text-muted-foreground">writeScopeArgs()</dt>
            <dd className="font-mono text-xs">
              {writeArgs ? JSON.stringify(writeArgs) : "null — needs a branch"}
            </dd>

            <dt className="text-muted-foreground">memberships</dt>
            <dd>{memberships.length}</dd>

            <dt className="text-muted-foreground">read_history</dt>
            <dd>{canSeeHistory ? copy.common.yes : copy.common.no}</dd>

            <dt className="text-muted-foreground">school:create</dt>
            <dd>{has("school:create") ? copy.common.yes : copy.common.no}</dd>

            <dt className="text-muted-foreground">needsBranchChoice</dt>
            <dd>{needsBranchChoice ? copy.common.yes : copy.common.no}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{branchWord(schools.length, true)}</CardTitle>
          <CardDescription>
            {schools.length === 0
              ? "None visible — this account is scoped below school level."
              : `${schools.length} visible`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {schools.map((school) => (
            <Button
              key={school.id}
              variant={school.id === schoolId ? "default" : "outline"}
              size="sm"
              onClick={() => selectSchool(school.id === schoolId ? null : school.id)}
            >
              {school.name} ({school.code})
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.terms.sessions}</CardTitle>
          <CardDescription>
            {sessionsLoading
              ? copy.common.loading
              : sessions.length === 0
                ? copy.sessions.emptyBody
                : currentSession
                  ? `Running: ${currentSession.name}`
                  : "No single running session — pick a branch."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center gap-2">
              <Button
                variant={session.id === activeSession?.id ? "default" : "outline"}
                size="sm"
                onClick={() => selectSession(session.id)}
              >
                {session.name}
              </Button>
              <span className="text-muted-foreground text-xs">
                {formatIsoDateRange(session.startDate, session.endDate)}
              </span>
              {session.isCurrent ? (
                <Badge variant="secondary">{copy.sessions.running}</Badge>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
