import { deriveRoleWord } from "./role-word";
import type { TeacherAssignmentRow } from "./role-word";

const row = (
  overrides: Partial<TeacherAssignmentRow>,
): TeacherAssignmentRow => ({
  userId: "u1",
  role: "class_teacher",
  effectiveTo: null,
  ...overrides,
});

describe("deriveRoleWord", () => {
  describe("with readable assignment rows (precise source)", () => {
    it("claims the word for the caller's live class_teacher row", () => {
      expect(
        deriveRoleWord({
          assignmentRows: [row({})],
          userId: "u1",
          roleTypes: [],
          sectionCount: 3,
        }),
      ).toBe("class_teacher");
    });

    it("stays silent when the row belongs to someone else", () => {
      expect(
        deriveRoleWord({
          assignmentRows: [row({ userId: "other" })],
          userId: "u1",
          roleTypes: ["class_teacher"],
          sectionCount: 1,
        }),
      ).toBeNull();
    });

    it("stays silent for an ended row", () => {
      expect(
        deriveRoleWord({
          assignmentRows: [row({ effectiveTo: "2026-03-31T00:00:00.000Z" })],
          userId: "u1",
          roleTypes: ["class_teacher"],
          sectionCount: 1,
        }),
      ).toBeNull();
    });

    it("stays silent when only a subject_teacher row matches", () => {
      expect(
        deriveRoleWord({
          assignmentRows: [row({ role: "subject_teacher" })],
          userId: "u1",
          roleTypes: ["class_teacher"],
          sectionCount: 1,
        }),
      ).toBeNull();
    });
  });

  describe("without readable rows (union fallback)", () => {
    it("claims the word for a single visible section", () => {
      expect(
        deriveRoleWord({
          assignmentRows: undefined,
          userId: "u1",
          roleTypes: ["class_teacher"],
          sectionCount: 1,
        }),
      ).toBe("class_teacher");
    });

    it("stays silent with several sections — the union cannot pick one", () => {
      expect(
        deriveRoleWord({
          assignmentRows: undefined,
          userId: "u1",
          roleTypes: ["class_teacher", "subject_teacher"],
          sectionCount: 2,
        }),
      ).toBeNull();
    });

    it("stays silent when the role union lacks class_teacher", () => {
      expect(
        deriveRoleWord({
          assignmentRows: undefined,
          userId: "u1",
          roleTypes: ["subject_teacher"],
          sectionCount: 1,
        }),
      ).toBeNull();
    });
  });
});
