import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import type { AppIconName } from "../components/app-icon";
import { copy } from "./copy";

export type SetupStatus = inferRouterOutputs<AppRouter>["academic"]["setupStatus"];

export type SetupStepKey =
  | "session"
  | "terms"
  | "classes"
  | "sections"
  | "subjects"
  | "subjectTypes"
  | "classSubjects"
  | "workingDays";

export type SetupStep = {
  key: SetupStepKey;
  state: "done" | "todo" | "locked";
  title: string;
  /** What the step asks for as the next action: "Add sections". */
  action: string;
  detail: string;
  icon: AppIconName;
  route: string;
};

/**
 * THE SETUP STEPS. Whether a step is finished is read from the school's real
 * data every time, so work done anywhere ticks it, and a finished school sees
 * nothing. Steps the person can't do are left out and not counted. A step that
 * needs an earlier one says so instead of opening a screen that can't help.
 *
 * Sections and Class subjects want every class covered, not just one row:
 * a class with no section can't take attendance, teachers or homework.
 */
export function buildSetupSteps(
  status: SetupStatus,
  has: (permission: string) => boolean,
): SetupStep[] {
  const text = copy.setup.steps;

  const hasSession = status.session !== null;
  const classes = status.classCount;
  const withSection = classes - status.classesWithoutSection.length;
  const withSubjects = classes - status.classesWithoutSubjects.length;

  const waitingFor = (...needs: [boolean, string][]) =>
    needs.find(([met]) => !met)?.[1] ?? null;

  const step = (
    key: SetupStepKey,
    permission: string,
    done: boolean,
    waiting: string | null,
    detail: string,
    icon: AppIconName,
    route: string,
  ): SetupStep | null => {
    if (!has(permission)) return null;
    return {
      key,
      state: done ? "done" : waiting ? "locked" : "todo",
      title: text[key].title,
      action: text[key].action,
      detail: !done && waiting ? waiting : detail,
      icon,
      route,
    };
  };

  const steps = [
    step(
      "session",
      "academic_year:create",
      hasSession,
      null,
      status.session ? text.session.done(status.session.name) : text.session.todo,
      "sessions",
      "/sessions",
    ),
    step(
      "terms",
      "academic_year:create",
      hasSession && status.termCount > 0,
      waitingFor([hasSession, text.needsSession]),
      status.termCount > 0 ? text.terms.done(status.termCount) : text.terms.todo,
      "calendar",
      "/terms",
    ),
    step(
      "classes",
      "class:create",
      classes > 0,
      null,
      classes > 0 ? text.classes.done(classes) : text.classes.todo,
      "stack",
      "/class-section",
    ),
    step(
      "sections",
      "section:create",
      hasSession && classes > 0 && status.classesWithoutSection.length === 0,
      waitingFor([hasSession, text.needsSession], [classes > 0, text.needsClasses]),
      text.sections.progress(withSection, classes),
      "school",
      "/class-section",
    ),
    step(
      "subjects",
      "subject:create",
      status.subjectCount > 0,
      null,
      status.subjectCount > 0 ? text.subjects.done(status.subjectCount) : text.subjects.todo,
      "subject",
      "/subject-mapping",
    ),
    step(
      "subjectTypes",
      "exam:create",
      status.subjectTypeCount > 0,
      null,
      status.subjectTypeCount > 0
        ? text.subjectTypes.done(status.subjectTypeCount)
        : text.subjectTypes.todo,
      "manage",
      "/exams/setup/subject-types",
    ),
    step(
      "classSubjects",
      "subject:create",
      hasSession && classes > 0 && status.classesWithoutSubjects.length === 0,
      waitingFor(
        [hasSession, text.needsSession],
        [classes > 0, text.needsClasses],
        [status.subjectCount > 0, text.needsSubjects],
        [status.subjectTypeCount > 0, text.needsSubjectTypes],
      ),
      text.classSubjects.progress(withSubjects, classes),
      "sort",
      status.classesWithoutSubjects[0]
        ? `/subject-mapping?classId=${status.classesWithoutSubjects[0]}`
        : "/subject-mapping",
    ),
    step(
      "workingDays",
      "attendance:update",
      hasSession && status.hasCalendar,
      waitingFor([hasSession, text.needsSession]),
      status.hasCalendar ? text.workingDays.done : text.workingDays.todo,
      "attendance",
      "/attendance/manage/calendar",
    ),
  ];

  return steps.filter((item): item is SetupStep => item !== null);
}

/** The first unfinished step that isn't waiting on another. */
export function nextSetupStep(steps: readonly SetupStep[]): SetupStep | null {
  return steps.find((step) => step.state === "todo") ?? null;
}

export function setupFinished(steps: readonly SetupStep[]): boolean {
  return steps.every((step) => step.state === "done");
}
