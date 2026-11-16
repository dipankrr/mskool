import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { Href } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { formatReadableDate, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { AREAS } from "./areas";
import { Chip, Head, Hero, HeroStats, Panel, Row, Shortcuts, TimeLine, caution, positive } from "./parts";
import type { Hue, Shortcut } from "./parts";
import { currentTerm, fraction, weekOf } from "./time";

const look = AREAS.academics;
const hue: Hue = { fg: look.h0, bg: look.tint };

/**
 * Academics in More: where the year stands (the term line), how complete the
 * set-up is, four doors, and every class with its sections. A section with no
 * class teacher is an amber chip; a class with no subjects says so.
 */
export function AcademicsArea() {
  const { organizationId, schoolId, academicYear, currentYear, ready } = useActiveContext();
  const { has } = usePermissions();
  const today = todayIso();
  const orgReady = ready && Boolean(organizationId);
  const hasYear = Boolean(academicYear?.id);
  const orgArgs = { organizationId: organizationId ?? "", schoolId: schoolId ?? "" };
  const yearArgs = { ...orgArgs, academicYearId: academicYear?.id ?? "" };
  const running = Boolean(academicYear && currentYear && academicYear.id === currentYear.id);

  const classes = trpc.academic.class.list.useQuery(orgArgs, { enabled: orgReady && has("class:read"), staleTime: 300_000 });
  const sections = trpc.academic.section.list.useQuery(yearArgs, { enabled: orgReady && hasYear && has("section:read"), staleTime: 60_000 });
  const subjects = trpc.subject.list.useQuery(orgArgs, { enabled: orgReady && has("subject:read"), staleTime: 300_000 });
  const coverage = trpc.assignment.subjectMapping.coverage.useQuery(yearArgs, {
    enabled: orgReady && hasYear && has("subject:read"),
    staleTime: 120_000,
  });
  const terms = trpc.academic.term.list.useQuery(yearArgs, { enabled: orgReady && hasYear && has("academic_year:read"), staleTime: 300_000 });
  const overview = trpc.assignment.overview.useQuery(yearArgs, {
    enabled: orgReady && hasYear && Boolean(schoolId) && has("teacher_assignment:read"),
    staleTime: 120_000,
    retry: false,
  });
  const roster = trpc.student.rosterSummary.useQuery(yearArgs, {
    enabled: orgReady && hasYear && Boolean(schoolId) && has("student:read"),
    staleTime: 120_000,
    retry: false,
  });

  const classRows = [...(classes.data ?? [])].sort((a, b) => a.numericOrder - b.numericOrder);
  const activeSections = (sections.data ?? []).filter((row) => row.status === "active");
  const termRows = [...(terms.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const term = running ? currentTerm(termRows, today) : null;
  const termIndex = term ? termRows.indexOf(term) + 1 : 0;
  const mapped = coverage.data ? new Set(coverage.data.map((pair) => pair.classId)) : null;
  const noTeacher = new Set(
    overview.data?.classTeachersEnabled
      ? overview.data.sections.filter((row) => !row.classTeacher).map((row) => row.sectionId)
      : [],
  );

  // The hero: the running term's week, or the session itself.
  const week = term ? weekOf(term, today) : null;
  // The next term to start; test data can hold terms that overlap.
  const next = term ? termRows.find((row) => row.startDate > today) ?? null : null;
  const title = term && week ? `Week ${week.week} of ${week.weeks}` : (academicYear?.name ?? "Academics");
  const sub = term
    ? [`${term.name} runs to ${formatReadableDate(term.endDate)}`, next ? `${next.name} starts ${formatReadableDate(next.startDate)}` : null]
        .filter(Boolean)
        .join("; ")
    : termRows.length === 0
      ? "No terms set for this session"
      : running
        ? "Between terms"
        : "Not the running session";
  const yearSpan = academicYear ? { from: academicYear.startDate, to: academicYear.endDate } : null;

  // Setup health: each line only when its read is allowed and has arrived.
  const health: { key: string; ok: boolean; title: string; meta: string; action?: { label: string; onPress: () => void } }[] = [];
  if (classes.data && sections.data) {
    const empty = classRows.filter((cls) => !activeSections.some((row) => row.classId === cls.id));
    health.push({
      key: "sections",
      ok: empty.length === 0,
      title: "Sections",
      meta: empty.length === 0 ? "Every class has at least one" : `${empty.length} ${empty.length === 1 ? "class has" : "classes have"} none`,
      action: empty.length > 0 && has("section:create") ? { label: "Add", onPress: () => router.push("/class-section") } : undefined,
    });
  }
  if (classes.data && mapped) {
    const missing = classRows.filter((cls) => !mapped.has(cls.id)).length;
    health.push({
      key: "mapping",
      ok: missing === 0,
      title: "Subjects mapped",
      meta: `${classRows.length - missing} of ${classRows.length} classes`,
      action: missing > 0 && has("subject:update") ? { label: `Map ${missing}`, onPress: () => router.push("/subject-mapping") } : undefined,
    });
  }
  if (overview.data?.classTeachersEnabled && overview.data.sections.length > 0) {
    const total = overview.data.sections.length;
    health.push({
      key: "class-teachers",
      ok: noTeacher.size === 0,
      title: "Class teachers",
      meta: `${total - noTeacher.size} of ${total} sections`,
      action: noTeacher.size > 0 && has("teacher_assignment:create") ? { label: "Assign", onPress: () => router.push("/teaching") } : undefined,
    });
  }
  if (terms.data) {
    health.push({
      key: "terms",
      ok: termRows.length > 0,
      title: "Terms",
      meta: termRows.length > 0 ? `${termRows.length} ${termRows.length === 1 ? "term" : "terms"} this session` : "None yet",
      action: termRows.length === 0 && has("academic_year:create") ? { label: "Add", onPress: () => router.push("/term-form") } : undefined,
    });
  }
  const toFix = health.filter((line) => !line.ok).length;

  const create = (pathname: string): Href => ({ pathname, params: { create: "1" } }) as Href;
  const shortcuts: Shortcut[] = [
    has("class:create") ? { key: "add-class", label: "Add a class", icon: "stack", hue, add: true, onPress: () => router.push(create("/class-section")) } : null,
    has("section:create") ? { key: "add-section", label: "Add a section", icon: "room", hue, add: true, onPress: () => router.push("/class-section") } : null,
    has("subject:create") ? { key: "add-subject", label: "Add a subject", icon: "subject", hue, add: true, onPress: () => router.push(create("/subject-mapping")) } : null,
    has("subject:update") ? { key: "map", label: "Map subjects", icon: "mapping", hue, onPress: () => router.push("/subject-mapping") } : null,
    has("class:read") ? { key: "classes", label: "Classes", icon: "stack", hue, onPress: () => router.push("/class-section") } : null,
    has("subject:read") ? { key: "subjects", label: "Subjects", icon: "subject", hue, onPress: () => router.push("/subject-mapping") } : null,
    has("academic_year:read") && hasYear ? { key: "terms", label: "Terms", icon: "calendar", hue, onPress: () => router.push("/terms") } : null,
  ].filter((item): item is Shortcut => item !== null);

  return (
    <View>
      <Hero
        h0={look.h0}
        h1={look.h1}
        kicker={[academicYear?.name, term ? `${term.name}${termRows.length > 1 ? ` · ${termIndex} of ${termRows.length}` : ""}` : null].filter(Boolean).join(" · ")}
        title={title}
        sub={sub}
        testID="more-academics-hero"
      >
        {yearSpan && termRows.length > 0 ? (
          <TimeLine
            todayAt={running ? fraction(yearSpan.from, yearSpan.to, today) : null}
            segments={termRows.map((row) => ({
              key: row.id,
              from: fraction(yearSpan.from, yearSpan.to, row.startDate),
              to: fraction(yearSpan.from, yearSpan.to, row.endDate),
              fill: running ? fraction(row.startDate, row.endDate, today) : 0,
              label: termRows.length <= 4 ? row.name : null,
            }))}
          />
        ) : null}
        <HeroStats
          stats={[
            { key: "classes", value: classes.data?.length, label: "classes" },
            { key: "sections", value: sections.data ? activeSections.length : null, label: "sections" },
            { key: "subjects", value: subjects.data?.length, label: "subjects" },
            { key: "students", value: roster.data?.counts.current, label: "students" },
          ]}
        />
      </Hero>

      {health.length > 0 ? (
        <>
          <Head title="Setup health" pill={toFix > 0 ? { text: `${toFix} to fix`, hue: caution } : { text: "All set", hue: positive }} />
          <Panel testID="more-academics-health">
            {health.map((line, index) => (
              <Row
                key={line.key}
                first={index === 0}
                icon={line.ok ? "check" : "warning"}
                hue={line.ok ? positive : caution}
                title={line.title}
                meta={line.meta}
                action={line.action ?? null}
              />
            ))}
          </Panel>
        </>
      ) : null}

      <Head title="Go to" />
      <Shortcuts items={shortcuts} />

      {classRows.length > 0 ? (
        <>
          <Head title="Classes" link={{ label: String(classRows.length), onPress: () => router.push("/class-section") }} />
          <Panel>
            {classRows.map((cls, index) => {
              const own = activeSections.filter((row) => row.classId === cls.id).sort((a, b) => a.name.localeCompare(b.name));
              const unmapped = mapped ? !mapped.has(cls.id) : false;
              return (
                <View key={cls.id} style={[styles.classRow, index === 0 ? null : styles.rule]}>
                  <View style={styles.grow}>
                    <ThemedText variant="bodyStrong">{cls.name}</ThemedText>
                    <View style={styles.chips}>
                      {own.length === 0 ? (
                        <ThemedText variant="meta">No sections</ThemedText>
                      ) : (
                        own.map((row) => (
                          <View
                            key={row.id}
                            style={[styles.sec, noTeacher.has(row.id) ? styles.secWarn : null]}
                            accessible
                            accessibilityLabel={`Section ${row.name}${noTeacher.has(row.id) ? ", no class teacher" : ""}`}
                          >
                            <ThemedText variant="caption" color={noTeacher.has(row.id) ? colors.tone.caution.fg : colors.ink}>
                              {row.name.replace(cls.name, "").replace(/^[\s-]+/, "") || row.name}
                            </ThemedText>
                          </View>
                        ))
                      )}
                      {unmapped ? <Chip text="No subjects" hue={caution} /> : null}
                    </View>
                  </View>
                  <AppIcon name="chevronRight" size={16} color={colors.chevron} />
                </View>
              );
            })}
          </Panel>
          {noTeacher.size > 0 ? (
            <ThemedText variant="meta" style={styles.legend}>
              Amber sections have no class teacher yet.
            </ThemedText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: {
    flex: 1,
    minWidth: 0,
  },
  classRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
  },
  rule: {
    borderTopWidth: 1,
    borderTopColor: "rgba(16, 24, 40, 0.08)",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  sec: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm - 4,
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  secWarn: {
    backgroundColor: colors.tone.caution.bg,
  },
  legend: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.xs,
  },
});
