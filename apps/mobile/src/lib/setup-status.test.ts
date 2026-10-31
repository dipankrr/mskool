import { buildSetupSteps, nextSetupStep, setupFinished } from "./setup-status";
import type { SetupStatus } from "./setup-status";

const everything = () => true;

const fresh: SetupStatus = {
  session: null,
  termCount: 0,
  classCount: 0,
  classesWithoutSection: [],
  subjectCount: 0,
  subjectTypeCount: 0,
  classesWithoutSubjects: [],
  hasCalendar: false,
};

const finished: SetupStatus = {
  session: { id: "y1", name: "2026-27" },
  termCount: 2,
  classCount: 2,
  classesWithoutSection: [],
  subjectCount: 5,
  subjectTypeCount: 3,
  classesWithoutSubjects: [],
  hasCalendar: true,
};

const states = (status: SetupStatus, has = everything) =>
  Object.fromEntries(buildSetupSteps(status, has).map((step) => [step.key, step.state]));

describe("buildSetupSteps", () => {
  it("locks what a fresh school can't start yet", () => {
    expect(states(fresh)).toEqual({
      session: "todo",
      terms: "locked",
      classes: "todo",
      sections: "locked",
      subjects: "todo",
      subjectTypes: "todo",
      classSubjects: "locked",
      workingDays: "locked",
    });
  });

  it("says what a locked step is waiting for", () => {
    const steps = buildSetupSteps({ ...fresh, session: finished.session }, everything);
    expect(steps.find((step) => step.key === "sections")?.detail).toMatch(/class/i);
  });

  it("is finished when every step is done", () => {
    expect(setupFinished(buildSetupSteps(finished, everything))).toBe(true);
  });

  it("keeps Sections open until every class has one", () => {
    const steps = buildSetupSteps(
      { ...finished, classesWithoutSection: ["c2"] },
      everything,
    );
    const sections = steps.find((step) => step.key === "sections");
    expect(sections?.state).toBe("todo");
    expect(sections?.detail).toContain("1 of 2");
    expect(setupFinished(steps)).toBe(false);
  });

  it("opens Class subjects on the first class missing them", () => {
    const steps = buildSetupSteps(
      { ...finished, classesWithoutSubjects: ["c2", "c3"] },
      everything,
    );
    expect(steps.find((step) => step.key === "classSubjects")?.route).toBe(
      "/subject-mapping?classId=c2",
    );
  });

  it("leaves out steps the person can't do, and doesn't count them", () => {
    const steps = buildSetupSteps(
      { ...finished, hasCalendar: false },
      (permission) => permission !== "attendance:update",
    );
    expect(steps.some((step) => step.key === "workingDays")).toBe(false);
    expect(setupFinished(steps)).toBe(true);
  });
});

describe("nextSetupStep", () => {
  it("skips finished and locked steps", () => {
    const steps = buildSetupSteps(
      { ...finished, termCount: 0, classesWithoutSection: ["c2"] },
      everything,
    );
    expect(nextSetupStep(steps)?.key).toBe("terms");
  });

  it("is the first step for a fresh school", () => {
    expect(nextSetupStep(buildSetupSteps(fresh, everything))?.key).toBe("session");
  });

  it("is nothing when finished", () => {
    expect(nextSetupStep(buildSetupSteps(finished, everything))).toBeNull();
  });
});
