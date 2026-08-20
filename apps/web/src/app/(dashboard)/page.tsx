"use client";

import { Building2Icon, CalendarDaysIcon, GraduationCapIcon } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy, countLabel } from "@/lib/copy";
import { formatIsoDateRange } from "@/lib/format";

/**
 * Home. A summary of what this user is working in, and the way into each area.
 *
 * Chunk 12 replaces this with the first-run checklist — session, then classes, then
 * sections — for the case where setup is incomplete, keeping a summary like this one
 * for when it is done.
 */
export default function HomePage() {
  const { me, membership, schools, sessions, activeSession, currentSession } =
    useActiveContext();

  const destinations = [
    {
      href: "/branches",
      icon: Building2Icon,
      title: branchWord(schools.length, true),
      body:
        schools.length === 0
          ? copy.nav.noBranch
          : countLabel(
              schools.length,
              copy.terms.school.toLowerCase(),
              copy.terms.schools.toLowerCase(),
            ),
    },
    {
      href: "/sessions",
      icon: CalendarDaysIcon,
      title: copy.terms.sessions,
      body:
        sessions.length === 0
          ? copy.sessions.emptyTitle
          : countLabel(
              sessions.length,
              copy.terms.session.toLowerCase(),
              copy.terms.sessions.toLowerCase(),
            ),
    },
    {
      href: "/classes",
      icon: GraduationCapIcon,
      title: copy.terms.classes,
      body: copy.classes.subtitle,
    },
  ];

  return (
    <>
      <PageHeader
        title={`Hello, ${me.user.name.split(" ")[0]}`}
        description={membership.organization.name}
      />

      <Card>
        <CardHeader>
          <CardTitle>{copy.sessions.running}</CardTitle>
          <CardDescription>{copy.sessions.runningHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {activeSession ? (
            <>
              <span className="font-heading text-lg font-semibold">
                {activeSession.name}
              </span>
              <span className="text-muted-foreground text-sm">
                {formatIsoDateRange(activeSession.startDate, activeSession.endDate)}
              </span>
              {activeSession.id === currentSession?.id ? (
                <Badge variant="secondary">{copy.common.current}</Badge>
              ) : (
                <Badge variant="outline">{copy.sessions.past}</Badge>
              )}
            </>
          ) : (
            <span className="text-muted-foreground text-sm">
              {copy.sessions.emptyBody}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map((destination) => (
          <Link
            key={destination.href}
            href={destination.href}
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Card className="hover:bg-muted/40 h-full transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <destination.icon className="size-4" />
                  {destination.title}
                </CardTitle>
                <CardDescription>{destination.body}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
