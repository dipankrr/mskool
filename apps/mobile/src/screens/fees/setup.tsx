import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import type { ReactNode } from "react";

import { AppIcon, type AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { IconTile } from "../../components/icon-tile";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { feesCopy } from "../../lib/fees-copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";
import { DuesSheet } from "./dues-sheet";

const words = feesCopy.setup;

/**
 * Fee setup as a list of what a school has to do, in the order it does them. A row
 * still needing work is tinted with a caution mark; a finished row goes quiet.
 * Optional rows are never flagged, because leaving them alone is a fine answer.
 * Start billing is done right here, one fee structure at a time.
 */
export function FeeSetupScreen() {
  const { organizationId, schoolId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useBranchMeta();
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();

  const canReadHeads = has("fee_head:read");
  const canReadStructures = has("fee_structure:read");
  const canUpdate = has("fee_structure:update") && sessionOpen;
  const canBill = has("student_fee_assignment:create") && sessionOpen;
  const canReadAny = canReadHeads || canReadStructures;
  const [sheet, setSheet] = useState<"months" | "receipts" | "dues" | null>(null);
  const [notice, setNotice] = useState<{
    tone: "positive" | "caution" | "critical";
    message: string;
  } | null>(null);

  const yearId = academicYear?.id ?? "";
  const enabled = ready && Boolean(organizationId) && Boolean(schoolId) && Boolean(yearId);

  const heads = trpc.fees.head.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: enabled && canReadHeads, staleTime: 60_000 },
  );
  const structures = trpc.fees.structure.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: yearId,
      includeHistory: false,
    },
    { enabled: enabled && canReadStructures, staleTime: 60_000 },
  );
  const settings = trpc.fees.settings.getSession.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      academicYearId: yearId,
    },
    { enabled: enabled && canReadStructures, staleTime: 60_000 },
  );

  const status = trpc.fees.dashboard.setup.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      academicYearId: yearId,
    },
    { enabled: enabled && canReadStructures },
  );
  const mode = trpc.fees.settings.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: enabled && canReadStructures },
  );
  const startBilling = trpc.fees.structure.startBilling.useMutation();
  const utils = trpc.useUtils();

  const refresh = () => {
    if (canReadHeads) void heads.refetch();
    if (canReadStructures) {
      void structures.refetch();
      void settings.refetch();
      void status.refetch();
      void mode.refetch();
    }
  };

  // Most of what this screen reports is changed on the screens it opens.
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      if (canReadHeads) void utils.fees.head.list.invalidate();
      if (canReadStructures) {
        void utils.fees.structure.list.invalidate();
        void utils.fees.dashboard.setup.invalidate();
        void utils.fees.settings.invalidate();
      }
    }, [enabled, canReadHeads, canReadStructures, utils]),
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={words.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canReadAny ? refresh : undefined}
      refreshing={heads.isRefetching || structures.isRefetching}
      titleTestID="fee-setup-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canReadAny) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.setup.deniedTitle}
        message={copy.fees.setup.deniedBody}
        testID="fee-setup-denied"
      />,
    );
  }
  if (!ready || yearPending) {
    return frame(
      <View style={styles.body}>
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>,
    );
  }
  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-setup-no-branch"
      />,
    );
  }
  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.ledger.noYearTitle}
        message={copy.fees.ledger.noYearBody}
        testID="fee-setup-no-year"
      />,
    );
  }
  const loadError = (canReadHeads && heads.error) || (canReadStructures && structures.error);
  if (loadError) {
    return frame(
      <ErrorCard cause={loadError} onRetry={refresh} testID="fee-setup-error" />,
    );
  }

  const live = status.data?.structures ?? [];
  const waiting = live.filter((row) => !row.started);
  const started = live.length > 0 && waiting.length === 0;
  const classes = status.data?.classes ?? [];
  const covered = classes.filter((row) => row.hasStructure).length;
  const everyClass = classes.length > 0 && covered === classes.length;
  const monthsSet = (settings.data?.chargedMonths.length ?? 0) > 0;
  const monthsDone = monthsSet || live.some((row) => row.started);
  const dueDay = words.dueDayWords(settings.data?.dueDay ?? 1);
  const headCount = heads.data?.length ?? 0;
  const previousCount = status.data?.previousDuesStudents ?? 0;
  const steps = words.steps;

  const start = async (row: { id: string; name: string }) => {
    setNotice(null);
    try {
      const result = await startBilling.mutateAsync({
        organizationId,
        schoolId,
        id: row.id,
      });
      await Promise.all([
        utils.fees.dashboard.invalidate(),
        utils.fees.structure.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);
      if (result.refusal) {
        setNotice({ tone: "caution", message: result.refusal });
        return;
      }
      setNotice({
        tone: result.refusedCount > 0 ? "caution" : "positive",
        message: [
          copy.fees.setup.structure.billResult(
            result.billedCount,
            result.skippedCount,
            result.refusedCount,
          ),
          ...result.refused.map((item) => `${item.studentName}: ${item.reason}`),
        ].join("\n"),
      });
    } catch (cause) {
      setNotice({ tone: "critical", message: toFriendlyError(cause).message });
    }
  };

  const confirmStart = (row: { id: string; name: string; waitingStudents: number }) => {
    Alert.alert(
      steps.billing.confirmTitle(row.name),
      steps.billing.confirmBody(row.waitingStudents),
      [
        { text: copy.common.cancel, style: "cancel" },
        { text: steps.billing.action, onPress: () => void start(row) },
      ],
    );
  };

  return frame(
    <View style={styles.body}>
      <ThemedText variant="meta">{words.intro}</ThemedText>
      {notice ? (
        <Notice tone={notice.tone} message={notice.message} testID="fee-setup-notice" />
      ) : null}

      <Card padless style={styles.card}>
        <Row
          first
          icon="calendar"
          attention={!monthsDone}
          title={steps.months.title}
          detail={
            monthsSet && settings.data
              ? steps.months.done(settings.data.chargedMonths.length, dueDay)
              : monthsDone
                ? steps.months.allMonths(dueDay)
                : steps.months.todo
          }
          onPress={canUpdate ? () => setSheet("months") : undefined}
          testID="fee-setup-months"
        />
        <Row
          icon="fees"
          attention={headCount === 0}
          title={steps.types.title}
          detail={headCount > 0 ? steps.types.done(headCount) : steps.types.todo}
          onPress={() => router.push("/fees/setup/heads")}
          testID="fee-setup-heads"
        />
        <Row
          icon="ledger"
          attention={!everyClass}
          title={steps.structures.title}
          detail={
            classes.length > 0 && live.length > 0 && !everyClass
              ? steps.structures.coverage(covered, classes.length)
              : live.length > 0
                ? steps.structures.done(live.length)
                : steps.structures.todo
          }
          onPress={() => router.push("/fees/setup/structures")}
          testID="fee-setup-structures"
        />
        <Row
          icon="collect"
          attention={!started}
          title={steps.billing.title}
          detail={
            live.length === 0
              ? steps.billing.todo
              : started
                ? steps.billing.done
                : steps.billing.waiting(waiting.length)
          }
          onPress={started ? () => router.push("/fees/setup/structures") : undefined}
          testID="fee-setup-billing"
        />
        {waiting.map((row) => (
          <View key={row.id} style={styles.billing} testID={`fee-setup-billing-${row.id}`}>
            <View style={styles.rowText}>
              <ThemedText variant="bodyStrong" numberOfLines={1}>
                {row.name}
              </ThemedText>
              <ThemedText variant="meta" numberOfLines={1}>
                {row.lineCount > 0
                  ? steps.billing.row(row.className, row.waitingStudents)
                  : steps.billing.needsLines}
              </ThemedText>
            </View>
            {row.lineCount === 0 ? (
              <CapsuleButton
                title={steps.structures.title}
                variant="secondary"
                size="mini"
                onPress={() => router.push("/fees/setup/structures")}
                testID={`fee-setup-open-${row.id}`}
              />
            ) : canBill ? (
              <CapsuleButton
                title={steps.billing.action}
                size="mini"
                loading={startBilling.isPending && startBilling.variables?.id === row.id}
                onPress={() => confirmStart(row)}
                testID={`fee-setup-start-${row.id}`}
              />
            ) : null}
          </View>
        ))}
      </Card>

      <ThemedText variant="sectionLabel">{words.optionalTitle}</ThemedText>
      <Card padless style={styles.card}>
        <Row
          first
          icon="history"
          title={steps.previous.title}
          detail={previousCount > 0 ? steps.previous.count(previousCount) : steps.previous.todo}
          onPress={() => router.push("/fees/setup/previous-dues" as Href)}
          testID="fee-setup-previous"
        />
        <Row
          icon="stack"
          title={steps.services.title}
          detail={steps.services.hint}
          onPress={() => router.push("/fees/setup/services")}
          testID="fee-setup-services"
        />
        <Row
          icon="receipt"
          title={steps.receipts.title}
          detail={steps.receipts.detail(
            settings.data?.receiptPrefix ?? "RCP",
            settings.data?.nextReceiptNumber ?? 1,
          )}
          onPress={canUpdate ? () => setSheet("receipts") : undefined}
          testID="fee-setup-receipts"
        />
        <Row
          icon="clock"
          title={steps.dues.title}
          detail={mode.data?.mode === "monthly_manual" ? steps.dues.paused : steps.dues.automatic}
          onPress={() => setSheet("dues")}
          testID="fee-setup-dues"
        />
      </Card>

      {sheet === "months" ? (
        <MonthsSheet
          organizationId={organizationId}
          schoolId={schoolId}
          academicYearId={academicYear.id}
          startDate={academicYear.startDate}
          endDate={academicYear.endDate}
          initial={settings.data}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            setNotice({ tone: "positive", message: words.saved });
          }}
        />
      ) : null}
      {sheet === "receipts" ? (
        <ReceiptsSheet
          organizationId={organizationId}
          schoolId={schoolId}
          academicYearId={academicYear.id}
          initial={settings.data}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            setNotice({ tone: "positive", message: words.saved });
          }}
        />
      ) : null}
      {sheet === "dues" ? (
        <DuesSheet
          organizationId={organizationId}
          schoolId={schoolId}
          academicYearId={academicYear.id}
          sessionEnd={academicYear.endDate}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>,
  );
}

function Row({
  icon,
  title,
  detail,
  attention = false,
  first = false,
  onPress,
  testID,
}: {
  icon: AppIconName;
  title: string;
  detail: string;
  attention?: boolean;
  first?: boolean;
  onPress?: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[attention ? words.attention : null, title, detail]
        .filter(Boolean)
        .join(". ")}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        attention ? styles.attention : null,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <IconTile name={icon} size={40} tone={attention ? "neutral" : "accent"} />
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {detail}
        </ThemedText>
      </View>
      {attention ? (
        <AppIcon name="warningCircle" size={20} color={colors.tone.caution.fg} />
      ) : null}
      {onPress ? <AppIcon name="chevronRight" size={18} color={colors.chevron} /> : null}
    </Pressable>
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sessionMonths(startDate: string, endDate: string) {
  const out: { key: string; label: string }[] = [];
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(5, 7));
  const lastYear = Number(endDate.slice(0, 4));
  const lastMonth = Number(endDate.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: MONTH_SHORT[month - 1] ?? "",
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

type DueChoice = "1" | "10" | "15" | "31";

function MonthsSheet({
  organizationId,
  schoolId,
  academicYearId,
  startDate,
  endDate,
  initial,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  startDate: string;
  endDate: string;
  initial?: {
    chargedMonths: string[];
    dueDay: number;
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const months = sessionMonths(startDate, endDate);
  const [picked, setPicked] = useState(
    () =>
      new Set(
        initial && initial.chargedMonths.length > 0
          ? initial.chargedMonths
          : months.map((month) => month.key),
      ),
  );
  const startDue = String(initial?.dueDay ?? 1);
  const [dueDay, setDueDay] = useState<DueChoice>(
    (["1", "10", "15", "31"].includes(startDue) ? startDue : "1") as DueChoice,
  );
  const [error, setError] = useState<unknown>(null);
  const save = trpc.fees.settings.setSession.useMutation();
  const utils = trpc.useUtils();

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        organizationId,
        schoolId,
        academicYearId,
        data: {
          chargedMonths: months.map((month) => month.key).filter((key) => picked.has(key)),
          dueDay: Number(dueDay),
        },
      });
      await utils.fees.settings.getSession.invalidate();
      onDone();
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={words.monthsSheetTitle}
      onClose={onClose}
      testIDPrefix="fee-months-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={words.save}
            icon="check"
            size="compact"
            loading={save.isPending}
            disabled={picked.size === 0}
            onPress={() => void submit()}
            testID="fee-months-save"
          />
        </View>
      }
    >
      <View style={styles.monthsBlock}>
        <ThemedText variant="sectionLabel">{words.monthsLabel}</ThemedText>
        <View style={styles.chips}>
          {months.map((month) => {
            const on = picked.has(month.key);
            return (
              <Pressable
                key={month.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={month.label}
                onPress={() => {
                  const nextSet = new Set(picked);
                  if (on) nextSet.delete(month.key);
                  else nextSet.add(month.key);
                  setPicked(nextSet);
                }}
                style={[styles.chip, on ? styles.chipOn : null]}
                testID={`fee-month-chip-${month.key}`}
              >
                <ThemedText variant="meta" color={on ? colors.accentDeep : colors.muted}>
                  {month.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <ThemedText variant="caption">{words.monthsHelp}</ThemedText>
      </View>

      <ChoicePills
        label={words.dueDayLabel}
        value={dueDay}
        options={[
          { value: "1" as const, label: words.dueDays.first },
          { value: "10" as const, label: words.dueDays.tenth },
          { value: "15" as const, label: words.dueDays.fifteenth },
          { value: "31" as const, label: words.dueDays.last },
        ]}
        onChange={setDueDay}
        testIDPrefix="fee-due-day"
      />

      {error ? (
        <Notice tone="critical" message={toFriendlyError(error).message} testID="fee-months-error" />
      ) : null}
    </FormSheet>
  );
}

function ReceiptsSheet({
  organizationId,
  schoolId,
  academicYearId,
  initial,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  initial?: { receiptPrefix: string; nextReceiptNumber: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [prefix, setPrefix] = useState(initial?.receiptPrefix ?? "RCP");
  const [next, setNext] = useState(String(initial?.nextReceiptNumber ?? 1));
  const [error, setError] = useState<unknown>(null);
  const save = trpc.fees.settings.setSession.useMutation();
  const utils = trpc.useUtils();

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        organizationId,
        schoolId,
        academicYearId,
        data: { receiptPrefix: prefix.trim(), nextReceiptNumber: Number(next) || 1 },
      });
      await utils.fees.settings.getSession.invalidate();
      onDone();
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={words.receiptsSheetTitle}
      onClose={onClose}
      testIDPrefix="fee-receipts-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={words.save}
            icon="check"
            size="compact"
            loading={save.isPending}
            disabled={prefix.trim().length === 0}
            onPress={() => void submit()}
            testID="fee-receipts-save"
          />
        </View>
      }
    >
      <FormField
        label={words.receiptLabel}
        value={prefix}
        onChangeText={setPrefix}
        maxLength={20}
        testID="fee-receipt-prefix"
      />
      <FormField
        label={words.nextReceiptLabel}
        value={next}
        onChangeText={(value) => setNext(value.replace(/[^\d]/g, ""))}
        keyboardType="number-pad"
        help={words.nextReceiptHelp}
        maxLength={7}
        testID="fee-receipt-next"
      />
      {error ? (
        <Notice tone="critical" message={toFriendlyError(error).message} testID="fee-receipts-error" />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  card: {
    overflow: "hidden",
  },
  row: {
    minHeight: touch.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  attention: {
    backgroundColor: colors.tone.caution.bg,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  billing: {
    minHeight: touch.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.tone.caution.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  sheetFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  monthsBlock: {
    gap: spacing.xs,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    minHeight: 40,
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
});
