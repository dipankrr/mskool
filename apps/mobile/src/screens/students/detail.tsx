import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate, formatShortWeekday, todayIso } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { profileCopy } from "../../lib/profile-copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, spacing } from "../../theme/tokens";
import { PrintSheet } from "../fees/print-sheet";
import { StudentSummarySheet } from "../staff-attendance/student-summary-sheet";
import { statusTone } from "../staff-attendance/status-meta";
import { attendedDays, formatPercent } from "../staff-attendance/summary";
import { IdCardPrintSheet } from "./id-card-print-sheet";
import {
  addressBlock,
  ageInYears,
  hasLeft,
  leavingOptions,
  maskAadhaar,
  type EnrollmentStatus,
  type LeavingStatus,
} from "./people-logic";
import { ActionRow, type ProfileAction } from "./profile/action-row";
import {
  LeftBanner,
  MiniFace,
  PlacementCapsule,
  ProfileBand,
  ProfileTopBar,
  TodayChip,
  type CapsulePart,
} from "./profile/band";
import { AllDetailsSheet, DetailsCard, type Fact, type FactGroup } from "./profile/details";
import { EnrollmentSheet, LeavingSheet } from "./profile/enrollment-sheets";
import { FamilyCard, guardianName, type Guardian } from "./profile/family";
import { SubjectBars, Strip, Tile, TileState } from "./profile/glance";
import { FlagCard, type FlagLine } from "./profile/heads-up";
import { HomeworkSheet, wordTone } from "./profile/homework-sheet";
import { MoreSheet, type MoreItem } from "./profile/more-sheet";
import {
  absenceRun,
  clockOf,
  feeFlag,
  finishSteps,
  lastMarkedDays,
  monthsPaid,
  percentDelta,
  resultFlag,
  tileSpans,
  todayMark,
  visibleActions,
} from "./profile/profile-logic";
import { useProfileData, type Block } from "./profile/use-profile-data";
import { PhotoSourceSheet, StudentPhotoView, useStudentPhoto } from "./student-photo";

const words = profileCopy;

/** Opens the dialler; a phone without one gets told rather than ignored. */
function callNumber(phone: string) {
  Linking.openURL(`tel:${phone}`).catch(() => Alert.alert(copy.students.profile.callFailed));
}

/** Opens a text message to the number, the same way. */
function textNumber(phone: string) {
  Linking.openURL(`sms:${phone}`).catch(() => Alert.alert(words.actions.messageFailed));
}

type SheetName = "more" | "details" | "homework" | "attendance" | "statement" | "idCard" | "leaving";
type TileSpec = {
  key: string;
  label: string;
  block: Block<unknown>;
  render: (span: "half" | "full") => ReactNode;
};

/**
 * A student's profile for any staff member (2026-11-09 revamp,
 * `docs/design/mobile/prototype/student-profile.html`).
 *
 * The band answers who this is, where they sit and whether they're in school today;
 * the action row holds the jobs people open a profile for; To finish and Heads up say
 * what needs doing, worst first; the tiles say how the child is doing. Every block
 * follows the viewer's permissions and scope, never a role name: a block they can't
 * read isn't drawn at all, and one that fails for any other reason offers Retry in
 * place, so the rest of the page keeps working.
 */
export function StudentDetailScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has, hasAny } = usePermissions();
  const insets = useSafeAreaInsets();

  const can = {
    read: has("student:read"),
    update: has("student:update"),
    enrol: has("enrollment:create"),
    enrolUpdate: has("enrollment:update"),
    enrolRead: has("enrollment:read"),
    portal: has("portal_access:activate"),
    statement: has("fee_report:read"),
    collect: has("fee_payment:create"),
    startFees: has("student_fee_assignment:create"),
    idCard: has("id_card:print"),
    attendance: has("attendance:read"),
    fees: hasAny("fee_report:read", "student_fee_assignment:read"),
  };

  const studentQuery = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    { enabled: ready && Boolean(organizationId) && can.read },
  );
  const guardiansQuery = trpc.guardian.list.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    {
      enabled: ready && Boolean(organizationId) && can.read && Boolean(studentId),
      placeholderData: (previous) => previous,
    },
  );
  const enrollmentsEnabled =
    ready && Boolean(organizationId) && can.enrolRead && Boolean(academicYear?.id);
  const enrollmentsQuery = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      includeLeft: true,
    },
    { enabled: enrollmentsEnabled },
  );
  // Enrollments only carry ids, and a name is what anyone is looking for.
  const classesQuery = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: enrollmentsEnabled && has("class:read") },
  );
  const sectionsQuery = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: enrollmentsEnabled && has("section:read") },
  );

  const enrollment = (enrollmentsQuery.data ?? []).find(
    (row) => row.student.id === studentId,
  )?.enrollment;
  const status = enrollment?.enrollmentStatus as EnrollmentStatus | undefined;
  const className = classesQuery.data?.find((row) => row.id === enrollment?.classId)?.name;
  const sectionName = sectionsQuery.data?.find((row) => row.id === enrollment?.sectionId)?.name;

  const student = studentQuery.data;
  const data = useProfileData({
    studentId,
    sectionId: enrollment?.sectionId ?? null,
    enabled: can.read && Boolean(student),
  });

  const utils = trpc.useUtils();
  const rejoin = trpc.student.rejoin.useMutation();
  const photo = useStudentPhoto(organizationId, studentId, ready && can.read);

  const [collapsed, setCollapsed] = useState(false);
  const [bandHeight, setBandHeight] = useState(0);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [photoError, setPhotoError] = useState<unknown>(null);
  const [leavingTo, setLeavingTo] = useState<LeavingStatus | null>(null);
  const [rejoinError, setRejoinError] = useState<unknown>(null);
  const [enrollSheet, setEnrollSheet] = useState<null | "create" | "assign" | "roll">(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Light icons over the band while this screen is in front; dark everywhere else.
  const hasBand = Boolean(student);
  useFocusEffect(
    useCallback(() => {
      if (!hasBand) return undefined;
      setStatusBarStyle("light");
      return () => setStatusBarStyle("dark");
    }, [hasBand]),
  );

  const closeSheet = (name: SheetName) => () =>
    setSheet((current) => (current === name ? null : current));

  const frame = (children: ReactNode) => (
    <ScreenFrame title={copy.students.title} backAccessibilityLabel={copy.common.back}>
      {children}
    </ScreenFrame>
  );

  if (!can.read) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.studentsReadTitle}
        message={copy.denied.studentsReadBody}
        testID="student-detail-denied"
      />,
    );
  }
  if (!ready || (organizationId && studentQuery.isPending)) {
    return frame(
      <View style={styles.skeleton} accessibilityLabel={copy.students.loading}>
        <Skeleton height={88} width={88} style={styles.round} />
        <Skeleton height={30} width="60%" style={styles.centered} />
        <Skeleton height={36} width="55%" style={styles.centered} />
        <Skeleton height={80} />
        <View style={styles.skeletonRow}>
          <Skeleton height={124} style={styles.flex} />
          <Skeleton height={124} style={styles.flex} />
        </View>
      </View>,
    );
  }
  if (studentQuery.isError) {
    return frame(
      <ErrorCard
        cause={studentQuery.error}
        onRetry={() => void studentQuery.refetch()}
        testID="student-detail-error"
      />,
    );
  }
  if (!student) {
    return frame(
      <ErrorCard
        cause={new Error(copy.errors.notFound)}
        onRetry={() => void studentQuery.refetch()}
        testID="student-detail-missing"
      />,
    );
  }

  // ── What's true about this child ──────────────────────────────────────
  const profile = copy.students.profile;
  const today = todayIso();
  const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const guardians: Guardian[] = guardiansQuery.data ?? [];
  const guardiansLoaded = !guardiansQuery.isPending;
  const firstContact = guardians.find((g) => g.isPrimary) ?? guardians[0];
  const age = ageInYears(student.dateOfBirth, today);
  const left = student.status === "inactive" || (status ? hasLeft(status) : false);
  const graduated = status === "graduated";
  const enrolmentKnown = can.enrolRead && enrollmentsQuery.isSuccess;
  const canPlace = can.enrolUpdate && !left;
  const leaving = status && can.enrolUpdate ? leavingOptions(status) : [];
  const fees = data.fees.state === "ready" ? data.fees.data : null;
  const hasFeePlan = fees ? Boolean(fees.feeRecord) : null;
  const classLine = className && sectionName ? `${className} ${sectionName}` : (className ?? null);
  const placeLine = [
    classLine,
    enrollment?.rollNumber ? `${words.capsule.roll} ${enrollment.rollNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const attendance = data.attendance.state === "ready" ? data.attendance.data : null;
  const result = data.results.state === "ready" ? data.results.data : null;
  const homework = data.homework.state === "ready" ? data.homework.data : null;

  const openFees = () =>
    router.push({ pathname: "/fees/student/[studentId]", params: { studentId: student.id } });
  const openCollect = () =>
    router.push({
      pathname: "/fees/collect/[studentId]",
      params: { studentId: student.id, studentName: name, className: placeLine },
    });
  const openGuardian = (guardianId?: string) =>
    router.push({
      pathname: "/guardian-form",
      params: guardianId ? { studentId: student.id, guardianId } : { studentId: student.id },
    });
  const openEdit = () => router.push({ pathname: "/student-form", params: { id: student.id } });
  const openPortal = () =>
    router.push({ pathname: "/portal-access", params: { studentId: student.id } });
  const openAttendance =
    attendance && enrollment?.sectionId ? () => setSheet("attendance") : undefined;
  const openResult =
    result?.examId && result.classId
      ? () =>
          router.push({
            pathname: "/exams/[examId]/class/[classId]/student/[studentId]",
            params: { examId: result.examId!, classId: result.classId!, studentId: student.id },
          })
      : undefined;

  async function rejoinStudent() {
    if (!organizationId || !student) return;
    setRejoinError(null);
    setSavedMsg(null);
    try {
      await rejoin.mutateAsync({ organizationId, id: student.id });
      await Promise.all([
        utils.enrollment.list.invalidate(),
        utils.student.byId.invalidate({ id: student.id }),
      ]);
    } catch (error) {
      setRejoinError(error);
    }
  }

  // ── Today ─────────────────────────────────────────────────────────────
  const mark = !left && attendance ? todayMark(attendance.rows, student.id, today) : null;
  const markTime = mark ? clockOf(mark.markedAt) : null;
  let todayChip: ReactNode = null;
  if (!left && enrolmentKnown && enrollment && !enrollment.sectionId && can.attendance) {
    todayChip = <TodayChip label={words.today.notPlaced} tone="neutral" />;
  } else if (!left && attendance) {
    todayChip = mark ? (
      <TodayChip
        label={words.today[mark.status]}
        detail={markTime ? words.today.marked(markTime) : null}
        tone={statusTone[mark.status]}
        onPress={openAttendance}
      />
    ) : (
      <TodayChip label={words.today.none} tone="neutral" onPress={openAttendance} />
    );
  }

  // ── Placement capsule ─────────────────────────────────────────────────
  let capsuleParts: CapsulePart[] | null = null;
  if (enrolmentKnown && enrollment) {
    capsuleParts = [
      {
        key: "class",
        // "Class 6" already says class; the label only adds "Was in" or a bare number's word.
        label: left
          ? words.capsule.wasIn
          : className && /^class/i.test(className)
            ? ""
            : words.capsule.class,
        value: className ?? null,
      },
      {
        key: "section",
        label: words.capsule.section,
        value: enrollment.sectionId ? (sectionName ?? null) : null,
        fill:
          canPlace && !enrollment.sectionId
            ? {
                label: words.capsule.addSection,
                hint: words.capsule.addSectionHint,
                onPress: () => setEnrollSheet("assign"),
              }
            : undefined,
      },
      {
        key: "roll",
        label: words.capsule.roll,
        value: enrollment.rollNumber,
        fill:
          canPlace && enrollment.sectionId
            ? {
                label: words.capsule.addRoll,
                hint: words.capsule.addRollHint,
                onPress: () => setEnrollSheet("roll"),
              }
            : undefined,
      },
    ];
  } else if (enrolmentKnown && !enrollment && !left && can.enrol) {
    capsuleParts = [
      {
        key: "class",
        label: words.capsule.class,
        value: null,
        fill: {
          label: words.capsule.enrol,
          hint: words.capsule.enrolHint,
          onPress: () => setEnrollSheet("create"),
        },
      },
    ];
  }

  // ── Actions: what this viewer may do, most useful first ───────────────
  const feeLine = fees ? feeFlag(fees.totals) : null;
  const collectable = can.collect && (data.fees.state === "hidden" || hasFeePlan === true);
  const canRejoin = can.update && student.status === "inactive" && !graduated;
  const actionMap: Partial<Record<string, ProfileAction>> = {
    addParent: {
      key: "addParent",
      label: words.actions.addParent,
      icon: "personAdd",
      hint: words.actions.addParentHint,
      onPress: () => openGuardian(),
    },
    place: {
      key: "place",
      label: words.actions.place,
      icon: "seat",
      hint: words.actions.placeHint,
      onPress: () => setEnrollSheet("assign"),
    },
    collect: {
      key: "collect",
      label: words.actions.collect,
      icon: "collect",
      hint: words.actions.collectHint,
      onPress: openCollect,
    },
    idCard: {
      key: "idCard",
      label: words.actions.idCard,
      icon: "profileCard",
      hint: words.actions.idCardHint,
      onPress: () => setSheet("idCard"),
    },
    rejoin: {
      key: "rejoin",
      label: words.actions.rejoin,
      icon: "history",
      hint: words.actions.rejoinHint,
      onPress: () =>
        Alert.alert(profile.rejoinConfirmTitle(student.firstName), profile.rejoinConfirmBody, [
          { text: copy.common.cancel, style: "cancel" },
          { text: profile.rejoinConfirm, onPress: () => void rejoinStudent() },
        ]),
    },
  };
  if (firstContact) {
    actionMap.call = {
      key: "call",
      label: words.actions.call(copy.students.relations[firstContact.relation]),
      icon: "call",
      hint: words.actions.callHint,
      onPress: () => callNumber(firstContact.phone),
    };
    actionMap.message = {
      key: "message",
      label: words.actions.message,
      icon: "message",
      hint: words.actions.messageHint(guardianName(firstContact)),
      onPress: () => textNumber(firstContact.phone),
    };
  }
  const actionKeys = left
    ? visibleActions([
        firstContact ? "call" : null,
        collectable && feeLine ? "collect" : null,
        canRejoin ? "rejoin" : null,
        firstContact ? "message" : null,
      ])
    : visibleActions([
        firstContact ? "call" : guardiansLoaded && can.update ? "addParent" : null,
        firstContact ? "message" : null,
        enrolmentKnown && enrollment && !enrollment.sectionId && canPlace ? "place" : null,
        collectable ? "collect" : null,
        can.idCard && schoolId && enrollment ? "idCard" : null,
      ]);
  const mainKey = left && collectable && feeLine ? "collect" : actionKeys[0];
  const actions = actionKeys.flatMap((key) => {
    const action = actionMap[key];
    return action ? [{ ...action, main: key === mainKey }] : [];
  });

  // ── To finish (a new admission) ───────────────────────────────────────
  const finishLines: FlagLine[] = [];
  let finishFootnote: string | null = null;
  if (!left && enrolmentKnown && guardiansLoaded) {
    const steps = finishSteps({
      enrolled: Boolean(enrollment),
      hasSection: Boolean(enrollment?.sectionId),
      hasParent: guardians.length > 0,
      hasFeePlan: enrollment ? hasFeePlan : null,
      can: { enrol: can.enrol, place: canPlace, parent: can.update, fees: can.startFees },
    });
    const stepLine: Record<string, FlagLine> = {
      enrol: {
        key: "enrol",
        icon: "school",
        tone: "positive",
        title: words.toFinish.enrol(student.firstName),
        detail: words.toFinish.enrolDetail,
        actionLabel: words.toFinish.enrolAction,
        onPress: () => setEnrollSheet("create"),
      },
      place: {
        key: "place",
        icon: "seat",
        tone: "positive",
        title: words.toFinish.place(student.firstName),
        detail: words.toFinish.placeDetail,
        actionLabel: words.toFinish.placeAction,
        onPress: () => setEnrollSheet("assign"),
      },
      parent: {
        key: "parent",
        icon: "personAdd",
        tone: "positive",
        title: words.toFinish.parent,
        detail: words.toFinish.parentDetail,
        actionLabel: words.toFinish.parentAction,
        onPress: () => openGuardian(),
      },
      fees: {
        key: "fees",
        icon: "fees",
        tone: "positive",
        title: words.toFinish.fees(student.firstName),
        detail: words.toFinish.feesDetail,
        actionLabel: words.toFinish.feesAction,
        onPress: openFees,
      },
    };
    finishLines.push(...steps.mine.map((step) => stepLine[step]!));
    finishFootnote = steps.others > 0 ? words.toFinish.others(steps.others) : null;
  }

  // ── Heads up: health first, then problems, red before amber ───────────
  const headsUp: FlagLine[] = [];
  if (!left && student.medicalConditions) {
    const emergencyPhone = student.emergencyContactPhone ?? firstContact?.phone ?? null;
    const emergencyName =
      student.emergencyContactName ?? (firstContact ? guardianName(firstContact) : null);
    headsUp.push({
      key: "health",
      icon: "health",
      tone: "caution",
      title: student.medicalConditions,
      detail: emergencyName ? `${copy.students.fields.emergencyName}: ${emergencyName}` : null,
      call: emergencyPhone
        ? {
            label: copy.students.profile.callGuardian(emergencyName ?? emergencyPhone),
            onPress: () => callNumber(emergencyPhone),
          }
        : undefined,
    });
  }
  if (fees && feeLine) {
    const overdueMonths = fees.months.filter((m) => m.state === "overdue").map((m) => m.label);
    headsUp.push({
      key: "fees",
      icon: "fees",
      tone: left ? "critical" : feeLine.tone,
      title: left
        ? words.left.stillDue(formatMoney(feeLine.amount))
        : feeLine.tone === "critical"
          ? words.headsUp.feesOverdue(formatMoney(feeLine.amount))
          : words.headsUp.feesDue(formatMoney(feeLine.amount)),
      detail:
        feeLine.tone === "critical"
          ? words.headsUp.feesOverdueDetail(overdueMonths)
          : words.headsUp.feesDueDetail,
      actionLabel: collectable ? words.headsUp.collect : undefined,
      onPress: collectable ? openCollect : openFees,
      hint: words.headsUp.openHint,
    });
  }
  const run = !left && attendance ? absenceRun(attendance.rows, student.id) : null;
  if (run) {
    headsUp.push({
      key: "absent",
      icon: "calendar",
      tone: "caution",
      title: words.headsUp.absent(run.count, run.of),
      detail: words.headsUp.absentDetail(run.dates.map((d) => formatShortWeekday(d))),
      onPress: openAttendance,
      hint: words.headsUp.openHint,
    });
  }
  const missed = !left && homework ? homework.items.filter((item) => item.word === "missed") : [];
  if (missed.length > 0) {
    headsUp.push({
      key: "homework",
      icon: "homework",
      tone: "caution",
      title: words.headsUp.homeworkMissed(missed.length),
      detail: missed
        .slice(0, 2)
        .map((item) => item.title)
        .join(", "),
      onPress: () => setSheet("homework"),
      hint: words.headsUp.openHint,
    });
  }
  const resultLine = !left && result ? resultFlag(result) : null;
  if (result && resultLine) {
    headsUp.push({
      key: "results",
      icon: "exams",
      tone: "caution",
      title:
        resultLine.kind === "failed"
          ? words.headsUp.failed([...resultLine.subjects])
          : words.headsUp.dropped(resultLine.points),
      detail:
        resultLine.kind === "failed"
          ? words.headsUp.failedDetail(result.termName, [...resultLine.subjects])
          : words.headsUp.droppedDetail(result.termName),
      onPress: openResult,
      hint: words.headsUp.openHint,
    });
  }
  const rank = (line: FlagLine) => (line.key === "health" ? 0 : line.tone === "critical" ? 1 : 2);
  headsUp.sort((a, b) => rank(a) - rank(b));

  // ── At a glance ───────────────────────────────────────────────────────
  const tiles: TileSpec[] = [];
  if (data.attendance.state !== "hidden") {
    tiles.push({
      key: "attendance",
      label: words.glance.attendance,
      block: data.attendance,
      render: (span) => {
        if (!attendance) return null;
        const days = lastMarkedDays(attendance.rows, student.id, 10);
        const row = attendance.summary;
        return (
          <Tile
            label={words.glance.attendance}
            value={row ? formatPercent(row.attendancePercentage) : "—"}
            sub={
              left && enrollment?.leftOn
                ? words.left.final(formatReadableDate(enrollment.leftOn))
                : row && row.workingDays > 0
                  ? words.glance.attendanceSub(attendedDays(row), row.workingDays)
                  : words.glance.attendanceNone
            }
            strip={
              days.length > 0 ? (
                <Strip
                  shape="square"
                  cells={days.map((d) => ({
                    key: d.date,
                    color: colors.tone[statusTone[d.status]].fg,
                    now: d.date === today,
                  }))}
                />
              ) : undefined
            }
            scale={
              days.length > 0 ? [words.glance.lastDays(days.length), words.glance.today] : undefined
            }
            onPress={openAttendance}
            span={span}
            testID="student-tile-attendance"
          />
        );
      },
    });
  }
  if (data.fees.state !== "hidden") {
    tiles.push({
      key: "fees",
      label: words.glance.fees,
      block: data.fees,
      render: (span) => {
        if (!fees) return null;
        if (!fees.feeRecord) {
          return (
            <Tile
              label={words.glance.fees}
              value={words.glance.feesNoPlan}
              valueColor={colors.muted}
              sub={words.glance.feesNoPlanSub}
              onPress={openFees}
              span={span}
              testID="student-tile-fees"
            />
          );
        }
        const count = monthsPaid(fees.months);
        const thisMonth = today.slice(0, 7);
        return (
          <Tile
            label={feeLine ? words.glance.feesDue : words.glance.fees}
            value={feeLine ? formatMoney(feeLine.amount) : words.glance.feesClear}
            valueColor={feeLine ? colors.tone[feeLine.tone].fg : colors.accentDeep}
            sub={
              feeLine ? words.glance.feesDueSub(count.paid, count.total) : words.glance.feesClearSub
            }
            strip={
              fees.months.length > 0 ? (
                <Strip
                  shape="bar"
                  cells={fees.months.map((m) => ({
                    key: m.month,
                    color:
                      m.state === "paid"
                        ? colors.accent
                        : m.state === "overdue"
                          ? colors.tone.critical.fg
                          : m.state === "due"
                            ? colors.tone.caution.fg
                            : m.state === "upcoming"
                              ? colors.field
                              : colors.canvas,
                    outlined: m.state === "none",
                    now: m.month === thisMonth,
                  }))}
                />
              ) : undefined
            }
            scale={
              fees.months.length > 0
                ? [fees.months[0]!.label, fees.months[fees.months.length - 1]!.label]
                : undefined
            }
            onPress={openFees}
            span={span}
            testID="student-tile-fees"
          />
        );
      },
    });
  }
  if (data.results.state !== "hidden") {
    tiles.push({
      key: "results",
      label: words.glance.results,
      block: data.results,
      render: (span) => {
        if (!result) return null;
        const bars = [result.best, result.weakest]
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s, index) => ({
            key: s.subjectId,
            name: s.name,
            percent: Number(s.percent),
            tone: !s.isPassed ? ("critical" as const) : index === 0 ? ("accent" as const) : ("caution" as const),
          }));
        return (
          <Tile
            label={words.glance.results}
            value={result.percentage ? formatPercent(result.percentage) : (result.grade ?? "—")}
            valueSuffix={result.percentage ? result.grade : null}
            valueColor={result.isPassed ? undefined : colors.tone.critical.fg}
            sub={words.glance.resultsSub(
              result.termName,
              percentDelta(result.percentage, result.previousPercentage),
            )}
            strip={bars.length > 0 ? <SubjectBars rows={bars} /> : undefined}
            onPress={openResult}
            span={span}
            testID="student-tile-results"
          />
        );
      },
    });
  }
  if (data.homework.state !== "hidden") {
    tiles.push({
      key: "homework",
      label: words.glance.homework,
      block: data.homework,
      render: (span) => {
        if (!homework) return null;
        const oldestFirst = [...homework.items].reverse();
        return (
          <Tile
            label={words.glance.homework}
            value={homework.counted > 0 ? String(homework.handedIn) : "—"}
            valueSuffix={homework.counted > 0 ? `/${homework.counted}` : null}
            sub={homework.items.length > 0 ? words.glance.homeworkSub : words.glance.homeworkNone}
            strip={
              oldestFirst.length > 0 ? (
                <Strip
                  shape="bar"
                  cells={oldestFirst.map((item) => {
                    const tone = wordTone[item.word];
                    return {
                      key: item.studentAssignmentId,
                      color: tone ? colors.tone[tone].fg : colors.field,
                    };
                  })}
                />
              ) : undefined
            }
            scale={oldestFirst.length > 1 ? [words.glance.oldest, words.glance.newest] : undefined}
            onPress={homework.items.length > 0 ? () => setSheet("homework") : undefined}
            span={span}
            testID="student-tile-homework"
          />
        );
      },
    });
  }
  const spans = tileSpans(tiles.length);

  // ── Details ───────────────────────────────────────────────────────────
  const address = addressBlock(student);
  const bloodGroup = student.bloodGroup ? copy.studentForm.bloodGroups[student.bloodGroup] : null;
  const fact = (key: string, label: string, value: string | null | undefined): Fact[] =>
    value ? [{ key, label, value }] : [];
  const shortFacts = [
    ...fact(
      "admitted",
      words.details.admitted,
      student.admissionDate ? formatReadableDate(student.admissionDate) : null,
    ),
    ...fact("born", words.details.born, formatReadableDate(student.dateOfBirth)),
    ...fact("phone", words.details.phone, student.phone),
    ...fact("email", words.details.email, student.email),
    ...fact("motherTongue", words.details.motherTongue, student.motherTongue),
    ...fact("bloodGroup", words.details.bloodGroup, bloodGroup),
  ].slice(0, 4);
  const background = [
    ...fact("nationality", copy.students.fields.nationality, student.nationality),
    ...fact("religion", copy.students.fields.religion, student.religion),
    ...fact("category", copy.students.fields.category, student.category),
    ...fact("motherTongue", copy.students.fields.motherTongue, student.motherTongue),
    ...fact(
      "aadhaar",
      copy.students.fields.aadhaar,
      student.aadhaarNumber ? maskAadhaar(student.aadhaarNumber) : null,
    ),
  ];
  const groups: FactGroup[] = [
    {
      key: "record",
      title: profile.record,
      facts: [
        ...fact("admissionNumber", copy.students.fields.admissionNumber, student.admissionNumber),
        ...fact(
          "admissionDate",
          copy.students.fields.admissionDate,
          student.admissionDate ? formatReadableDate(student.admissionDate) : null,
        ),
        ...fact(
          "status",
          copy.people.enrollment.statusLabel,
          status ? copy.people.enrollment.statuses[status] : null,
        ),
        ...fact(
          "leftOn",
          profile.leftOn,
          enrollment?.leftOn ? formatReadableDate(enrollment.leftOn) : null,
        ),
        ...fact("reason", profile.reason, enrollment?.leavingReason),
      ],
    },
    {
      key: "contact",
      title: profile.contact,
      facts: [
        ...fact("phone", copy.students.fields.phone, student.phone),
        ...fact("email", copy.students.fields.email, student.email),
        ...fact("address", profile.contact, address),
      ],
    },
    {
      key: "health",
      title: copy.students.sections.medical,
      facts: [
        ...fact("bloodGroup", words.details.bloodGroup, bloodGroup),
        ...fact("medical", copy.students.fields.medical, student.medicalConditions),
        ...fact("emergencyName", copy.students.fields.emergencyName, student.emergencyContactName),
        ...fact(
          "emergencyPhone",
          copy.students.fields.emergencyPhone,
          student.emergencyContactPhone,
        ),
      ],
    },
    { key: "background", title: copy.students.sections.background, facts: background },
  ];
  const emptyGroups = [
    !student.phone && !student.email ? profile.groups.contact : null,
    !address ? profile.groups.address : null,
    !student.medicalConditions && !student.emergencyContactName && !student.bloodGroup
      ? profile.groups.health
      : null,
    background.length === 0 ? profile.groups.background : null,
  ].filter(Boolean);

  // ── More: occasional jobs, each behind its own permission ─────────────
  const more: MoreItem[] = [];
  if (can.update) {
    more.push({
      key: "photo",
      icon: "camera",
      title: photo.hasPhoto ? words.more.changePhoto : words.more.addPhoto,
      onPress: () => {
        setSheet(null);
        setPhotoError(null);
        setPhotoSheetOpen(true);
      },
    });
  }
  if (canPlace && enrollment?.sectionId) {
    more.push({
      key: "roll",
      icon: "edit",
      title: words.more.roll,
      detail: classLine ? words.more.rollDetail(classLine) : null,
      onPress: () => {
        setSheet(null);
        setEnrollSheet("roll");
      },
    });
  }
  if (can.portal) {
    more.push({
      key: "portal",
      icon: "key",
      title: words.more.portal,
      detail: words.more.portalDetail,
      onPress: () => {
        setSheet(null);
        openPortal();
      },
    });
  }
  if (can.statement && hasFeePlan) {
    more.push({
      key: "statement",
      icon: "print",
      title: words.more.statement,
      detail: words.more.statementDetail,
      onPress: () => setSheet("statement"),
    });
  }
  if (leaving.length > 0) {
    more.push({
      key: "leaving",
      icon: "logout",
      title: words.more.leaving,
      detail: words.more.leavingDetail,
      destructive: true,
      onPress: () => setSheet("leaving"),
    });
  }

  const confirmRemovePhoto = () =>
    Alert.alert(copy.profilePhoto.removeConfirmTitle, copy.profilePhoto.removeConfirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.profilePhoto.removeConfirm,
        style: "destructive",
        onPress: () => void photo.remove().catch(setPhotoError),
      },
    ]);

  // The top bar fills in once the band has scrolled up under it.
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const threshold = Math.max(120, bandHeight - insets.top - 56 - 40);
    const next = event.nativeEvent.contentOffset.y > threshold;
    if (next !== collapsed) setCollapsed(next);
  };

  const tone = left && !graduated ? "left" : "studying";
  const statusWord =
    status && hasLeft(status) ? copy.people.enrollment.statuses[status] : profile.gone;
  const meta = [
    `${words.meta.admission} ${student.admissionNumber}`,
    age === null ? null : words.meta.years(age),
    copy.studentForm.genders[student.gender],
    bloodGroup,
  ]
    .filter(Boolean)
    .join(" · ");
  const miniLine =
    [placeLine, mark ? words.today[mark.status] : null].filter(Boolean).join(" · ") || meta;

  return (
    <View style={styles.screen}>
      <ProfileTopBar
        topInset={insets.top}
        tone={tone}
        collapsed={collapsed}
        name={name}
        line={miniLine}
        photo={
          <MiniFace name={name}>
            {photo.uri ? (
              <StudentPhotoView uri={photo.uri} cacheKey={photo.cacheKey} name={name} size={32} />
            ) : undefined}
          </MiniFace>
        }
        onBack={() => router.back()}
        backLabel={copy.common.back}
        onEdit={can.update ? openEdit : undefined}
        onMore={more.length > 0 ? () => setSheet("more") : undefined}
      />
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={studentQuery.isRefetching}
            onRefresh={() => {
              void studentQuery.refetch();
              void guardiansQuery.refetch();
              void photo.refetch();
              if (enrollmentsEnabled) void enrollmentsQuery.refetch();
              data.refetch();
            }}
            tintColor={colors.onBand}
            colors={[colors.accent]}
            progressViewOffset={insets.top + 56}
          />
        }
        testID="student-profile-scroll"
      >
        <View onLayout={(event) => setBandHeight(event.nativeEvent.layout.height)}>
          <ProfileBand
            tone={tone}
            topSpace={insets.top + 56}
            lift={actions.length > 0}
            banner={
              left ? (
                <LeftBanner
                  title={words.left.banner(
                    statusWord,
                    enrollment?.leftOn ? formatReadableDate(enrollment.leftOn) : null,
                  )}
                  detail={enrollment?.leavingReason ?? words.left.kept}
                />
              ) : undefined
            }
            photo={
              <StudentPhotoView
                uri={photo.uri}
                cacheKey={photo.cacheKey}
                name={name}
                size={88}
                busy={photo.busy}
                onDark
                onPress={
                  can.update
                    ? () => {
                        setPhotoError(null);
                        setPhotoSheetOpen(true);
                      }
                    : undefined
                }
                accessibilityLabel={
                  photo.hasPhoto ? copy.profilePhoto.change : copy.profilePhoto.add
                }
                accessibilityHint={copy.profilePhoto.changeHint}
                testID="student-photo-row"
              />
            }
            name={name}
            meta={meta}
            placement={
              capsuleParts ? (
                <PlacementCapsule parts={capsuleParts} testID="student-placement" />
              ) : null
            }
            today={todayChip}
          />
        </View>
        <ActionRow actions={actions} />

        <View style={styles.body}>
          {savedMsg ? <Notice tone="positive" message={savedMsg} testID="student-saved" /> : null}
          {rejoinError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(rejoinError).message}
              testID="student-rejoin-error"
            />
          ) : null}
          {photoError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(photoError).message}
              testID="student-photo-error"
            />
          ) : null}
          {can.enrolRead && academicYear && enrollmentsQuery.isError ? (
            <Notice
              tone="critical"
              message={profile.enrollmentFailed}
              testID="student-enrollment-error"
            />
          ) : null}

          <FlagCard
            title={words.toFinish.title(student.firstName)}
            count={finishLines.length > 0 ? words.toFinish.left(finishLines.length) : undefined}
            lines={finishLines}
            footnote={finishFootnote}
            testID="student-to-finish"
          />
          <FlagCard
            title={left ? words.left.tc : words.headsUp.title}
            count={headsUp.length > 1 ? String(headsUp.length) : undefined}
            lines={headsUp}
            testID="student-heads-up"
          />

          {tiles.length > 0 ? (
            <>
              <View style={styles.section}>
                <ThemedText variant="sectionLabel">{words.glance.title}</ThemedText>
                {academicYear ? <ThemedText variant="meta">{academicYear.name}</ThemedText> : null}
              </View>
              <View style={styles.tiles}>
                {tiles.map((tile, index) => {
                  const span = spans[index] ?? "half";
                  return (
                    <View key={tile.key} style={span === "full" ? styles.fullCell : styles.halfCell}>
                      {tile.block.state === "ready" ? (
                        tile.render(span)
                      ) : (
                        <TileState
                          label={tile.label}
                          block={tile.block}
                          span={span}
                          testID={`student-tile-${tile.key}`}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          <FamilyCard
            guardians={guardians}
            loading={guardiansQuery.isPending}
            portal={data.portal}
            onCall={callNumber}
            onOpen={can.update ? openGuardian : undefined}
            onAdd={can.update ? () => openGuardian() : undefined}
            onPortal={openPortal}
          />

          <DetailsCard facts={shortFacts} onAll={() => setSheet("details")} />
        </View>
      </ScrollView>

      <MoreSheet
        visible={sheet === "more"}
        name={name}
        line={placeLine || meta}
        items={more}
        onDismiss={closeSheet("more")}
      />
      <AllDetailsSheet
        visible={sheet === "details"}
        groups={groups}
        onDismiss={closeSheet("details")}
        onEdit={
          can.update
            ? () => {
                setSheet(null);
                openEdit();
              }
            : undefined
        }
        emptyNote={emptyGroups.length > 0 ? profile.moreToAddDetail(emptyGroups.join(", ")) : null}
      />
      {homework ? (
        <HomeworkSheet
          visible={sheet === "homework"}
          homework={homework}
          onDismiss={closeSheet("homework")}
        />
      ) : null}
      {attendance && enrollment?.sectionId ? (
        <StudentSummarySheet
          sectionId={enrollment.sectionId}
          entry={{ studentId: student.id, name, roll: enrollment.rollNumber }}
          row={attendance.summary}
          visible={sheet === "attendance"}
          onDismiss={closeSheet("attendance")}
        />
      ) : null}
      {sheet === "statement" && organizationId && schoolId && academicYear ? (
        <PrintSheet
          title={feesCopy.print.statementTitle}
          onClose={() => setSheet(null)}
          load={() =>
            utils.fees.document.statement.fetch(
              { organizationId, schoolId, academicYearId: academicYear.id, studentId: student.id },
              { staleTime: 0 },
            )
          }
          testIDPrefix="student-statement"
        >
          <ThemedText variant="meta">{feesCopy.print.statementHint}</ThemedText>
        </PrintSheet>
      ) : null}
      {sheet === "idCard" && organizationId && schoolId && academicYear ? (
        <IdCardPrintSheet
          organizationId={organizationId}
          schoolId={schoolId}
          list={{
            academicYearId: academicYear.id,
            view: "all",
            sort: "class",
            studentId: student.id,
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      <PhotoSourceSheet
        visible={photoSheetOpen}
        hasPhoto={photo.hasPhoto}
        onDismiss={() => setPhotoSheetOpen(false)}
        onPicked={(picked) => void photo.upload(picked).catch(setPhotoError)}
        onRemove={confirmRemovePhoto}
        onError={setPhotoError}
      />
      <ChoiceSheet
        visible={sheet === "leaving"}
        title={profile.leavingTitle}
        options={leaving.map((to) => ({
          id: to,
          label: profile.leavingReasons[to].label,
          detail: profile.leavingReasons[to].detail,
        }))}
        currentId=""
        onSelect={(id) => {
          setSheet(null);
          setLeavingTo(id as LeavingStatus);
        }}
        onDismiss={closeSheet("leaving")}
        testIDPrefix="student-leaving-option"
      />
      {leavingTo && enrollment ? (
        <LeavingSheet
          organizationId={organizationId ?? ""}
          enrollmentId={enrollment.id}
          enrollmentDate={enrollment.enrollmentDate}
          firstName={student.firstName}
          to={leavingTo}
          onClose={() => setLeavingTo(null)}
          onSaved={() => {
            setLeavingTo(null);
            setSavedMsg(null);
            void utils.student.byId.invalidate({ id: student.id });
          }}
        />
      ) : null}
      {enrollSheet ? (
        <EnrollmentSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          academicYearId={academicYear?.id ?? null}
          studentId={student.id}
          mode={enrollSheet}
          existing={enrollment ?? null}
          onClose={() => setEnrollSheet(null)}
          onSaved={(message) => {
            setEnrollSheet(null);
            setSavedMsg(message);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  flex: {
    flex: 1,
  },
  round: {
    alignSelf: "center",
    borderRadius: 44,
  },
  centered: {
    alignSelf: "center",
  },
  skeleton: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  body: {
    paddingHorizontal: gutter,
  },
  section: {
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  halfCell: {
    flexBasis: "47%",
    flexGrow: 1,
  },
  fullCell: {
    flexBasis: "100%",
  },
});
