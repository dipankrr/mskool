"use client";

import {
  ArrowRightIcon,
  Building2Icon,
  CalendarDaysIcon,
  CheckIcon,
  GraduationCapIcon,
  LayersIcon,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy, countLabel } from "@/lib/copy";
import { formatIsoDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * HOME — a checklist while the school is being set up, a summary once it is.
 *
 * A newly provisioned organization has no session, so the current-session lookup finds
 * nothing and every list is empty. Left as bare tables that is a dead end for the one
 * person who has to fix it, so this screen explains the order of operations instead.
 *
 * **Only the sections step is genuinely blocked.** Classes are not year-scoped — Class 6
 * is the same rung every year — so a school can add its classes before its first session
 * exists. The steps are numbered for guidance, and only step three refuses to start
 * early, because a section cannot exist without a year to belong to.
 */

type Step = {
  title: string;
  why: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  done: boolean;
  /** Blocked steps say what to do first rather than linking somewhere useless. */
  blockedBy?: string;
};

export default function HomePage() {
  const {
    me,
    membership,
    schools,
    sessions,
    activeSession,
    currentSession,
    sessionsLoading,
    needsBranchChoice,
  } = useActiveContext();

  const classes = useClasses();
  const sections = useSections();

  const classCount = classes.data?.length ?? 0;
  const sectionCount = sections.data?.length ?? 0;

  const greeting = `Hello, ${me.user.name.split(" ")[0] ?? me.user.name}`;

  /**
   * A branch has to be chosen before any of this means anything: sessions, classes and
   * sections all belong to one. Only reachable for a trust admin with several.
   */
  if (needsBranchChoice) {
    return (
      <>
        <PageHeader title={greeting} description={membership.organization.name} />
        <EmptyState
          icon={Building2Icon}
          title={copy.access.chooseBranchTitle}
          description={copy.access.chooseBranchBody}
        />
      </>
    );
  }

  /**
   * `isLoading`, not `isPending`.
   *
   * A disabled query — and the sections query is disabled until a session exists — sits
   * at `status: "pending"` indefinitely, because it has never been allowed to run. Gating
   * on `isPending` therefore left this screen showing skeletons forever in exactly the
   * situation it exists for: a branch with no session yet. `isLoading` is
   * `isPending && isFetching`, so it is false for a query that is not going to run.
   */
  const loading = sessionsLoading || classes.isLoading || sections.isLoading;

  if (loading) {
    return (
      <>
        <PageHeader title={greeting} description={membership.organization.name} />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </>
    );
  }

  const steps: Step[] = [
    {
      title: copy.setup.sessionStep,
      why: copy.setup.sessionStepWhy,
      href: "/sessions",
      icon: CalendarDaysIcon,
      done: Boolean(currentSession),
    },
    {
      title: copy.setup.classesStep,
      why: copy.setup.classesStepWhy,
      href: "/classes",
      icon: GraduationCapIcon,
      // Deliberately not gated on a session — classes are not year-scoped.
      done: classCount > 0,
    },
    {
      title: copy.setup.sectionsStep,
      why: copy.setup.sectionsStepWhy,
      href: "/classes",
      icon: LayersIcon,
      done: sectionCount > 0,
      blockedBy: activeSession
        ? classCount === 0
          ? copy.setup.classesStep
          : undefined
        : copy.setup.needsSession,
    },
  ];

  const setupComplete = steps.every((step) => step.done);

  if (!setupComplete) {
    return (
      <>
        <PageHeader title={copy.setup.title} description={copy.setup.subtitle} />
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <SetupStep step={step} number={index + 1} />
            </li>
          ))}
        </ol>
      </>
    );
  }

  return (
    <>
      <PageHeader title={greeting} description={membership.organization.name} />

      <Card>
        <CardHeader>
          <CardTitle>{copy.sessions.running}</CardTitle>
          <CardDescription>{copy.sessions.runningHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="font-heading text-lg font-semibold">
            {activeSession?.name}
          </span>
          <span className="text-muted-foreground text-sm">
            {formatIsoDateRange(activeSession?.startDate, activeSession?.endDate)}
          </span>
          {activeSession?.id === currentSession?.id ? (
            <Badge variant="secondary">{copy.common.current}</Badge>
          ) : (
            <Badge variant="outline">{copy.sessions.past}</Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          href="/branches"
          icon={Building2Icon}
          title={branchWord(schools.length, true)}
          body={countLabel(
            schools.length,
            copy.terms.school.toLowerCase(),
            copy.terms.schools.toLowerCase(),
          )}
        />
        <SummaryCard
          href="/sessions"
          icon={CalendarDaysIcon}
          title={copy.terms.sessions}
          body={countLabel(
            sessions.length,
            copy.terms.session.toLowerCase(),
            copy.terms.sessions.toLowerCase(),
          )}
        />
        <SummaryCard
          href="/classes"
          icon={GraduationCapIcon}
          title={copy.terms.classes}
          body={`${countLabel(classCount, "class", "classes")} · ${countLabel(
            sectionCount,
            "section",
            "sections",
          )}`}
        />
      </div>
    </>
  );
}

/**
 * One step. Done steps stay visible rather than disappearing — seeing what is already
 * finished is what makes the list feel like progress instead of a list of complaints.
 */
function SetupStep({ step, number }: { step: Step; number: number }) {
  const blocked = Boolean(step.blockedBy) && !step.done;

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
          step.done ? "bg-primary text-primary-foreground border-transparent" : null,
        )}
      >
        {step.done ? <CheckIcon className="size-4" /> : number}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{step.title}</span>
        <span className="text-muted-foreground text-sm">
          {blocked ? step.blockedBy : step.why}
        </span>
      </span>
      {step.done ? (
        <Badge variant="secondary" className="ml-auto shrink-0">
          {copy.setup.done}
        </Badge>
      ) : blocked ? null : (
        <ArrowRightIcon className="text-muted-foreground ml-auto size-4 shrink-0" />
      )}
    </>
  );

  /**
   * A blocked step is not a link. Sending someone to a screen that cannot help them
   * yet is worse than telling them what has to happen first.
   */
  if (blocked) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 opacity-70">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={step.href}
      className="hover:bg-muted/40 flex items-start gap-3 rounded-lg border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {body}
    </Link>
  );
}

function SummaryCard({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Card className="hover:bg-muted/40 h-full transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-4" />
            {title}
          </CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
