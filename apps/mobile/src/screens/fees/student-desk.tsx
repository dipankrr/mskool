import { useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import { CONCESSION_TYPE_LABEL, installmentTitle, monthKeyOf, monthNameOf } from "../../lib/fees";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate, localDateToIso, todayIso } from "../../lib/format";
import { formatMoney, isPositiveMoney, paidPercent, sumMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConcessionSheet } from "./concession-sheet";
import {
  AssignSheet,
  OneOffSheet,
  StatusSheet,
  VoidConcessionSheet,
  DueSheet,
} from "./desk-actions";
import { MonthSheet } from "./month-sheet";
import { PaymentRow } from "./payment-row";
import { PrintSheet } from "./print-sheet";
import { SectionHead } from "./status";

type DeskSheet =
  | { kind: "assign" }
  | { kind: "concession"; assignmentId: string }
  | { kind: "one-off" }
  | { kind: "status"; assignmentId: string; next: "active" | "suspended" }
  | { kind: "void"; concessionId: string; label: string }
  | {
      kind: "due";
      due: {
        id: string;
        title: string;
        net: string;
        paid: string;
        dueDate: string;
        status: string;
      };
    }
  | { kind: "month"; month: string; label: string };

type DeskNotice = { message: string; tone: "positive" | "caution" };

type MonthState = "overdue" | "due" | "upcoming" | "paid" | "none";

/** A month cell's fill and ink. Colour is never alone: the amount or a tick says it too. */
const MONTH_LOOK: Record<MonthState, { bg: string; fg: string; border?: string }> = {
  overdue: { bg: colors.tone.critical.bg, fg: colors.tone.critical.fg },
  due: { bg: colors.tone.caution.bg, fg: colors.tone.caution.fg, border: colors.tone.caution.fg },
  upcoming: { bg: colors.tone.neutral.bg, fg: colors.tone.neutral.fg },
  paid: { bg: colors.tone.positive.bg, fg: colors.tone.positive.fg },
  none: { bg: colors.canvas, fg: colors.muted },
};

/** Opens the dialler; a phone without one gets told rather than ignored. */
function callNumber(phone: string) {
  Linking.openURL(`tel:${phone}`).catch(() => Alert.alert(copy.students.profile.callFailed));
}

/**
 * One student's fee page, from one read. It opens on the answer: what is owed
 * now, and the parts that add up to it, nothing else. Then every action in one
 * row, the session month by month, payments, and the one-off charges and
 * concessions. Every due and the waive controls sit a tap further in, so a stray
 * tap can't waive a fee.
 */
export function StudentFeeDeskScreen() {
  const params = useLocalSearchParams<{
    studentId?: string;
    studentName?: string;
  }>();
  const { organizationId, schoolId, academicYear, yearPending, ready } = useActiveContext();
  const { has, hasAny } = usePermissions();
  const sessionOpen = useSessionOpen();
  const words = feesCopy.student;

  const studentId = params.studentId ?? "";
  const canRead = hasAny("fee_report:read", "student_fee_assignment:read");
  const canCollect = has("fee_payment:create") && sessionOpen;
  const canBill = has("student_fee_assignment:create") && sessionOpen;
  const canManage = has("student_fee_assignment:update") && sessionOpen;
  const canConcession = has("fee_waiver:create") && sessionOpen;
  const canReadPayments = has("fee_payment:read");
  const canPrint = has("fee_report:read");

  const [sheet, setSheet] = useState<DeskSheet | null>(null);
  const [notice, setNotice] = useState<DeskNotice | null>(null);
  const [printing, setPrinting] = useState<"statement" | "noDues" | null>(null);
  const utils = trpc.useUtils();

  const summary = trpc.fees.dashboard.student.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  const guardians = trpc.guardian.list.useQuery(
    { organizationId: organizationId ?? "", id: studentId },
    { enabled: ready && Boolean(organizationId) && Boolean(studentId) && has("student:read") },
  );
  const contact =
    (guardians.data ?? []).find((guardian) => guardian.isPrimary && guardian.phone) ??
    (guardians.data ?? []).find((guardian) => guardian.phone);

  const data = summary.data;
  const title =
    data?.student.name ??
    (typeof params.studentName === "string" ? params.studentName : copy.fees.desk.title);
  const classLine = data
    ? [
        data.student.className,
        data.student.sectionName,
        data.student.rollNumber ? `Roll ${data.student.rollNumber}` : null,
        data.student.admissionNumber,
      ]
        .filter(Boolean)
        .join(" · ")
    : copy.fees.desk.title;
  const className = data
    ? [data.student.className, data.student.sectionName].filter(Boolean).join(" · ")
    : "";

  const onDone = (message: string, tone: "positive" | "caution" = "positive") => {
    setNotice({ message, tone });
    setSheet(null);
    AccessibilityInfo.announceForAccessibility(message);
  };

  /** Collect, either for everything due or for one month, fee or due. */
  const openCollect = (focus?: string) =>
    router.push({
      pathname: "/fees/collect/[studentId]",
      params: { studentId, studentName: title, className, ...(focus ? { focus } : {}) },
    });

  const hasDues = Boolean(data && data.dues.length + data.previousDues.length > 0);

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={title}
      meta={classLine}
      backAccessibilityLabel={copy.common.back}
      action={
        contact?.phone
          ? {
              label: words.callParent,
              icon: "call",
              iconOnly: true,
              onPress: () => callNumber(contact.phone),
              testID: "fee-desk-call",
            }
          : undefined
      }
      onRefresh={canRead ? () => void summary.refetch() : undefined}
      refreshing={summary.isRefetching}
      footer={footer}
      footerVariant="floating"
      titleTestID="fee-desk-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.fees.noAccessTitle}
        message={copy.fees.noAccessBody}
        testID="fee-desk-no-access"
      />,
    );
  }
  if (!ready || yearPending || (summary.isPending && !data && !summary.isError)) {
    return frame(
      <View style={styles.body}>
        <Skeleton height={200} />
        <Skeleton height={72} />
        <Skeleton height={240} />
      </View>,
    );
  }
  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-desk-no-branch"
      />,
    );
  }
  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.noYearTitle}
        message={copy.fees.noYearBody}
        testID="fee-desk-no-year"
      />,
    );
  }
  if (summary.isError || !data) {
    return frame(
      <ErrorCard
        cause={summary.error}
        onRetry={() => void summary.refetch()}
        testID="fee-desk-error"
      />,
    );
  }

  const record = data.feeRecord;
  const { totals } = data;
  const currentMonth = monthKeyOf(todayIso());
  const owesAnything = isPositiveMoney(totals.dueNow) || isPositiveMoney(totals.later);

  // The oldest month with something still open, for "Overdue since 1 Apr".
  const oldestOverdue = data.dues
    .filter(
      (due) =>
        isPositiveMoney(due.balanceAmount) &&
        due.paymentStatus !== "waived" &&
        monthKeyOf(due.dueDate) < currentMonth,
    )
    .map((due) => due.dueDate)
    .sort()[0];
  const overdueMonths = data.months.filter(
    (month) => month.month < currentMonth && isPositiveMoney(month.balance),
  ).length;

  const parts = [
    {
      key: "previous",
      label: words.previous,
      when: null,
      amount: totals.previousDues,
      color: colors.tone.neutral.fg,
    },
    {
      key: "overdue",
      label: words.overdue,
      when: words.overdueMonths(overdueMonths),
      amount: totals.overdue,
      color: colors.tone.critical.fg,
    },
    {
      key: "this",
      label: words.thisMonth,
      when: monthNameOf(currentMonth),
      amount: totals.thisMonth,
      color: colors.tone.caution.fg,
    },
  ].filter((part) => isPositiveMoney(part.amount));

  const heroPill =
    record && record.status !== "active" ? (
      <StatusPill
        label={words.recordStatus[record.status as "suspended" | "cancelled"] ?? record.status}
        tone="caution"
        testID="fee-desk-status"
      />
    ) : oldestOverdue ? (
      <StatusPill
        label={words.overdueSince(formatReadableDate(oldestOverdue).replace(/ \d{4}$/, ""))}
        tone="critical"
        testID="fee-desk-overdue-since"
      />
    ) : !isPositiveMoney(totals.dueNow) && record ? (
      <StatusPill label={words.allPaid} tone="positive" testID="fee-desk-all-paid" />
    ) : !record && isPositiveMoney(totals.previousDues) ? (
      <StatusPill label={words.previousOnly} tone="neutral" />
    ) : null;

  // The last month already paid in full, for a student who owes nothing now.
  const paidThrough = [...data.months]
    .filter((month) => month.state === "paid")
    .map((month) => month.month)
    .sort()
    .pop();

  const billedThisSession = sumMoney(
    data.months.filter((month) => month.state !== "none").map((month) => month.net),
  );
  const shownStates = new Set(data.months.map((month) => month.state));
  const anyPart = data.months.some(
    (month) => isPositiveMoney(month.paid) && isPositiveMoney(month.balance),
  );

  const oneOffs = data.dues.filter((due) => due.periodKey.startsWith("one:"));

  const tiles: {
    key: string;
    icon: AppIconName;
    label: string;
    tone?: "caution";
    dim?: boolean;
    onPress: () => void;
  }[] = [];
  if (canManage)
    tiles.push({
      key: "charge",
      icon: "add",
      label: words.tiles.charge,
      onPress: () => setSheet({ kind: "one-off" }),
    });
  if (record && canConcession) {
    tiles.push({
      key: "concession",
      icon: "fees",
      label: words.tiles.concession,
      onPress: () => setSheet({ kind: "concession", assignmentId: record.id }),
    });
  }
  if (canPrint) {
    tiles.push({
      key: "statement",
      icon: "print",
      label: words.tiles.statement,
      onPress: () => setPrinting("statement"),
    });
    tiles.push({
      key: "no-dues",
      icon: "receipt",
      label: words.tiles.noDues,
      dim: owesAnything,
      onPress: () =>
        owesAnything
          ? Alert.alert(
              feesCopy.print.noDuesTitle,
              words.noDuesBlocked(formatMoney(sumMoney([totals.dueNow, totals.later]))),
            )
          : setPrinting("noDues"),
    });
  }
  tiles.push({
    key: "ledger",
    icon: "ledger",
    label: words.tiles.ledger,
    onPress: () =>
      router.push({ pathname: "/fees/ledger", params: { studentId, studentName: title } }),
  });
  if (record && canManage && record.status !== "cancelled") {
    tiles.push({
      key: "status",
      icon: "clock",
      label: record.status === "active" ? words.tiles.pause : words.tiles.restore,
      tone: "caution",
      onPress: () =>
        setSheet({
          kind: "status",
          assignmentId: record.id,
          next: record.status === "active" ? "suspended" : "active",
        }),
    });
  }

  return frame(
    <View style={styles.body}>
      {!sessionOpen ? (
        <Notice tone="caution" message={copy.fees.sessionClosed} testID="fees-session-closed" />
      ) : null}
      {notice ? (
        <Notice tone={notice.tone} message={notice.message} testID="fee-desk-notice">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.common.dismiss}
            onPress={() => setNotice(null)}
            style={styles.dismiss}
            testID="fee-desk-notice-dismiss"
          >
            <ThemedText variant="meta" color={colors.accentDeep}>
              {copy.common.dismiss}
            </ThemedText>
          </Pressable>
        </Notice>
      ) : null}

      <Card padless>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <ThemedText variant="sectionLabel">{words.dueNow}</ThemedText>
            {heroPill}
          </View>
          <ThemedText
            variant="hero"
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
            testID="fee-desk-due-now"
          >
            {formatMoney(totals.dueNow)}
          </ThemedText>
          {parts.length > 0 ? (
            <>
              <View
                style={styles.split}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {parts.map((part) => (
                  <View
                    key={part.key}
                    style={[
                      styles.splitPart,
                      { backgroundColor: part.color, flex: Number(part.amount) },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.parts}>
                {parts.map((part) => (
                  <View key={part.key} style={styles.part} testID={`fee-desk-part-${part.key}`}>
                    <View style={[styles.dot, { backgroundColor: part.color }]} />
                    <ThemedText
                      variant="body"
                      color={part.key === "overdue" ? colors.tone.critical.fg : undefined}
                    >
                      {part.label}
                    </ThemedText>
                    {part.when ? (
                      <ThemedText variant="meta" numberOfLines={1} style={styles.flex}>
                        {part.when}
                      </ThemedText>
                    ) : (
                      <View style={styles.flex} />
                    )}
                    <ThemedText
                      variant="bodyStrong"
                      maxFontSizeMultiplier={1.2}
                      color={part.key === "overdue" ? colors.tone.critical.fg : undefined}
                    >
                      {formatMoney(part.amount)}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.calm}>
              <AppIcon name="checkCircle" size={20} color={colors.accentDeep} />
              <ThemedText variant="meta" color={colors.ink}>
                {paidThrough ? words.paidUpTo(monthNameOf(paidThrough)) : words.nothingYet}
              </ThemedText>
            </View>
          )}
        </View>
        {hasDues ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/fees/dues/[studentId]",
                params: { studentId, studentName: title, className },
              })
            }
            style={({ pressed }) => [styles.heroLink, pressed ? styles.pressed : null]}
            testID="fee-desk-every-due"
          >
            <ThemedText variant="bodyStrong" color={colors.accentDeep}>
              {words.seeEveryDue}
            </ThemedText>
            <AppIcon name="chevronRight" size={18} color={colors.accentDeep} />
          </Pressable>
        ) : null}
      </Card>

      {!record ? (
        <Card style={styles.notBilled}>
          <View style={styles.notBilledHead}>
            <View style={[styles.tileIcon, { backgroundColor: colors.tone.caution.bg }]}>
              <AppIcon name="warning" size={20} color={colors.tone.caution.fg} />
            </View>
            <View style={styles.flex}>
              <ThemedText variant="bodyStrong">{copy.fees.desk.notAssignedTitle}</ThemedText>
              <ThemedText variant="meta">{copy.fees.desk.notAssignedBody}</ThemedText>
            </View>
          </View>
          {canBill ? (
            <CapsuleButton
              title={copy.fees.desk.assignAction}
              icon="check"
              variant="secondary"
              size="compact"
              onPress={() => setSheet({ kind: "assign" })}
              testID="fee-desk-assign"
            />
          ) : null}
        </Card>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tiles}
        style={styles.tilesScroll}
        testID="fee-desk-actions"
      >
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            onPress={tile.onPress}
            style={({ pressed }) => [
              styles.tile,
              tile.dim ? styles.dim : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`fee-desk-tile-${tile.key}`}
          >
            <AppIcon
              name={tile.icon}
              size={22}
              color={tile.tone === "caution" ? colors.tone.caution.fg : colors.accentDeep}
            />
            <ThemedText
              variant="caption"
              color={colors.ink}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {tile.label}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {data.months.some((month) => month.state !== "none") ? (
        <Card style={styles.year}>
          <View style={styles.yearHead}>
            <ThemedText variant="name">{academicYear.name}</ThemedText>
            <ThemedText variant="meta" numberOfLines={1}>
              {words.yearPaid(formatMoney(totals.paid), formatMoney(billedThisSession))}
            </ThemedText>
          </View>
          <View style={styles.progress}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(paidPercent(totals.paid, billedThisSession), isPositiveMoney(totals.paid) ? 2 : 0)}%`,
                },
              ]}
            />
          </View>
          {isPositiveMoney(totals.later) ? (
            <ThemedText variant="meta">{words.yearLater(formatMoney(totals.later))}</ThemedText>
          ) : null}
          <View style={styles.grid}>
            {Array.from({ length: Math.ceil(data.months.length / 4) }, (_, row) => (
              <View key={row} style={styles.gridRow}>
                {data.months.slice(row * 4, row * 4 + 4).map((month) => {
                  const look = MONTH_LOOK[month.state];
                  const part = isPositiveMoney(month.paid) && isPositiveMoney(month.balance);
                  return (
                    <Pressable
                      key={month.month}
                      accessibilityRole="button"
                      accessibilityLabel={`${month.label}. ${isPositiveMoney(month.balance) ? `${formatMoney(month.balance)} open` : words.monthState[month.state]}`}
                      disabled={month.state === "none"}
                      onPress={() =>
                        setSheet({ kind: "month", month: month.month, label: month.label })
                      }
                      style={({ pressed }) => [
                        styles.cell,
                        { backgroundColor: look.bg },
                        look.border ? { borderWidth: 2, borderColor: look.border } : null,
                        pressed ? styles.cellPressed : null,
                      ]}
                      testID={`fee-month-${month.month}`}
                    >
                      <ThemedText variant="caption" color={look.fg}>
                        {month.label}
                      </ThemedText>
                      {month.state === "paid" ? (
                        <AppIcon name="check" size={16} color={look.fg} />
                      ) : (
                        <ThemedText
                          variant={
                            month.state === "overdue" || month.state === "due" ? "chip" : "meta"
                          }
                          color={look.fg}
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.1}
                        >
                          {isPositiveMoney(month.balance) ? formatMoney(month.balance) : "—"}
                        </ThemedText>
                      )}
                      {part ? (
                        <View style={styles.cellTrack}>
                          <View
                            style={[
                              styles.cellFill,
                              { width: `${paidPercent(month.paid, month.net)}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
                {Array.from(
                  { length: 4 - data.months.slice(row * 4, row * 4 + 4).length },
                  (_, gap) => (
                    <View key={`gap-${gap}`} style={styles.cellGap} />
                  ),
                )}
              </View>
            ))}
          </View>
          <View style={styles.legend}>
            {(["overdue", "due", "upcoming", "paid", "none"] as const)
              .filter((state) => shownStates.has(state))
              .map((state) => (
                <View key={state} style={styles.legendItem}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: MONTH_LOOK[state].bg, borderColor: MONTH_LOOK[state].fg },
                    ]}
                  />
                  <ThemedText variant="caption" color={colors.muted}>
                    {words.legend[state]}
                  </ThemedText>
                </View>
              ))}
            {anyPart ? (
              <View style={styles.legendItem}>
                <View style={styles.swatchLine} />
                <ThemedText variant="caption" color={colors.muted}>
                  {words.legend.part}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {canReadPayments ? (
        <>
          <SectionHead title={words.payments} />
          {data.recentPayments.length === 0 ? (
            <ThemedText variant="meta" style={styles.paymentEmpty}>
              {copy.fees.desk.paymentHistoryEmpty}
            </ThemedText>
          ) : (
            <Card padless>
              {data.recentPayments.map((payment, index) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  first={index === 0}
                  onPress={() =>
                    router.push({
                      pathname: "/fees/payments/[paymentId]",
                      params: { paymentId: payment.id },
                    })
                  }
                />
              ))}
            </Card>
          )}
        </>
      ) : null}

      {oneOffs.length + data.concessions.length > 0 ? (
        <>
          <SectionHead title={words.charges} />
          <Card padless>
            {oneOffs.map((due, index) => (
              <ChargeRow
                key={due.id}
                first={index === 0}
                icon="add"
                title={installmentTitle(due)}
                detail={words.oneOff(formatReadableDate(localDateToIso(new Date(due.createdAt))))}
                amount={formatMoney(due.netAmount)}
                onPress={() =>
                  setSheet({
                    kind: "due",
                    due: {
                      id: due.id,
                      title: installmentTitle(due),
                      net: due.netAmount,
                      paid: due.paidAmount,
                      dueDate: due.dueDate,
                      status: due.paymentStatus,
                    },
                  })
                }
                testID={`fee-charge-${due.id}`}
              />
            ))}
            {data.concessions.map((concession, index) => {
              const label =
                CONCESSION_TYPE_LABEL[
                  concession.concessionType as keyof typeof CONCESSION_TYPE_LABEL
                ] ?? concession.concessionType;
              return (
                <ChargeRow
                  key={concession.id}
                  first={oneOffs.length === 0 && index === 0}
                  icon="fees"
                  tone="positive"
                  title={label}
                  detail={concession.reason}
                  amount={`− ${formatMoney(concession.concessionAmount)}`}
                  onPress={
                    canConcession
                      ? () => setSheet({ kind: "void", concessionId: concession.id, label })
                      : undefined
                  }
                  testID={`fee-concession-${concession.id}`}
                />
              );
            })}
          </Card>
        </>
      ) : null}

      {printing ? (
        <PrintSheet
          title={
            printing === "statement" ? feesCopy.print.statementTitle : feesCopy.print.noDuesTitle
          }
          onClose={() => setPrinting(null)}
          load={() => {
            const input = { organizationId, schoolId, academicYearId: academicYear.id, studentId };
            return printing === "statement"
              ? utils.fees.document.statement.fetch(input, { staleTime: 0 })
              : utils.fees.document.noDues.fetch(input, { staleTime: 0 });
          }}
          testIDPrefix={`fee-desk-print-${printing}`}
        >
          <View style={styles.docCard}>
            <View style={[styles.tileIcon, { backgroundColor: colors.surface }]}>
              <AppIcon
                name={printing === "statement" ? "print" : "receipt"}
                size={20}
                color={colors.accentDeep}
              />
            </View>
            <View style={styles.flex}>
              <ThemedText variant="bodyStrong">{title}</ThemedText>
              <ThemedText variant="meta">
                {printing === "statement"
                  ? feesCopy.print.statementHint
                  : feesCopy.print.noDuesHint}
              </ThemedText>
            </View>
          </View>
        </PrintSheet>
      ) : null}
      {sheet?.kind === "assign" ? (
        <AssignSheet
          organizationId={organizationId}
          schoolId={schoolId}
          enrollmentId={data.student.enrollmentId}
          className={data.student.className}
          choices={data.structureChoices}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "concession" ? (
        <ConcessionSheet
          organizationId={organizationId}
          schoolId={schoolId}
          assignmentId={sheet.assignmentId}
          academicYearStart={academicYear.startDate}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "one-off" ? (
        <OneOffSheet
          organizationId={organizationId}
          schoolId={schoolId}
          studentId={studentId}
          academicYearId={academicYear.id}
          studentName={title}
          className={className}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "status" ? (
        <StatusSheet
          organizationId={organizationId}
          schoolId={schoolId}
          assignmentId={sheet.assignmentId}
          next={sheet.next}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "void" ? (
        <VoidConcessionSheet
          organizationId={organizationId}
          schoolId={schoolId}
          concessionId={sheet.concessionId}
          label={sheet.label}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "due" ? (
        <DueSheet
          organizationId={organizationId}
          schoolId={schoolId}
          due={sheet.due}
          canManage={canManage}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "month" ? (
        <MonthSheet
          organizationId={organizationId}
          studentId={studentId}
          academicYearId={academicYear.id}
          month={sheet.month}
          label={sheet.label}
          onClose={() => setSheet(null)}
          onPay={
            canCollect
              ? (focus) => {
                  setSheet(null);
                  openCollect(focus);
                }
              : undefined
          }
          onWaive={(installment) =>
            setSheet({
              kind: "due",
              due: {
                id: installment.id,
                title: installment.title,
                net: "0.00",
                paid: "0.00",
                dueDate: "",
                status: "unpaid",
              },
            })
          }
        />
      ) : null}
    </View>,
    canCollect && hasDues ? (
      <CapsuleButton
        title={copy.fees.desk.collectAction}
        icon="collect"
        variant={isPositiveMoney(totals.dueNow) ? "primary" : "secondary"}
        onPress={() => openCollect()}
        style={styles.wide}
        testID="fee-desk-collect"
      />
    ) : undefined,
  );
}

function ChargeRow({
  icon,
  title,
  detail,
  amount,
  tone,
  first,
  onPress,
  testID,
}: {
  icon: AppIconName;
  title: string;
  detail: string | null;
  amount: string;
  tone?: "positive";
  first: boolean;
  onPress?: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.charge,
        first ? null : styles.divider,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.tileIcon,
          { backgroundColor: tone === "positive" ? colors.accentTint : colors.chip },
        ]}
      >
        <AppIcon
          name={icon}
          size={20}
          color={tone === "positive" ? colors.accentDeep : colors.tone.neutral.fg}
        />
      </View>
      <View style={styles.flex}>
        <ThemedText variant="name" numberOfLines={1}>
          {title}
        </ThemedText>
        {detail ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText
        variant="bodyStrong"
        color={tone === "positive" ? colors.accentDeep : undefined}
        maxFontSizeMultiplier={1.2}
      >
        {amount}
      </ThemedText>
      {onPress ? <AppIcon name="chevronRight" size={18} color={colors.chevron} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  wide: {
    alignSelf: "stretch",
  },
  dismiss: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  hero: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  heroTop: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  split: {
    marginTop: spacing.sm,
    height: 8,
    flexDirection: "row",
    gap: 2,
  },
  splitPart: {
    minWidth: 6,
    borderRadius: radius.full,
  },
  parts: {
    marginTop: spacing.xs,
  },
  part: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  calm: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  heroLink: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  notBilled: {
    gap: spacing.md,
  },
  notBilledHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tilesScroll: {
    marginHorizontal: -spacing.xl,
  },
  tiles: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  tile: {
    width: 84,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dim: {
    opacity: 0.5,
  },
  year: {
    gap: spacing.sm,
  },
  yearHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  progress: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  grid: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  gridRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  cellGap: {
    flex: 1,
  },
  cell: {
    flex: 1,
    height: 52,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    overflow: "hidden",
  },
  cellPressed: {
    opacity: 0.7,
  },
  cellTrack: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.xs,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.tone.critical.bg,
  },
  cellFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    rowGap: spacing.xs,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 4,
    borderWidth: 1,
  },
  swatchLine: {
    width: 12,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  paymentEmpty: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  charge: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
  },
});
