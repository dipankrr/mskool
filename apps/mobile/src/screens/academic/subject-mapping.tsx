import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { IconTile } from "../../components/icon-tile";
import { Notice } from "../../components/notice";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing, touch } from "../../theme/tokens";
import { AcademicListFrame } from "./list-frame";
import { MapToClassesSheet } from "./map-classes-sheet";
import { BulkMapSheet, EditMappingSheet } from "./mapping-sheets";
import { SubjectSheet } from "./subject-sheet";

type SubjectRow = inferRouterOutputs<AppRouter>["subject"]["list"][number];

/**
 * The school's subjects and which classes take them, on one screen. All
 * subjects is the catalogue, a class tab is that class's curriculum for the
 * running session, and subjects work with no session while mapping waits for one.
 *
 * Coverage ("13 of 15 classes") comes from one read for the session, since
 * mappings can otherwise only be listed a class at a time. Each control checks
 * its own permission; the screen as a whole needs only `subject:read`.
 */
export function SubjectMappingScreen() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const meta = useBranchMeta();
  const { has } = usePermissions();
  const text = copy.academic.subjectMapping;

  const canRead = has("subject:read");
  const canCreate = has("subject:create");
  const canEditSubject = has("subject:update") || has("subject:delete");
  const canEditMapping = has("subject:update") || has("subject:delete");
  const canReadTypes = has("exam:read");
  const canReadClasses = has("class:read");

  const orgEnabled = ready && Boolean(organizationId);
  const yearId = academicYear?.id ?? "";
  const hasYear = Boolean(yearId);
  const orgArgs = { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined };

  const subjects = trpc.subject.list.useQuery(orgArgs, { enabled: orgEnabled && canRead });
  const classes = trpc.academic.class.list.useQuery(orgArgs, {
    enabled: orgEnabled && canReadClasses,
  });
  const types = trpc.exam.subjectTypes.list.useQuery(orgArgs, {
    enabled: orgEnabled && canReadTypes,
    retry: false,
  });
  const coverage = trpc.assignment.subjectMapping.coverage.useQuery(
    { organizationId: organizationId ?? "", academicYearId: yearId },
    { enabled: orgEnabled && canRead && hasYear },
  );

  const [selectedClassId, setSelectedClassId] = useState<string | null>(params.classId ?? null);
  const mappings = trpc.assignment.subjectMapping.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: yearId,
      classId: selectedClassId ?? "",
    },
    { enabled: orgEnabled && canRead && hasYear && Boolean(selectedClassId) },
  );

  const [sheet, setSheet] = useState<
    | { kind: "subject"; row: SubjectRow | null }
    | { kind: "bulk" }
    | { kind: "mapping"; id: string }
    | { kind: "classes"; row: SubjectRow }
    | null
  >(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const subjectRows = subjects.data ?? [];
  const classRows = classes.data ?? [];
  const typeRows = types.data ?? [];
  const pairs = coverage.data ?? [];

  const classIdsBySubject = new Map<string, Set<string>>();
  const mappedClasses = new Set<string>();
  for (const pair of pairs) {
    mappedClasses.add(pair.classId);
    const set = classIdsBySubject.get(pair.subjectId) ?? new Set<string>();
    set.add(pair.classId);
    classIdsBySubject.set(pair.subjectId, set);
  }

  const selectedClass = classRows.find((row) => row.id === selectedClassId) ?? null;
  const mappingRows = selectedClassId ? (mappings.data ?? []) : [];
  const mappedHere = new Set(mappingRows.map((row) => row.subjectId));
  const subjectName = (id: string) =>
    subjectRows.find((row) => row.id === id)?.name ?? null;
  const typeName = (id: string) => typeRows.find((row) => row.id === id)?.name ?? null;
  const editing =
    sheet?.kind === "mapping"
      ? (mappingRows.find((row) => row.id === sheet.id) ?? null)
      : null;

  const savedAndClosed = (message: string) => {
    setSheet(null);
    setSaved(message);
  };

  const tabs =
    canRead && canReadClasses && classRows.length > 0 ? (
      <ClassTabs
        classes={classRows}
        selectedId={selectedClassId}
        missingIds={
          coverage.data
            ? new Set(classRows.filter((row) => !mappedClasses.has(row.id)).map((row) => row.id))
            : new Set<string>()
        }
        onSelect={(id) => {
          void Haptics.selectionAsync();
          setSelectedClassId(id);
        }}
      />
    ) : undefined;

  const allSubjects = (
    <>
      <ThemedText variant="meta">{text.subjectsInSchool(subjectRows.length)}</ThemedText>
      {subjectRows.length === 0 ? (
        <EmptyState
          icon="subject"
          title={copy.academic.subjects.emptyTitle}
          message={copy.academic.subjects.emptyBody}
          testID="subject-mapping-empty"
        >
          {canCreate ? (
            <CapsuleButton
              title={copy.academic.subjects.add}
              icon="add"
              onPress={() => setSheet({ kind: "subject", row: null })}
              testID="subject-mapping-empty-add"
            />
          ) : null}
        </EmptyState>
      ) : (
        <Card padless testID="subject-mapping-all">
          {canCreate ? (
            <AddRow
              label={copy.academic.subjects.add}
              onPress={() => setSheet({ kind: "subject", row: null })}
              testID="subject-mapping-add"
            />
          ) : null}
          {subjectRows.map((row, index) => {
            const mapped = classIdsBySubject.get(row.id)?.size ?? 0;
            const showCoverage = Boolean(coverage.data) && classRows.length > 0;
            return (
              <SubjectListRow
                key={row.id}
                name={row.name}
                detail={[
                  row.shortName ?? row.code,
                  showCoverage ? text.coverage(mapped, classRows.length) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                first={index === 0 && !canCreate}
                onPress={
                  canEditSubject ? () => setSheet({ kind: "subject", row }) : undefined
                }
                onMap={
                  canCreate && hasYear && showCoverage && mapped < classRows.length
                    ? () => setSheet({ kind: "classes", row })
                    : undefined
                }
                mapHint={text.mapHint(row.name)}
              />
            );
          })}
        </Card>
      )}
    </>
  );

  const oneClass = !hasYear ? (
    <Notice
      tone="neutral"
      icon="sessions"
      message={text.noSessionNote}
      testID="subject-mapping-no-session"
    >
      {has("academic_year:read") ? (
        <CapsuleButton
          title={copy.academic.classSection.openSessions}
          size="compact"
          variant="secondary"
          onPress={() => router.push("/sessions")}
          testID="subject-mapping-open-sessions"
        />
      ) : null}
    </Notice>
  ) : mappings.isPending ? (
    <View style={styles.loading} testID="subject-mapping-class-loading">
      <Skeleton height={48} />
      <Skeleton height={62} />
      <Skeleton height={62} />
    </View>
  ) : mappings.isError ? (
    <ErrorCard
      cause={mappings.error}
      onRetry={() => void mappings.refetch()}
      testID="subject-mapping-class-error"
    />
  ) : (
    <>
      <ThemedText variant="meta">
        {mappingRows.length === 0
          ? text.noneMapped(selectedClass?.name ?? "")
          : text.mappedSummary(
              mappingRows.length,
              subjectRows.length,
              selectedClass?.name ?? "",
            )}
      </ThemedText>
      {canCreate || mappingRows.length > 0 ? (
        <Card padless testID="subject-mapping-class">
          {canCreate ? (
            <AddRow
              label={text.mapSubjects}
              onPress={() => setSheet({ kind: "bulk" })}
              testID="subject-mapping-map"
            />
          ) : null}
          {mappingRows.map((row, index) => {
            const type = row.subjectTypeId ? typeName(row.subjectTypeId) : null;
            const name = subjectName(row.subjectId) ?? "";
            const kind = row.isElective ? text.elective : text.core;
            const body = (
              <>
                <View style={styles.rowText}>
                  <ThemedText variant="name" numberOfLines={2}>
                    {name}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {kind}
                  </ThemedText>
                </View>
                {!row.subjectTypeId ? (
                  <StatusPill label={copy.bulkMapping.typeMissing} tone="caution" />
                ) : type ? (
                  <StatusPill label={type} tone="neutral" />
                ) : null}
              </>
            );
            const label = [name, kind, row.subjectTypeId ? type : copy.bulkMapping.typeMissing]
              .filter(Boolean)
              .join(", ");
            return canEditMapping ? (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint={copy.academic.mappings.openHint}
                onPress={() => setSheet({ kind: "mapping", id: row.id })}
                style={({ pressed }) => [
                  styles.row,
                  index === 0 && !canCreate ? null : styles.divider,
                  pressed ? styles.rowPressed : null,
                ]}
                testID={`mapping-row-${row.id}`}
              >
                {body}
                <AppIcon name="chevronRight" size={18} color={colors.chevron} />
              </Pressable>
            ) : (
              <View
                key={row.id}
                accessible
                accessibilityLabel={label}
                style={[styles.row, index === 0 && !canCreate ? null : styles.divider]}
              >
                {body}
              </View>
            );
          })}
        </Card>
      ) : null}
    </>
  );

  return (
    <AcademicListFrame
      title={text.title}
      meta={meta}
      canRead={canRead}
      deniedTitle={copy.academic.denied.subjectsReadTitle}
      deniedPermission="subject:read"
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={subjects.isPending}
      error={subjects.error ?? null}
      onRetry={() => void subjects.refetch()}
      onRefresh={() => {
        void subjects.refetch();
        void classes.refetch();
        if (hasYear) void coverage.refetch();
        if (hasYear && selectedClassId) void mappings.refetch();
      }}
      refreshing={subjects.isRefetching}
      isEmpty={false}
      emptyTitle={copy.academic.subjects.emptyTitle}
      emptyBody={copy.academic.subjects.emptyBody}
      emptyIcon="edit"
      stickyHeader={tabs}
      action={
        canReadTypes
          ? {
              label: copy.exams.grading.types.title,
              icon: "manage",
              onPress: () => router.push("/exams/setup/subject-types"),
              accessibilityHint: text.typesHint,
              testID: "subject-mapping-types",
            }
          : undefined
      }
      titleTestID="subject-mapping-title"
    >
      {saved ? (
        <Notice tone="positive" message={saved} testID="subject-mapping-saved" />
      ) : null}

      {selectedClassId ? oneClass : allSubjects}

      {sheet?.kind === "subject" ? (
        <SubjectSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          row={sheet.row}
          canWrite={sheet.row ? has("subject:update") : canCreate}
          canDelete={Boolean(sheet.row) && has("subject:delete")}
          onClose={() => setSheet(null)}
          onSaved={savedAndClosed}
        />
      ) : null}
      {sheet?.kind === "classes" ? (
        <MapToClassesSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          academicYearId={academicYear?.id ?? null}
          subject={sheet.row}
          classes={classRows}
          mappedClassIds={classIdsBySubject.get(sheet.row.id) ?? new Set<string>()}
          subjectTypes={typeRows}
          canReadTypes={canReadTypes}
          onClose={() => setSheet(null)}
          onSaved={savedAndClosed}
        />
      ) : null}
      {sheet?.kind === "bulk" ? (
        <BulkMapSheet
          onClose={() => setSheet(null)}
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          academicYearId={academicYear?.id ?? null}
          classId={selectedClassId}
          candidates={subjectRows
            .filter((row) => !mappedHere.has(row.id))
            .map((row) => ({ id: row.id, name: row.name }))}
          subjectTypes={typeRows}
          showTypes={typeRows.length > 0}
          canReadTypes={canReadTypes}
          onSaved={savedAndClosed}
        />
      ) : null}
      {sheet?.kind === "mapping" ? (
        <EditMappingSheet
          row={editing}
          onClose={() => setSheet(null)}
          organizationId={organizationId ?? ""}
          className={selectedClass?.name ?? null}
          subjectName={editing ? subjectName(editing.subjectId) : null}
          subjectTypes={typeRows}
          showTypes={typeRows.length > 0}
          canUpdate={has("subject:update")}
          canEnd={has("subject:delete")}
          onSaved={savedAndClosed}
        />
      ) : null}
    </AcademicListFrame>
  );
}

function AddRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.addRow, pressed ? styles.rowPressed : null]}
      testID={testID}
    >
      <AppIcon name="add" size={20} color={colors.accentDeep} />
      <ThemedText variant="bodyStrong" color={colors.accentDeep}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SubjectListRow({
  name,
  detail,
  first,
  onPress,
  onMap,
  mapHint,
}: {
  name: string;
  detail: string;
  first: boolean;
  onPress?: () => void;
  onMap?: () => void;
  mapHint: string;
}) {
  const body = (
    <>
      <IconTile name="subject" size={40} />
      <View style={styles.rowText}>
        <ThemedText variant="name" numberOfLines={2}>
          {name}
        </ThemedText>
        {detail ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {onMap ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mapHint}
          hitSlop={6}
          onPress={onMap}
          style={({ pressed }) => [styles.map, pressed ? styles.mapPressed : null]}
        >
          <ThemedText variant="caption" color={colors.accentDeep}>
            {copy.academic.subjectMapping.map}
          </ThemedText>
        </Pressable>
      ) : null}
    </>
  );
  const label = [name, detail].filter(Boolean).join(", ");
  if (!onPress) {
    return (
      <View
        accessible={!onMap}
        accessibilityLabel={label}
        style={[styles.row, first ? null : styles.divider]}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={copy.academic.subjects.openHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {body}
      <AppIcon name="chevronRight" size={18} color={colors.chevron} />
    </Pressable>
  );
}

/** All subjects, then a chip per class. Keeps the selected chip in view. */
function ClassTabs({
  classes,
  selectedId,
  missingIds,
  onSelect,
}: {
  classes: readonly { id: string; name: string }[];
  selectedId: string | null;
  missingIds: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());

  useEffect(() => {
    const x = selectedId ? offsets.current.get(selectedId) : 0;
    if (x !== undefined) {
      scroll.current?.scrollTo({ x: Math.max(0, x - gutter), animated: true });
    }
  }, [selectedId]);

  const tab = (
    key: string,
    id: string | null,
    label: string,
    icon: AppIconName | null,
    missing: boolean,
  ) => {
    const selected = selectedId === id;
    return (
      <Pressable
        key={key}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={
          missing ? copy.academic.subjectMapping.noSubjectsLabel(label) : label
        }
        onLayout={(event) => {
          offsets.current.set(key, event.nativeEvent.layout.x);
        }}
        onPress={() => onSelect(id)}
        style={[styles.tab, selected ? styles.tabOn : null]}
        testID={`subject-mapping-tab-${key}`}
      >
        {icon ? (
          <AppIcon
            name={icon}
            size={16}
            color={selected ? colors.accentDeep : colors.muted}
          />
        ) : null}
        <ThemedText
          variant="bodyStrong"
          color={selected ? colors.accentDeep : colors.muted}
          numberOfLines={1}
        >
          {label}
        </ThemedText>
        {missing ? <View style={styles.dot} /> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={styles.tabs}
    >
      {tab("all", null, copy.academic.subjectMapping.allSubjects, "subject", false)}
      {classes.map((row) => tab(row.id, row.id, row.name, null, missingIds.has(row.id)))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: {
    gap: spacing.sm,
    paddingHorizontal: gutter,
    paddingVertical: spacing.xs,
  },
  tab: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  tabOn: {
    backgroundColor: colors.accentTint,
  },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.tone.caution.fg,
  },
  loading: {
    gap: spacing.sm,
  },
  addRow: {
    minHeight: touch.comfortable,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  row: {
    minHeight: touch.rosterRow,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  map: {
    minHeight: spacing.xxxl,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  mapPressed: {
    backgroundColor: colors.accentStrong,
  },
});
