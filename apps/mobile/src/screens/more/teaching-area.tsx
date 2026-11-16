import { View } from "react-native";
import { router } from "expo-router";

import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { groupMyTeaching, teachingLine } from "../staff/teaching-logic";
import { AREAS } from "./areas";
import { Head, Hero, Panel, Row, Shortcuts } from "./parts";
import type { Hue, Shortcut } from "./parts";

const look = AREAS.teaching;
const hue: Hue = { fg: look.h0, bg: look.tint };

/**
 * Teaching in More, for someone who teaches but does not see the staff room:
 * what they teach, their sections with today's attendance, and their doors.
 */
export function TeachingArea() {
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const { has } = usePermissions();
  const running = Boolean(academicYear && currentYear && academicYear.id === currentYear.id);
  const ready = Boolean(organizationId && schoolId) && running;
  const mine = trpc.assignment.mine.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: ready, staleTime: 60_000 },
  );
  const attendance = trpc.home.attendanceToday.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", academicYearId: currentYear?.id ?? "", date: todayIso() },
    { enabled: ready && has("attendance:read"), staleTime: 30_000 },
  );

  const rows = mine.data ?? [];
  const groups = groupMyTeaching(rows);
  const line = teachingLine(rows);
  const sectionIds = [...new Set(rows.map((row) => row.sectionId))];
  const day = new Map((attendance.data?.sections ?? []).map((section) => [section.sectionId, section]));

  const shortcuts: Shortcut[] = [
    has("marks:create") ? { key: "marks", label: "Enter marks", icon: "marks", hue, add: true, onPress: () => router.push("/exams") } : null,
    has("homework:create") ? { key: "homework", label: "Give homework", icon: "homework", hue, add: true, onPress: () => router.push("/homework/give") } : null,
    has("attendance:create") ? { key: "mark", label: "Mark attendance", icon: "attendance", hue, add: true, onPress: () => router.navigate("/attendance") } : null,
    has("teacher_assignment:read") ? { key: "teaching", label: "Who teaches what", icon: "school", hue, onPress: () => router.push("/teaching") } : null,
  ].filter((item): item is Shortcut => item !== null);

  return (
    <View>
      <Hero
        h0={look.h0}
        h1={look.h1}
        kicker={academicYear?.name}
        title={groups.classTeacher ? `Class teacher of ${groups.classTeacher}` : line ? "Your teaching" : "No classes yet"}
        sub={line ?? "The office hasn't given you any classes for this session."}
        testID="more-teaching-hero"
      />

      {shortcuts.length > 0 ? (
        <>
          <Head title="Go to" />
          <Shortcuts items={shortcuts} />
        </>
      ) : null}

      {sectionIds.length > 0 ? (
        <>
          <Head title="Your classes" />
          <Panel>
            {sectionIds.map((id, index) => {
              const own = rows.filter((row) => row.sectionId === id);
              const first = own[0]!;
              const label = `${first.className.replace(/^class\s+/i, "")}-${first.sectionName}`.replace(/^(.+)-\1$/, "$1");
              const subjects = own.filter((row) => row.subjectName).map((row) => row.subjectName);
              const isClassTeacher = own.some((row) => row.role === "class_teacher");
              const today = day.get(id);
              return (
                <Row
                  key={id}
                  first={index === 0}
                  icon={isClassTeacher ? "star" : "subject"}
                  hue={hue}
                  title={label}
                  meta={[
                    isClassTeacher ? "Class teacher" : null,
                    subjects.length > 0 ? subjects.join(", ") : null,
                    today ? (today.marked > 0 ? `${today.present} of ${today.students} present` : "Not marked today") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              );
            })}
          </Panel>
        </>
      ) : null}
    </View>
  );
}
