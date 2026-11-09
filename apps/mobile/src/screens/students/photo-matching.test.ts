import {
  admissionFromFileName,
  admissionsToLookUp,
  captureTimeFromExif,
  matchByAdmission,
  matchByOrder,
  mergePhotos,
  movePhoto,
  photosInCaptureOrder,
  photosInNameOrder,
  runPool,
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
    id: overrides.localUri ?? `p${Math.random()}`,
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
  it("maps the sorted batch onto roll order", () => {
    const result = matchByOrder(
      photosInCaptureOrder([
        photo({ localUri: "second", creationTime: 200 }),
        photo({ localUri: "first", creationTime: 100 }),
      ]),
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

describe("captureTimeFromExif", () => {
  it("reads Android top-level and iOS nested tags", () => {
    const android = captureTimeFromExif({ DateTimeOriginal: "2026:11:09 10:42:07" });
    const ios = captureTimeFromExif({
      "{Exif}": { DateTimeOriginal: "2026:11:09 10:42:08" },
    });
    expect(android).toBe(Date.UTC(2026, 10, 9, 10, 42, 7));
    expect(ios! - android!).toBe(1000);
  });
  it("gives null without a usable date", () => {
    expect(captureTimeFromExif(null)).toBeNull();
    expect(captureTimeFromExif({ DateTimeOriginal: "garbage" })).toBeNull();
  });
});

describe("photosInNameOrder", () => {
  it("compares numbers as numbers, unnamed last", () => {
    const photos = [
      photo({ localUri: "c", fileName: "IMG_10.jpg" }),
      photo({ localUri: "x", fileName: null }),
      photo({ localUri: "a", fileName: "IMG_2.jpg" }),
    ];
    expect(photosInNameOrder(photos).map((p) => p.localUri)).toEqual(["a", "c", "x"]);
  });
});

describe("mergePhotos and movePhoto", () => {
  it("adds only new photos", () => {
    const { photos, added } = mergePhotos(
      [photo({ localUri: "a" })],
      [photo({ localUri: "a" }), photo({ localUri: "b" })],
    );
    expect(added).toBe(1);
    expect(photos.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("swaps with a neighbour and ignores the edges", () => {
    const photos = [photo({ localUri: "a" }), photo({ localUri: "b" })];
    expect(movePhoto(photos, "a", 1).map((p) => p.id)).toEqual(["b", "a"]);
    expect(movePhoto(photos, "a", -1)).toBe(photos);
  });
});

describe("matchByOrder with skipped students", () => {
  it("hands a skipped student's turn to the next one", () => {
    const result = matchByOrder(
      [photo({ localUri: "first" }), photo({ localUri: "second" })],
      ROSTER,
      new Set(["s1"]),
    );
    expect(result.matches.map((m) => [m.studentId, m.photo.id])).toEqual([
      ["s2", "first"],
      ["s3", "second"],
    ]);
  });
});

describe("admissionsToLookUp", () => {
  it("dedupes stems case-insensitively", () => {
    expect(
      admissionsToLookUp([
        photo({ fileName: "2026-0001.jpg" }),
        photo({ fileName: "2026-0001.JPG" }),
        photo({ fileName: null }),
      ]),
    ).toEqual(["2026-0001"]);
  });
});

describe("runPool", () => {
  it("keeps at most the limit running and survives failures", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      seen.push(n);
      if (n === 2) throw new Error("blip");
    });
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
