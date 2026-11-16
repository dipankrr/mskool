import { fireEvent, render, screen } from "@testing-library/react-native";
import type { HomePaper, HomeSectionDay } from "@repo/contracts";

import type { Pair } from "./home-logic";
import { MyAttendance, YouTeach, clockIst } from "./teaching-parts";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number, marked: number): HomeSectionDay => ({
  sectionId: uuid(n),
  sectionName: "A",
  classId: uuid(100 + n),
  className: `Class ${n}`,
  students: 40,
  marked,
  present: marked,
  markedBy: marked ? { userId: "u", name: "Meena", at: "2026-11-18T03:17:00.000Z" } : null,
});

describe("MyAttendance", () => {
  it("one unmarked section is the big Mark today card", async () => {
    await render(<MyAttendance mode="single" own={[day(6, 0)]} classTeacherSections={new Set([uuid(6)])} covers={new Map()} />);
    expect(screen.getByText("Mark today")).toBeTruthy();
    expect(screen.getByText("Your class · 6-A")).toBeTruthy();
    expect(screen.getByText("Start marking")).toBeTruthy();
  });

  it("several sections list the unmarked with Mark and the marked with who marked", async () => {
    await render(<MyAttendance mode="list" own={[day(3, 0), day(7, 38)]} classTeacherSections={new Set()} covers={new Map()} />);
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getByText("Mark")).toBeTruthy();
    expect(screen.getByText("Marked by Meena, 8:47")).toBeTruthy();
  });

  it("from six sections the marked ones fold, and open on tap", async () => {
    const own = [day(1, 0), day(2, 30), day(3, 30), day(4, 30), day(5, 30), day(6, 30)];
    await render(<MyAttendance mode="list" own={own} classTeacherSections={new Set()} covers={new Map()} />);
    expect(screen.getByText("5 more marked")).toBeTruthy();
    expect(screen.queryAllByText(/Marked by Meena/)).toHaveLength(0);
    await fireEvent.press(screen.getByText("5 more marked"));
    expect(screen.getAllByText(/Marked by Meena/)).toHaveLength(5);
  });

  it("all marked is one green line", async () => {
    await render(<MyAttendance mode="done" own={[day(1, 30), day(2, 30)]} classTeacherSections={new Set()} covers={new Map()} />);
    expect(screen.getByText("All 2 sections marked")).toBeTruthy();
  });

  it("reads the marking time in IST", () => {
    expect(clockIst("2026-11-18T03:17:00.000Z")).toBe("8:47");
    expect(clockIst("2026-11-18T09:00:00.000Z")).toBe("2:30");
  });
});

describe("YouTeach", () => {
  const pair = (n: number, subject: string, subjectId: string): Pair => ({
    sectionId: uuid(n),
    label: `${n}-A`,
    classId: uuid(100 + n),
    subjectId,
    subjectName: subject,
    cover: null,
  });
  const pairs = [pair(6, "Maths", "m"), pair(7, "Maths", "m"), pair(7, "Science", "s")];
  const papers: HomePaper[] = [
    {
      examId: uuid(1),
      examName: "Half-yearly",
      scheduleId: uuid(2),
      sectionId: uuid(7),
      sectionName: "A",
      className: "Class 7",
      subjectId: "m",
      subjectName: "Maths",
      examDate: "2026-11-10",
      students: 40,
      entered: 12,
    },
  ];

  it("groups by subject with one word of state per section", async () => {
    await render(<YouTeach pairs={pairs} papers={papers} today="2026-11-18" classTeacherLabels={[]} />);
    expect(screen.getByText("Maths")).toBeTruthy();
    expect(screen.getByText("2 sections")).toBeTruthy();
    expect(screen.getByText("12/40")).toBeTruthy();
  });

  it("switches to the class grid", async () => {
    await render(<YouTeach pairs={pairs} papers={papers} today="2026-11-18" classTeacherLabels={["6-A"]} />);
    await fireEvent.press(screen.getByText("Class"));
    expect(screen.getByText("7-A")).toBeTruthy();
    expect(screen.getByText("Class teacher of 6-A")).toBeTruthy();
  });
});
