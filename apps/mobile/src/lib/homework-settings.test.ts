import {
  MAX_LATE_WINDOW_HOURS,
  checkCriterionDraft,
  checkRubricDraft,
  checkSettingsDraft,
  criterionPointsRange,
  effectiveFromRow,
  emptyCriterionDraft,
  emptyLevelDraft,
  emptyRubricDraft,
  firstRubricError,
  newRubricKey,
  rubricCreatePayload,
  rubricFingerprint,
  settingsDraftFrom,
  settingsFingerprint,
  settingsPayload,
} from "./homework-settings";
import type {
  RubricCriterionDraft,
  RubricDraft,
  SettingsValues,
} from "./homework-settings";

function settings(overrides: Partial<SettingsValues> = {}): SettingsValues {
  return {
    allowedSubmissionTypes: ["none", "offline", "text"],
    studentsCanSubmit: true,
    parentsCanSubmit: false,
    maxFilesPerSubmission: 5,
    maxFileSizeMb: 10,
    allowedMimeTypes: null,
    defaultLatePolicy: "allowed",
    defaultLateWindowHours: 48,
    maxAssignmentsPerDay: null,
    allowWeekendAssignments: true,
    questionsEnabled: true,
    ...overrides,
  };
}

function criterion(
  overrides: Partial<RubricCriterionDraft> = {},
): RubricCriterionDraft {
  const base = emptyCriterionDraft();
  return {
    ...base,
    name: "Hypothesis",
    levels: [
      { ...emptyLevelDraft(), label: "Secure", points: "3" },
      { ...emptyLevelDraft(), label: "Developing", points: "1.5" },
    ],
    ...overrides,
  };
}

function rubric(overrides: Partial<RubricDraft> = {}): RubricDraft {
  return {
    name: "Lab report",
    description: "How a practical is written up.",
    criteria: [criterion()],
    ...overrides,
  };
}

describe("settings drafts", () => {
  it("turns an effective row into form strings", () => {
    const draft = settingsDraftFrom(
      settings({ defaultLateWindowHours: 24, maxAssignmentsPerDay: 3 }),
    );

    expect(draft.defaultLateWindowHours).toBe("24");
    expect(draft.maxAssignmentsPerDay).toBe("3");
    expect(draft.allowedSubmissionTypes).toEqual(["none", "offline", "text"]);
  });

  it("uses an empty string for the no-cap value", () => {
    expect(settingsDraftFrom(settings()).maxAssignmentsPerDay).toBe("");
  });

  it("sends every field, including the file columns it does not edit", () => {
    const values = settings({
      maxFilesPerSubmission: 8,
      maxFileSizeMb: 25,
      allowedMimeTypes: ["image/jpeg"],
    });
    const payload = settingsPayload(settingsDraftFrom(values), values);

    expect(payload.maxFilesPerSubmission).toBe(8);
    expect(payload.maxFileSizeMb).toBe(25);
    expect(payload.allowedMimeTypes).toEqual(["image/jpeg"]);
    expect(payload.studentsCanSubmit).toBe(true);
    expect(payload.defaultLateWindowHours).toBe(48);
  });

  it("orders submission types canonically and drops an empty cap", () => {
    const values = settings({ maxAssignmentsPerDay: 4 });
    const draft = {
      ...settingsDraftFrom(values),
      allowedSubmissionTypes: [
        "questions",
        "none",
        "offline",
      ] as SettingsValues["allowedSubmissionTypes"],
      maxAssignmentsPerDay: "  ",
    };

    const payload = settingsPayload(draft, values);

    expect(payload.allowedSubmissionTypes).toEqual([
      "none",
      "offline",
      "questions",
    ]);
    expect(payload.maxAssignmentsPerDay).toBeNull();
  });

  it("accepts a zero-hour late window and rejects an empty submission policy", () => {
    const zero = { ...settingsDraftFrom(settings()), defaultLateWindowHours: "0" };
    expect(checkSettingsDraft(zero).valid).toBe(true);

    const none = {
      ...settingsDraftFrom(settings()),
      allowedSubmissionTypes: [] as SettingsValues["allowedSubmissionTypes"],
    };
    const check = checkSettingsDraft(none);
    expect(check.valid).toBe(false);
    expect(check.errors.submissionTypes).toBeTruthy();
  });

  it("rejects hours and daily caps outside the contract", () => {
    const badHours = {
      ...settingsDraftFrom(settings()),
      defaultLateWindowHours: String(MAX_LATE_WINDOW_HOURS + 1),
    };
    expect(checkSettingsDraft(badHours).errors.lateWindow).toBeTruthy();

    const badCap = { ...settingsDraftFrom(settings()), maxAssignmentsPerDay: "0" };
    expect(checkSettingsDraft(badCap).errors.maxPerDay).toBeTruthy();

    const hugeCap = { ...settingsDraftFrom(settings()), maxAssignmentsPerDay: "21" };
    expect(checkSettingsDraft(hugeCap).errors.maxPerDay).toBeTruthy();
  });

  it("fingerprints ignore type order and number formatting", () => {
    const base = settingsDraftFrom(settings());
    const reordered = {
      ...base,
      allowedSubmissionTypes: [...base.allowedSubmissionTypes].reverse(),
      defaultLateWindowHours: " 48 ",
    };

    expect(settingsFingerprint(reordered)).toBe(settingsFingerprint(base));
  });

  it("strips the stored row down to the effective read model", () => {
    const row = {
      ...settings(),
      id: "row-1",
      organizationId: "org-1",
      schoolId: "school-1",
      classId: null,
      createdBy: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const effective = effectiveFromRow(row);

    expect(Object.keys(effective).sort()).toEqual([
      "allowWeekendAssignments",
      "allowedMimeTypes",
      "allowedSubmissionTypes",
      "defaultLatePolicy",
      "defaultLateWindowHours",
      "maxAssignmentsPerDay",
      "maxFileSizeMb",
      "maxFilesPerSubmission",
      "parentsCanSubmit",
      "questionsEnabled",
      "studentsCanSubmit",
    ]);
  });
});

describe("rubric drafts", () => {
  it("rejects an empty rubric and names the missing pieces", () => {
    const check = checkRubricDraft(emptyRubricDraft());

    expect(check.valid).toBe(false);
    expect(check.errors.name).toBeTruthy();
    expect(check.errors.criteria).toBeTruthy();
  });

  it("accepts a rubric with one complete criterion", () => {
    expect(checkRubricDraft(rubric()).valid).toBe(true);
  });

  it("requires a criterion name and at least one level", () => {
    const noName = checkCriterionDraft(criterion({ name: "  " }));
    expect(noName.valid).toBe(false);
    expect(noName.errors.name).toBeTruthy();

    const noLevels = checkCriterionDraft(criterion({ levels: [] }));
    expect(noLevels.valid).toBe(false);
    expect(noLevels.errors.levels).toBeTruthy();
  });

  it("rejects zero, text and over-precise points", () => {
    for (const points of ["0", "abc", "1.234", ""]) {
      const check = checkCriterionDraft(
        criterion({ levels: [{ ...emptyLevelDraft(), label: "Secure", points }] }),
      );
      expect(check.valid).toBe(false);
      expect(Object.keys(check.errors.levelsByKey).length).toBe(1);
    }
  });

  it("allows a fractional level above zero", () => {
    const check = checkCriterionDraft(
      criterion({
        levels: [{ ...emptyLevelDraft(), label: "Developing", points: "0.5" }],
      }),
    );
    expect(check.valid).toBe(true);
  });

  it("rejects an over-long criterion name and level label", () => {
    const longName = checkCriterionDraft(criterion({ name: "x".repeat(151) }));
    expect(longName.errors.name).toBeTruthy();

    const longLabel = checkCriterionDraft(
      criterion({
        levels: [{ ...emptyLevelDraft(), label: "x".repeat(101), points: "1" }],
      }),
    );
    expect(longLabel.valid).toBe(false);
  });

  it("builds whole rows with positions from list order", () => {
    const draft = rubric({
      name: "  Lab report  ",
      description: "  Written up.  ",
      criteria: [
        criterion({ name: " Hypothesis ", description: "  " }),
        criterion({
          name: "Method",
          description: "Steps in order.",
          levels: [
            { ...emptyLevelDraft(), label: " Secure ", points: "3.00" },
            { ...emptyLevelDraft(), label: "Emerging", points: "0.50" },
          ],
        }),
      ],
    });

    const payload = rubricCreatePayload(draft);

    expect(payload.name).toBe("Lab report");
    expect(payload.description).toBe("Written up.");
    expect(payload.criteria).toHaveLength(2);
    expect(payload.criteria[0]?.name).toBe("Hypothesis");
    expect(payload.criteria[0]?.description).toBeUndefined();
    expect(payload.criteria[0]?.sortOrder).toBe(0);
    expect(payload.criteria[1]?.sortOrder).toBe(1);
    expect(payload.criteria[1]?.levels[0]?.points).toBe("3");
    expect(payload.criteria[1]?.levels[1]?.points).toBe("0.5");
    expect(payload.criteria[1]?.levels[1]?.sortOrder).toBe(1);
  });

  it("reports the first field that blocks the save", () => {
    const check = checkRubricDraft(rubric({ name: "" }));
    expect(firstRubricError(check)).toBe(check.errors.name);

    const levelCheck = checkRubricDraft(
      rubric({
        criteria: [
          criterion({
            levels: [{ ...emptyLevelDraft(), label: "", points: "1" }],
          }),
        ],
      }),
    );
    expect(firstRubricError(levelCheck)).toBeTruthy();
  });

  it("fingerprints ignore whitespace and draft keys", () => {
    const base = rubric();
    const spaced = {
      ...base,
      name: " Lab report ",
      criteria: base.criteria.map((row) => ({
        ...row,
        name: ` ${row.name} `,
      })),
    };
    expect(rubricFingerprint(spaced)).toBe(rubricFingerprint(base));
  });

  it("summarises a criterion's level range", () => {
    expect(criterionPointsRange(criterion())).toEqual({ min: "1.5", max: "3" });
    expect(criterionPointsRange(criterion({ levels: [] }))).toBeNull();
    expect(
      criterionPointsRange(
        criterion({
          levels: [
            { ...emptyLevelDraft(), label: "One", points: "2" },
            { ...emptyLevelDraft(), label: "Two", points: "2" },
          ],
        }),
      ),
    ).toEqual({ min: "2", max: "2" });
  });

  it("issues unique draft keys with their prefix", () => {
    const first = newRubricKey("criterion");
    const second = newRubricKey("criterion");
    const level = newRubricKey("level");

    expect(first).not.toBe(second);
    expect(first.startsWith("criterion-")).toBe(true);
    expect(level.startsWith("level-")).toBe(true);
  });
});
