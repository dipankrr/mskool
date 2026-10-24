import {
  admissionFromFileName,
  fitsWireLimit,
  matchByAdmission,
  matchByOrder,
  photosInCaptureOrder,
  resizePlan,
  rosterInMarkingOrder,
  type PickedPhoto,
  type RosterEntry,
} from "./photo-matching";

const ROSTER: RosterEntry[] = [
  {
    studentId: "s2",
    admissionNumber: "2026-0002",
    name: "Bose Anita",
    rollNumber: "2",
  },
  {
    studentId: "s1",
    admissionNumber: "2026-0001",
    name: "Aditi Sharma",
    rollNumber: "1",
  },
  {
    studentId: "s3",
    admissionNumber: "2026-0003",
    name: "Chetan Rao",
    rollNumber: null,
  },
];

function photo(overrides: Partial<PickedPhoto> = {}): PickedPhoto {
  return {
    localUri: "file:///tmp/x.jpg",
    fileName: null,
    creationTime: null,
    width: 800,
    height: 600,
    ...overrides,
  };
}

describe("rosterInMarkingOrder", () => {
  it("orders by roll, unnumbered last by name", () => {
    expect(rosterInMarkingOrder(ROSTER).map((entry) => entry.studentId)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });
});

describe("photosInCaptureOrder", () => {
  it("sorts by creation time, stable without one", () => {
    const photos = [
      photo({ localUri: "b", creationTime: 200 }),
      photo({ localUri: "no-time" }),
      photo({ localUri: "a", creationTime: 100 }),
    ];
    expect(photosInCaptureOrder(photos).map((p) => p.localUri)).toEqual([
      "a",
      "b",
      "no-time",
    ]);
  });
});

describe("matchByOrder", () => {
  it("maps capture order onto roll order", () => {
    const result = matchByOrder(
      [
        photo({ localUri: "second", creationTime: 200 }),
        photo({ localUri: "first", creationTime: 100 }),
      ],
      ROSTER,
    );
    expect(result.matches[0]).toEqual({
      studentId: "s1",
      photo: photo({ localUri: "first", creationTime: 100 }),
    });
    expect(result.matches[1]?.studentId).toBe("s2");
    expect(result.unmatched).toEqual([]);
  });

  it("marks extra photos unmatched", () => {
    const result = matchByOrder(
      [photo(), photo(), photo(), photo({ localUri: "extra" })],
      ROSTER,
    );
    expect(result.matches).toHaveLength(3);
    expect(result.unmatched).toHaveLength(1);
  });
});

describe("matchByAdmission", () => {
  it("matches stems to admission numbers, case and extension aside", () => {
    const result = matchByAdmission(
      [
        photo({ fileName: "2026-0001.jpg" }),
        photo({ fileName: "IMG_2026_0002.JPG" }),
      ],
      ROSTER,
    );
    expect(result.matches[0]?.studentId).toBe("s1");
    // "IMG_2026_0002" is not the admission number — it stays unmatched.
    expect(result.matches).toHaveLength(1);
    expect(result.unmatched).toHaveLength(1);
  });

  it("matches the bare stem", () => {
    const result = matchByAdmission([photo({ fileName: "2026-0002.png" })], ROSTER);
    expect(result.matches[0]?.studentId).toBe("s2");
  });

  it("never matches files without names", () => {
    const result = matchByAdmission([photo({ fileName: null })], ROSTER);
    expect(result.matches).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });
});

describe("admissionFromFileName", () => {
  it("strips the extension and whitespace", () => {
    expect(admissionFromFileName("2026-0001 .jpg")).toBe("2026-0001");
    expect(admissionFromFileName(null)).toBeNull();
    expect(admissionFromFileName(".jpg")).toBeNull();
  });
});

describe("resize ladder", () => {
  it("shrinks per attempt and stops", () => {
    expect(resizePlan(0)).toEqual({ maxEdge: 800, quality: 0.8 });
    expect(resizePlan(2)).toEqual({ maxEdge: 400, quality: 0.6 });
    expect(resizePlan(3)).toBeNull();
  });

  it("checks the decoded ceiling on the base64", () => {
    // 512 KB decoded ↔ exactly 699,050 base64 chars (bytes × 4/3, floored).
    const bytes = 512 * 1024;
    expect(fitsWireLimit("A".repeat(Math.floor((bytes * 4) / 3)))).toBe(true);
    expect(fitsWireLimit("A".repeat(Math.floor((bytes * 4) / 3) + 1))).toBe(
      false,
    );
  });
});
