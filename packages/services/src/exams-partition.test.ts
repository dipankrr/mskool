import { describe, expect, it } from "vitest";

import {
  describeSchedulePartitionViolations,
  findSchedulePartitionViolations,
} from "./exams-maths";

/**
 * THE PAPER PARTITION (ADR-052): per (class, subject), an exam's papers are
 * either one class-wide row or section rows with distinct sections. The
 * ambiguous shapes are exactly the ones the old section-blind compute could
 * not resolve — it picked a schedule arbitrarily and zeroed the section
 * whose marks lived on the other row.
 */

const CLASS_A = "11111111-1111-1111-1111-111111111111";
const CLASS_B = "22222222-2222-2222-2222-222222222222";
const MATHS = "33333333-3333-3333-3333-333333333333";
const ENGLISH = "44444444-4444-4444-4444-444444444444";
const SECTION_1 = "55555555-5555-5555-5555-555555555551";
const SECTION_2 = "55555555-5555-5555-5555-555555555552";

describe("findSchedulePartitionViolations", () => {
  it("accepts one class-wide paper per subject", () => {
    expect(
      findSchedulePartitionViolations([
        { classId: CLASS_A, subjectId: MATHS, sectionId: null },
        { classId: CLASS_A, subjectId: ENGLISH, sectionId: null },
      ]),
    ).toEqual([]);
  });

  it("accepts distinct section papers per subject", () => {
    expect(
      findSchedulePartitionViolations([
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_2 },
      ]),
    ).toEqual([]);
  });

  it("accepts section papers for one subject and a class-wide for another", () => {
    expect(
      findSchedulePartitionViolations([
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_2 },
        { classId: CLASS_A, subjectId: ENGLISH, sectionId: null },
      ]),
    ).toEqual([]);
  });

  it("judges classes independently — the same subject can differ per class", () => {
    expect(
      findSchedulePartitionViolations([
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_2 },
        { classId: CLASS_B, subjectId: MATHS, sectionId: null },
      ]),
    ).toEqual([]);
  });

  it("refuses a class-wide paper alongside section papers", () => {
    expect(
      findSchedulePartitionViolations([
        { classId: CLASS_A, subjectId: MATHS, sectionId: null },
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
      ]),
    ).toEqual([
      {
        classId: CLASS_A,
        subjectId: MATHS,
        kind: "mixed_class_wide_and_section",
      },
    ]);
  });

  it("refuses the same section twice", () => {
    expect(
      findSchedulePartitionViolations([
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
        { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
      ]),
    ).toEqual([
      { classId: CLASS_A, subjectId: MATHS, kind: "duplicate_section" },
    ]);
  });

  it("refuses each broken subject and leaves clean ones out", () => {
    const violations = findSchedulePartitionViolations([
      { classId: CLASS_A, subjectId: MATHS, sectionId: null },
      { classId: CLASS_A, subjectId: MATHS, sectionId: SECTION_1 },
      { classId: CLASS_A, subjectId: ENGLISH, sectionId: SECTION_1 },
      { classId: CLASS_A, subjectId: ENGLISH, sectionId: SECTION_1 },
    ]);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.subjectId).sort()).toEqual(
      [ENGLISH, MATHS].sort(),
    );
  });
});

describe("describeSchedulePartitionViolations", () => {
  it("names the subject and the shape in school-facing words", () => {
    const text = describeSchedulePartitionViolations(
      [
        { classId: CLASS_A, subjectId: MATHS, kind: "mixed_class_wide_and_section" },
        { classId: CLASS_A, subjectId: ENGLISH, kind: "duplicate_section" },
      ],
      (id) => (id === MATHS ? "Mathematics" : "English"),
    );
    expect(text).toBe(
      "Mathematics has both a class-wide paper and per-section papers; English has two papers for the same section",
    );
  });

  it("falls back to 'a subject' when the subject row is gone", () => {
    expect(
      describeSchedulePartitionViolations(
        [{ classId: CLASS_A, subjectId: MATHS, kind: "duplicate_section" }],
        () => "a subject",
      ),
    ).toContain("a subject has two papers for the same section");
  });
});
