import { copy } from "./copy";
import {
  bandDraftsFromRows,
  bandProblem,
  bandSentence,
  bandsKey,
  bandsPayload,
  canonicalPercent,
  checkBands,
  coverageSegments,
  firstBandProblem,
  formatPercent,
  hundredthsOf,
  largestUncoveredInterval,
  removeBandAndExtend,
  resolveGrade,
  sharedEdge,
} from "./grading-scale";
import type { BandDraft, BandRowLike } from "./grading-scale";

function band(args: Partial<BandDraft> = {}): BandDraft {
  return {
    minMarks: "0",
    maxMarks: "100",
    gradeLabel: "A",
    gradePoint: "",
    ...args,
  };
}

describe("hundredthsOf", () => {
  it("parses percentages exactly, without float dust", () => {
    expect(hundredthsOf("0")).toBe(0);
    expect(hundredthsOf("87")).toBe(8700);
    expect(hundredthsOf("87.5")).toBe(8750);
    expect(hundredthsOf("87.05")).toBe(8705);
    expect(hundredthsOf("90.10")).toBe(9010);
    expect(hundredthsOf("100")).toBe(10000);
    expect(hundredthsOf(" 42 ")).toBe(4200);
  });

  it("refuses anything the contract refuses", () => {
    expect(hundredthsOf("")).toBeNull();
    expect(hundredthsOf("100.01")).toBeNull();
    expect(hundredthsOf("101")).toBeNull();
    expect(hundredthsOf("-1")).toBeNull();
    expect(hundredthsOf("1.234")).toBeNull();
    expect(hundredthsOf("8e2")).toBeNull();
    expect(hundredthsOf("abc")).toBeNull();
  });
});

describe("formatPercent / canonicalPercent", () => {
  it("prints the shortest exact form", () => {
    expect(formatPercent(0)).toBe("0");
    expect(formatPercent(8700)).toBe("87");
    expect(formatPercent(8750)).toBe("87.5");
    expect(formatPercent(8705)).toBe("87.05");
    expect(formatPercent(10000)).toBe("100");
  });

  it("canonicalises typed text", () => {
    expect(canonicalPercent("090.10")).toBe("90.1");
    expect(canonicalPercent("87.50")).toBe("87.5");
    expect(canonicalPercent("oops")).toBeNull();
  });
});

describe("checkBands", () => {
  it("accepts shared edges — the normal contiguous scale", () => {
    const check = checkBands([
      band({ minMarks: "90", maxMarks: "100", gradeLabel: "A1" }),
      band({ minMarks: "80", maxMarks: "90", gradeLabel: "A2" }),
      band({ minMarks: "0", maxMarks: "80", gradeLabel: "B" }),
    ]);
    expect(check.ok).toBe(true);
  });

  it("doesn't judge coverage while a band is still unparsed", () => {
    // One missing grade must not also produce "Bands must end at 100" from the
    // half-built number line — that is two red lines for one empty field.
    const check = checkBands([
      band({ minMarks: "91", maxMarks: "100", gradeLabel: "" }),
      band({ minMarks: "0", maxMarks: "91", gradeLabel: "B" }),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problems).toHaveLength(1);
    expect(firstBandProblem(check)).toBe(
      copy.exams.grading.scales.problems.gradeRequired,
    );
  });

  it("names a whole-percent gap where the school would see one", () => {
    const check = checkBands([
      band({ minMarks: "0", maxMarks: "70", gradeLabel: "B" }),
      band({ minMarks: "81", maxMarks: "100", gradeLabel: "A" }),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(firstBandProblem(check)).toBe(
      copy.exams.grading.scales.problems.gap("71", "80"),
    );
    expect(check.problems[0]?.index).toBe(1);
    expect(bandProblem(check, 1)).toBe(
      copy.exams.grading.scales.problems.gap("71", "80"),
    );
    expect(bandProblem(check, 0)).toBeNull();
  });

  it("falls back to 'between' for a sub-percent gap", () => {
    const check = checkBands([
      band({ minMarks: "0", maxMarks: "70", gradeLabel: "B" }),
      band({ minMarks: "70.5", maxMarks: "100", gradeLabel: "A" }),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(firstBandProblem(check)).toBe(
      copy.exams.grading.scales.problems.gapBetween("70", "70.5"),
    );
  });

  it("names an overlap by its bands and its range", () => {
    const check = checkBands([
      band({ minMarks: "0", maxMarks: "90", gradeLabel: "B" }),
      band({ minMarks: "85", maxMarks: "100", gradeLabel: "A" }),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(firstBandProblem(check)).toBe(
      copy.exams.grading.scales.problems.overlapRange("A", "B", "85", "90"),
    );
    expect(check.problems[0]?.index).toBe(1);
  });

  it("names a single-point overlap", () => {
    const check = checkBands([
      band({ minMarks: "0", maxMarks: "100", gradeLabel: "B" }),
      band({ minMarks: "50", maxMarks: "50", gradeLabel: "A" }),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(
      check.problems.some(
        (problem) =>
          problem.message ===
          copy.exams.grading.scales.problems.overlapAt("A", "B", "50"),
      ),
    ).toBe(true);
  });

  it("requires the scale to start at 0 and end at 100", () => {
    const low = checkBands([band({ minMarks: "10", maxMarks: "100" })]);
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(firstBandProblem(low)).toBe(
        copy.exams.grading.scales.problems.startsAtZero,
      );
    }

    const high = checkBands([band({ minMarks: "0", maxMarks: "90" })]);
    expect(high.ok).toBe(false);
    if (!high.ok) {
      expect(firstBandProblem(high)).toBe(
        copy.exams.grading.scales.problems.endsAtHundred,
      );
    }
  });

  it("refuses duplicate grade labels", () => {
    const check = checkBands([
      band({ minMarks: "0", maxMarks: "50", gradeLabel: "A" }),
      band({ minMarks: "50", maxMarks: "100", gradeLabel: "A" }),
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]?.index).toBe(1);
    expect(check.problems[0]?.message).toBe(
      copy.exams.grading.scales.problems.duplicateGrade,
    );
  });

  it("refuses a band that ends before it starts", () => {
    const check = checkBands([band({ minMarks: "80", maxMarks: "70" })]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(firstBandProblem(check)).toBe(
        copy.exams.grading.scales.problems.endsBeforeStarts,
      );
    }
  });

  it("refuses malformed percentages and points", () => {
    const percent = checkBands([band({ minMarks: "abc" })]);
    expect(percent.ok).toBe(false);
    if (!percent.ok) {
      expect(firstBandProblem(percent)).toBe(
        copy.exams.grading.scales.problems.percentFormat,
      );
    }

    const point = checkBands([band({ gradePoint: "101" })]);
    expect(point.ok).toBe(false);
    if (!point.ok) {
      expect(firstBandProblem(point)).toBe(
        copy.exams.grading.scales.problems.pointFormat,
      );
    }
  });

  it("requires a grade within ten characters", () => {
    const missing = checkBands([band({ gradeLabel: " " })]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(firstBandProblem(missing)).toBe(
        copy.exams.grading.scales.problems.gradeRequired,
      );
    }

    const long = checkBands([band({ gradeLabel: "ABCDEFGHIJK" })]);
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(firstBandProblem(long)).toBe(
        copy.exams.grading.scales.problems.gradeTooLong,
      );
    }
  });

  it("refuses an empty scale", () => {
    const check = checkBands([]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(firstBandProblem(check)).toBe(
        copy.exams.grading.scales.problems.empty,
      );
    }
  });
});

describe("largestUncoveredInterval", () => {
  it("starts a blank scale at 0–100", () => {
    expect(largestUncoveredInterval([])).toEqual({
      minMarks: "0",
      maxMarks: "100",
    });
  });

  it("offers the hole below a top band", () => {
    expect(
      largestUncoveredInterval([
        band({ minMarks: "90", maxMarks: "100" }),
      ]),
    ).toEqual({ minMarks: "0", maxMarks: "90" });
  });

  it("keeps walking down as bands are added", () => {
    expect(
      largestUncoveredInterval([
        band({ minMarks: "90", maxMarks: "100" }),
        band({ minMarks: "80", maxMarks: "90" }),
      ]),
    ).toEqual({ minMarks: "0", maxMarks: "80" });
  });

  it("picks the widest hole when the middle is missing", () => {
    expect(
      largestUncoveredInterval([
        band({ minMarks: "0", maxMarks: "40" }),
        band({ minMarks: "70", maxMarks: "100" }),
      ]),
    ).toEqual({ minMarks: "40", maxMarks: "70" });
  });

  it("offers nothing once the scale covers 0–100", () => {
    expect(
      largestUncoveredInterval([band({ minMarks: "0", maxMarks: "100" })]),
    ).toBeNull();
  });
});

describe("removeBandAndExtend", () => {
  const top = band({ minMarks: "90", maxMarks: "100", gradeLabel: "A" });
  const middle = band({ minMarks: "80", maxMarks: "90", gradeLabel: "B" });
  const bottom = band({ minMarks: "0", maxMarks: "80", gradeLabel: "C" });

  it("extends the band below when a middle band leaves", () => {
    expect(removeBandAndExtend([top, middle, bottom], 1)).toEqual([
      top,
      { ...bottom, maxMarks: "90" },
    ]);
  });

  it("extends the band below when the top band leaves", () => {
    expect(removeBandAndExtend([top, middle, bottom], 0)).toEqual([
      { ...middle, maxMarks: "100" },
      bottom,
    ]);
  });

  it("extends the band above when the bottom band leaves", () => {
    expect(removeBandAndExtend([top, middle, bottom], 2)).toEqual([
      top,
      { ...middle, minMarks: "0" },
    ]);
  });

  it("removes the only band", () => {
    expect(removeBandAndExtend([top], 0)).toEqual([]);
  });

  it("removes a malformed band without guessing a donor", () => {
    const broken = band({ minMarks: "x", maxMarks: "y" });
    expect(removeBandAndExtend([top, broken], 1)).toEqual([top]);
  });
});

describe("resolveGrade", () => {
  const bands = [
    band({ minMarks: "90", maxMarks: "100", gradeLabel: "A1", gradePoint: "10" }),
    band({ minMarks: "80", maxMarks: "90", gradeLabel: "A2", gradePoint: "9" }),
    band({ minMarks: "0", maxMarks: "80", gradeLabel: "B" }),
  ];

  it("reads a shared boundary as the upper band", () => {
    expect(resolveGrade(bands, "90")).toEqual({
      gradeLabel: "A1",
      gradePoint: "10",
    });
    expect(resolveGrade(bands, "89.99")).toEqual({
      gradeLabel: "A2",
      gradePoint: "9",
    });
  });

  it("covers the ends", () => {
    expect(resolveGrade(bands, "0")?.gradeLabel).toBe("B");
    expect(resolveGrade(bands, "100")?.gradeLabel).toBe("A1");
  });

  it("returns null for a malformed or out-of-range score", () => {
    expect(resolveGrade(bands, "101")).toBeNull();
    expect(resolveGrade(bands, "")).toBeNull();
    expect(resolveGrade(bands, "abc")).toBeNull();
  });

  it("returns null when the bands leave a hole", () => {
    expect(resolveGrade([band({ minMarks: "80", maxMarks: "100" })], "70")).toBeNull();
  });
});

describe("sharedEdge", () => {
  it("names the highest boundary and the grade that owns it", () => {
    expect(
      sharedEdge([
        band({ minMarks: "0", maxMarks: "80", gradeLabel: "B" }),
        band({ minMarks: "90", maxMarks: "100", gradeLabel: "A1" }),
        band({ minMarks: "80", maxMarks: "90", gradeLabel: "A2" }),
      ]),
    ).toEqual({ value: "90", label: "A1" });
  });

  it("stays quiet without a shared edge", () => {
    expect(
      sharedEdge([
        band({ minMarks: "0", maxMarks: "90", gradeLabel: "B" }),
        band({ minMarks: "91", maxMarks: "100", gradeLabel: "A1" }),
      ]),
    ).toBeNull();
    expect(sharedEdge([band({ gradeLabel: "" })])).toBeNull();
  });
});

describe("band sentence and payload", () => {
  function row(args: Partial<BandRowLike> = {}): BandRowLike {
    return {
      minMarks: "0.00",
      maxMarks: "100.00",
      gradeLabel: "A",
      gradePoint: null,
      sequenceNumber: 0,
      ...args,
    };
  }

  it("prints the scale in card order", () => {
    expect(
      bandSentence([
        row({ minMarks: "0.00", maxMarks: "80.00", gradeLabel: "B", sequenceNumber: 2 }),
        row({ minMarks: "90.00", maxMarks: "100.00", gradeLabel: "A1", sequenceNumber: 0 }),
        row({ minMarks: "80.00", maxMarks: "90.00", gradeLabel: "A2", sequenceNumber: 1 }),
      ]),
    ).toBe("A1 90–100 · A2 80–90 · B 0–80");
  });

  it("converts rows to drafts in card order", () => {
    expect(
      bandDraftsFromRows([
        row({ sequenceNumber: 1, gradeLabel: "B" }),
        row({ sequenceNumber: 0, gradeLabel: "A", gradePoint: "9.00" }),
      ]),
    ).toEqual([
      {
        minMarks: "0",
        maxMarks: "100",
        gradeLabel: "A",
        gradePoint: "9",
        descriptor: null,
      },
      {
        minMarks: "0",
        maxMarks: "100",
        gradeLabel: "B",
        gradePoint: "",
        descriptor: null,
      },
    ]);
  });

  it("canonicalises numbers, drops an empty point and keeps a descriptor", () => {
    expect(
      bandsPayload([
        band({
          minMarks: "090.10",
          maxMarks: "100",
          gradeLabel: " A1 ",
          gradePoint: "9.00",
          descriptor: " Outstanding ",
        }),
        band({ minMarks: "0", maxMarks: "90.1", gradeLabel: "B" }),
      ]),
    ).toEqual([
      {
        minMarks: "90.1",
        maxMarks: "100",
        gradeLabel: "A1",
        gradePoint: "9",
        descriptor: "Outstanding",
        sequenceNumber: 0,
      },
      {
        minMarks: "0",
        maxMarks: "90.1",
        gradeLabel: "B",
        gradePoint: null,
        sequenceNumber: 1,
      },
    ]);
  });

  it("keys drafts without treating '90.0' as a change from '90'", () => {
    expect(bandsKey([band({ minMarks: "0", maxMarks: "90.0" })])).toBe(
      bandsKey([band({ minMarks: "0.00", maxMarks: "90" })]),
    );
    expect(bandsKey([band({ gradeLabel: "A" })])).not.toBe(
      bandsKey([band({ gradeLabel: "B" })]),
    );
  });

  it("covers and gaps a scale for the bar", () => {
    expect(
      coverageSegments([
        band({ minMarks: "0", maxMarks: "40" }),
        band({ minMarks: "60", maxMarks: "100" }),
      ]),
    ).toEqual({
      segments: [
        { from: 0, to: 4000 },
        { from: 6000, to: 10000 },
      ],
      gaps: [{ from: 4000, to: 6000 }],
    });
  });
});
