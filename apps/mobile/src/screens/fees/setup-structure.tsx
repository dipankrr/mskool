import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  formatAmountDigits,
  formatMoney,
  parseMoney,
  sanitizeAmountInput,
  toInputAmount,
  toMoneyString,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";
import { PrintSheet } from "./print-sheet";
import { FactChip, SectionHead } from "./status";
import { useSessionOpen } from "../../hooks/use-session-open";

type Structure = inferRouterOutputs<AppRouter>["fees"]["structure"]["byId"];
type Line =
  inferRouterOutputs<AppRouter>["fees"]["structure"]["listLines"][number];
type Rule =
  inferRouterOutputs<AppRouter>["fees"]["structure"]["listLateFeeRules"][number];
type Head = inferRouterOutputs<AppRouter>["fees"]["head"]["list"][number];
type Frequency = "monthly" | "quarterly" | "half_yearly" | "term_wise" | "once";
type RuleType = "flat" | "percentage" | "per_day";
type ApplyPer = "fee" | "month";
type RuleScope = "structure" | "school";

const FREQUENCY_ORDER: Frequency[] = [
  "monthly",
  "quarterly",
  "half_yearly",
  "term_wise",
  "once",
];

/**
 * One structure's bill (Step 5E): its fee lines and the late-fee rules that
 * apply to it.
 *
 * A structure is a template. A due already created keeps its own amount, so
 * edits here only reach dues not created yet. Retiring it only stops new
 * billing. "Start billing" is the switch: it bills everyone the structure covers,
 * and new admissions are billed on their own from then on.
 */
export function FeeStructureScreen() {
  const params = useLocalSearchParams<{
    structureId?: string;
    className?: string;
  }>();
  const { organizationId, schoolId, ready, yearPending } = useActiveContext();
  const branchName = useBranchMeta();
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();

  const structureId =
    typeof params.structureId === "string" ? params.structureId : "";
  const routeClassName =
    typeof params.className === "string" && params.className.length > 0
      ? params.className
      : null;

  const canRead = has("fee_structure:read");
  const canCreate = has("fee_structure:create") && sessionOpen;
  const canUpdate = has("fee_structure:update") && sessionOpen;
  const canReadHeads = has("fee_head:read");
  const canReadClasses = has("class:read");
  // Billing is the assignment grant, not the setup one.
  const canBill = has("student_fee_assignment:create") && sessionOpen;

  const [sheet, setSheet] = useState<
    | { mode: "edit" }
    | { mode: "line"; line?: Line }
    | { mode: "period"; period: Line["periods"][number] }
    | { mode: "rule" }
    | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [billResult, setBillResult] = useState<{
    tone: "positive" | "caution" | "critical";
    message: string;
  } | null>(null);
  const startBilling = trpc.fees.structure.startBilling.useMutation();
  const removeRule = trpc.fees.structure.removeLateFeeRule.useMutation();
  const utils = trpc.useUtils();

  const enabled =
    ready &&
    canRead &&
    Boolean(organizationId) &&
    Boolean(schoolId) &&
    Boolean(structureId);

  const structure = trpc.fees.structure.byId.useQuery(
    {
      id: structureId,
      includeHistory: true,
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
    },
    { enabled, staleTime: 60_000 },
  );

  const lines = trpc.fees.structure.listLines.useQuery(
    {
      id: structureId,
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
    },
    { enabled: enabled && Boolean(structure.data), staleTime: 60_000 },
  );

  const heads = trpc.fees.head.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: enabled && canReadHeads && Boolean(organizationId),
      staleTime: 5 * 60_000,
    },
  );

  const rules = trpc.fees.structure.listLateFeeRules.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: enabled && Boolean(structure.data), staleTime: 60_000 },
  );

  // A deep link arrives without the list's className; the class register
  // fills the gap when the caller may read it.
  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled:
        enabled && canReadClasses && !routeClassName && Boolean(structure.data),
      staleTime: 5 * 60_000,
    },
  );

  const className =
    routeClassName ??
    (structure.data
      ? (classes.data?.find((row) => row.id === structure.data?.classId)
          ?.name ?? copy.fees.setup.structures.classNameUnknown)
      : null);

  const headNames = new Map(
    (heads.data ?? []).map((row) => [row.id, row.name] as const),
  );

  const lineRows = lines.data ?? [];
  const usedHeadIds = new Set(lineRows.map((row) => row.feeHeadId));
  const availableHeads = (heads.data ?? []).filter(
    (row) => !usedHeadIds.has(row.id),
  );

  const ruleRows = (rules.data ?? []).filter(
    (row) => row.feeStructureId === null || row.feeStructureId === structureId,
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={structure.data?.name ?? copy.fees.setup.structure.title}
      meta={
        structure.data ? className : branchName
      }
      backAccessibilityLabel={copy.common.back}
      action={
        canUpdate && structure.data
          ? {
              label: copy.fees.setup.structures.editTitle,
              icon: "edit",
              onPress: () => setSheet({ mode: "edit" }),
              testID: "fee-structure-edit",
            }
          : undefined
      }
      secondaryAction={
        structure.data
          ? {
              label: feesCopy.print.printOrShare,
              icon: "print",
              iconOnly: true,
              onPress: () => setPrinting(true),
              testID: "fee-structure-print",
            }
          : undefined
      }
      onRefresh={
        canRead
          ? () => {
              void structure.refetch();
              void lines.refetch();
              void rules.refetch();
            }
          : undefined
      }
      refreshing={
        structure.isRefetching || lines.isRefetching || rules.isRefetching
      }
      titleTestID="fee-structure-title"
    >
      {children}
      {printing && organizationId && schoolId ? (
        <PrintSheet
          title={feesCopy.print.structureTitle}
          onClose={() => setPrinting(false)}
          load={() =>
            utils.fees.document.structureSheet.fetch(
              { organizationId, schoolId, id: structureId },
              { staleTime: 0 },
            )
          }
          testIDPrefix="fee-structure-print-sheet"
        />
      ) : null}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.setup.deniedTitle}
        message={copy.fees.setup.deniedBody}
        testID="fee-structure-denied"
      />,
    );
  }

  if (!structureId) {
    return frame(
      <EmptyState
        icon="stack"
        title={copy.fees.setup.structure.notFoundTitle}
        message={copy.fees.setup.structure.notFoundBody}
        testID="fee-structure-missing"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={64} />
        <Skeleton height={160} />
        <Skeleton height={120} />
      </View>,
    );
  }

  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-structure-no-branch"
      />,
    );
  }

  if (structure.isError) {
    const notFound = structure.error.data?.code === "NOT_FOUND";
    return frame(
      notFound ? (
        <EmptyState
          icon="stack"
          title={copy.fees.setup.structure.notFoundTitle}
          message={copy.fees.setup.structure.notFoundBody}
          testID="fee-structure-not-found"
        />
      ) : (
        <ErrorCard
          cause={structure.error}
          onRetry={() => void structure.refetch()}
          testID="fee-structure-error"
        />
      ),
    );
  }

  if (structure.isPending && !structure.data) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={64} />
        <Skeleton height={160} />
        <Skeleton height={120} />
      </View>,
    );
  }

  const active = structure.data?.isActive ?? false;
  const canAddLine = canCreate && canReadHeads && active;
  const canAddRule = canCreate && active;
  const canBillClass = canBill && active && lineRows.length > 0;

  // The server skips anyone already billed, so pressing it twice is harmless.
  const runBillClass = async () => {
    if (!structure.data) return;
    setBillResult(null);
    try {
      const result = await startBilling.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        id: structure.data.id,
      });
      await Promise.all([
        utils.fees.dashboard.invalidate(),
        utils.fees.structure.byId.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);
      if (result.refusal) {
        setBillResult({ tone: "caution", message: result.refusal });
        return;
      }
      const reasons = result.refused
        .map((row) => `${row.studentName}: ${row.reason}`)
        .join("\n");
      setBillResult({
        tone: result.refusedCount > 0 ? "caution" : "positive",
        message: [
          copy.fees.setup.structure.billResult(
            result.billedCount,
            result.skippedCount,
            result.refusedCount,
          ),
          reasons,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (cause) {
      setBillResult({
        tone: "critical",
        message: toFriendlyError(cause).message,
      });
    }
  };

  const confirmBillClass = () => {
    Alert.alert(
      copy.fees.setup.structure.billConfirmTitle,
      copy.fees.setup.structure.billConfirmBody(className ?? ""),
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.fees.setup.structure.billConfirmAction,
          onPress: () => void runBillClass(),
        },
      ],
    );
  };

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice
          tone="positive"
          message={notice}
          testID="fee-structure-notice"
        />
      ) : null}

      {canBillClass ? (
        <Card style={styles.billCard}>
          <ThemedText variant="bodyStrong">
            {structure.data?.billingStartedAt
              ? feesCopy.line.billingOnTitle
              : feesCopy.line.billingOffTitle}
          </ThemedText>
          <ThemedText variant="meta">
            {structure.data?.billingStartedAt
              ? feesCopy.line.billingOnBody
              : feesCopy.line.billingOffBody(className ?? "")}
          </ThemedText>
          <CapsuleButton
            title={
              structure.data?.billingStartedAt
                ? feesCopy.line.billingOnAction
                : feesCopy.line.billingOffAction
            }
            icon="collect"
            size="compact"
            variant={structure.data?.billingStartedAt ? "secondary" : "primary"}
            loading={startBilling.isPending}
            onPress={confirmBillClass}
            testID="fee-structure-bill-class"
          />
          {billResult ? (
            <Notice
              tone={billResult.tone}
              message={billResult.message}
              testID="fee-structure-bill-result"
            />
          ) : null}
        </Card>
      ) : null}

      {structure.data && !active ? (
        <Notice
          tone="caution"
          message={copy.fees.setup.structure.retiredNotice}
          testID="fee-structure-retired"
        />
      ) : null}

      <View style={styles.section}>
        <SectionHead
          title={copy.fees.setup.structure.linesTitle}
          hint={copy.fees.setup.structure.linesHint(lineRows.length)}
        >
          {canAddLine && availableHeads.length > 0 ? (
            <CapsuleButton
              title={copy.fees.setup.structure.addLine}
              icon="add"
              variant="secondary"
              size="mini"
              onPress={() => setSheet({ mode: "line" })}
              testID="fee-structure-add-line"
            />
          ) : null}
        </SectionHead>

        {lines.isError ? (
          <ErrorCard
            cause={lines.error}
            onRetry={() => void lines.refetch()}
            testID="fee-structure-lines-error"
          />
        ) : lines.isPending && !lines.data ? (
          <Skeleton height={140} />
        ) : lineRows.length === 0 ? (
          <EmptyState
            icon="fees"
            title={copy.fees.setup.structure.noLinesTitle}
            message={copy.fees.setup.structure.noLinesBody}
            testID="fee-structure-lines-empty"
          />
        ) : (
          <Card padless>
            {lineRows.map((line, index) => (
              <LineRow
                key={line.id}
                line={line}
                headName={
                  headNames.get(line.feeHeadId) ??
                  copy.fees.setup.structure.headUnknown
                }
                first={index === 0}
                onPress={
                  canUpdate && active
                    ? () => setSheet({ mode: "line", line })
                    : undefined
                }
                onPeriod={
                  canUpdate && active
                    ? (period) => setSheet({ mode: "period", period })
                    : undefined
                }
              />
            ))}
          </Card>
        )}

        {canAddLine && availableHeads.length === 0 ? (
          <ThemedText variant="caption" style={styles.hint}>
            {copy.fees.setup.structure.allHeadsUsed}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionHead
          title={copy.fees.setup.structure.rulesTitle}
          hint={copy.fees.setup.structure.rulesHint}
        >
          {canAddRule ? (
            <CapsuleButton
              title={copy.fees.setup.structure.addRule}
              icon="add"
              variant="secondary"
              size="mini"
              onPress={() => setSheet({ mode: "rule" })}
              testID="fee-structure-add-rule"
            />
          ) : null}
        </SectionHead>

        {rules.isError ? (
          <ErrorCard
            cause={rules.error}
            onRetry={() => void rules.refetch()}
            testID="fee-structure-rules-error"
          />
        ) : rules.isPending && !rules.data ? (
          <Skeleton height={120} />
        ) : ruleRows.length === 0 ? (
          <EmptyState
            icon="warning"
            title={copy.fees.setup.structure.noRulesTitle}
            message={copy.fees.setup.structure.noRulesBody}
            testID="fee-structure-rules-empty"
          />
        ) : (
          <Card padless>
            {ruleRows.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                first={index === 0}
                schoolWide={rule.feeStructureId === null}
                onRemove={
                  canUpdate
                    ? () => {
                        Alert.alert(
                          feesCopy.line.ruleOffTitle,
                          feesCopy.line.ruleOffBody,
                          [
                            { text: copy.common.cancel, style: "cancel" },
                            {
                              text: feesCopy.line.ruleOffConfirm,
                              style: "destructive",
                              onPress: () => {
                                void removeRule
                                  .mutateAsync({
                                    organizationId,
                                    schoolId,
                                    id: rule.id,
                                  })
                                  .then(() =>
                                    utils.fees.structure.listLateFeeRules.invalidate(),
                                  )
                                  .then(() => setNotice(feesCopy.line.ruleOffDone))
                                  .catch((cause: unknown) =>
                                    setNotice(toFriendlyError(cause).message),
                                  );
                              },
                            },
                          ],
                        );
                      }
                    : undefined
                }
              />
            ))}
          </Card>
        )}

        <ThemedText variant="caption" style={styles.hint}>
          {copy.fees.setup.structure.rulesImmutable}
        </ThemedText>
      </View>

      {sheet?.mode === "edit" && structure.data ? (
        <StructureEditSheet
          structure={structure.data}
          organizationId={organizationId}
          schoolId={schoolId}
          canRetire={canUpdate}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
          onRetired={() => {
            setSheet(null);
            router.back();
          }}
        />
      ) : null}

      {sheet?.mode === "line" ? (
        <LineSheet
          structureId={structureId}
          academicYearId={structure.data?.academicYearId ?? ""}
          line={sheet.line}
          organizationId={organizationId}
          schoolId={schoolId}
          heads={heads.data ?? []}
          usedHeadIds={usedHeadIds}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}

      {sheet?.mode === "period" ? (
        <PeriodSheet
          period={sheet.period}
          organizationId={organizationId}
          schoolId={schoolId}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}

      {sheet?.mode === "rule" ? (
        <RuleSheet
          structureId={structureId}
          organizationId={organizationId}
          schoolId={schoolId}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}
    </View>,
  );
}

function LineRow({
  line,
  headName,
  first,
  onPress,
  onPeriod,
}: {
  line: Line;
  headName: string;
  first: boolean;
  onPress?: () => void;
  onPeriod?: (period: Line["periods"][number]) => void;
}) {
  const [showSchedule, setShowSchedule] = useState(false);
  const words = feesCopy.line;
  const frequency = line.frequency as Frequency;
  const yearTotal = toMoneyString(
    line.periods.reduce((acc, period) => acc + (parseMoney(period.amount) ?? 0n), 0n),
  );
  const detail = [
    words.perPeriod[frequency](formatMoney(line.amount)),
    frequency === "once" ? null : words.periodCount[frequency](line.periods.length),
    line.whoPays === "new_students" ? words.whoPaysNew : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const row = (
    <>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {headName}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {detail}
        </ThemedText>
      </View>
      <ThemedText
        variant="numeric"
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={styles.amount}
      >
        {formatMoney(yearTotal)}
      </ThemedText>
    </>
  );

  return (
    <View style={first ? null : styles.divider}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${headName}, ${detail}, ${formatMoney(yearTotal)}`}
          onPress={onPress}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          testID={`fee-structure-line-${line.id}`}
        >
          {row}
        </Pressable>
      ) : (
        <View style={styles.row}>{row}</View>
      )}
      {line.frequency !== "once" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showSchedule }}
          onPress={() => setShowSchedule((value) => !value)}
          style={styles.scheduleToggle}
          testID={`fee-structure-schedule-${line.id}`}
        >
          <ThemedText variant="meta" color={colors.accentDeep}>
            {showSchedule ? words.hideSchedule : words.showSchedule}
          </ThemedText>
        </Pressable>
      ) : null}
      {showSchedule
        ? line.periods.map((period) => (
            <Pressable
              key={period.id}
              accessibilityRole={onPeriod ? "button" : "text"}
              disabled={!onPeriod}
              onPress={() => onPeriod?.(period)}
              style={({ pressed }) => [
                styles.periodRow,
                pressed ? styles.rowPressed : null,
              ]}
              testID={`fee-period-${period.periodKey}`}
            >
              <View style={styles.rowText}>
                <ThemedText variant="meta" numberOfLines={1}>
                  {period.label}
                </ThemedText>
                <ThemedText variant="caption" numberOfLines={1}>
                  {words.dueOn(formatReadableDate(period.dueDate))}
                </ThemedText>
              </View>
              <ThemedText variant="meta" numberOfLines={1}>
                {formatMoney(period.amount)}
              </ThemedText>
            </Pressable>
          ))
        : null}
    </View>
  );
}

function RuleRow({
  rule,
  first,
  schoolWide,
  onRemove,
}: {
  rule: Rule;
  first: boolean;
  schoolWide: boolean;
  onRemove?: () => void;
}) {
  const type = rule.calculationType as RuleType;
  const typeLabel =
    copy.fees.setup.structure.ruleTypes[type] ?? rule.calculationType;
  const value =
    type === "percentage"
      ? `${formatAmountDigits(rule.value)}%`
      : formatMoney(rule.value);
  const grace = copy.fees.setup.structure.graceValue(rule.gracePeriodDays);
  const max = rule.maxLateFee
    ? ` · ${copy.fees.setup.structure.maxValue(formatMoney(rule.maxLateFee))}`
    : "";
  const dates = copy.fees.setup.structure.ruleDates(
    formatReadableDate(rule.effectiveFrom),
    rule.effectiveTo ? formatReadableDate(rule.effectiveTo) : null,
  );

  return (
    <View
      style={[styles.ruleRow, first ? null : styles.divider]}
      accessible
      accessibilityLabel={[
        typeLabel,
        value,
        grace,
        rule.maxLateFee
          ? copy.fees.setup.structure.maxValue(formatMoney(rule.maxLateFee))
          : null,
        dates,
        schoolWide ? copy.fees.setup.structure.schoolWide : null,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {typeLabel} · {value}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {grace}
          {max}
        </ThemedText>
        <ThemedText variant="caption" numberOfLines={1}>
          {dates}
        </ThemedText>
        <ThemedText variant="caption" numberOfLines={1}>
          {feesCopy.line.applyPer[rule.applyPer as ApplyPer]}
        </ThemedText>
      </View>
      <View style={styles.ruleSide}>
        {schoolWide ? (
          <FactChip label={copy.fees.setup.structure.schoolWide} tone="neutral" />
        ) : (
          <FactChip label={copy.fees.setup.structure.scopeThis} tone="neutral" />
        )}
        {onRemove ? (
          <CapsuleButton
            title={feesCopy.line.ruleOffAction}
            variant="secondary"
            size="mini"
            onPress={onRemove}
            testID={`late-rule-off-${rule.id}`}
          />
        ) : null}
      </View>
    </View>
  );
}

function StructureEditSheet({
  structure,
  organizationId,
  schoolId,
  canRetire,
  onClose,
  onDone,
  onRetired,
}: {
  structure: Structure;
  organizationId: string;
  schoolId: string;
  canRetire: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onRetired: () => void;
}) {
  const [name, setName] = useState(structure.name);
  const classSections = trpc.academic.section.list.useQuery({
    organizationId,
    schoolId,
    academicYearId: structure.academicYearId,
  });
  const linked = trpc.fees.structure.listSections.useQuery({
    organizationId,
    schoolId,
    id: structure.id,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(linked.data ?? []);
  const sectionRows = (classSections.data ?? []).filter(
    (row) => row.classId === structure.classId,
  );
  const setSections = trpc.fees.structure.setSections.useMutation();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = trpc.fees.structure.update.useMutation();
  const deactivate = trpc.fees.structure.deactivate.useMutation();
  const utils = trpc.useUtils();

  const pending = update.isPending || deactivate.isPending;
  const nameError =
    submitted && name.trim().length === 0
      ? copy.fees.setup.structures.nameRequired
      : undefined;

  const invalidate = async () => {
    await Promise.all([
      utils.fees.structure.list.invalidate(),
      utils.fees.structure.byId.invalidate(),
    ]);
  };

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (name.trim().length === 0) return;
    try {
      await update.mutateAsync({
        organizationId,
        schoolId,
        id: structure.id,
        data: { name: name.trim() },
      });
      if (picked) {
        await setSections.mutateAsync({
          organizationId,
          schoolId,
          id: structure.id,
          sectionIds: [...picked],
        });
        await utils.fees.structure.listSections.invalidate();
      }
      await invalidate();
      onDone(copy.fees.setup.structures.updated);
    } catch (cause) {
      setError(cause);
    }
  };

  const retire = () => {
    Alert.alert(
      copy.fees.setup.structures.retireTitle,
      copy.fees.setup.structures.retireBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.fees.setup.structures.retireConfirm,
          style: "destructive",
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                await deactivate.mutateAsync({
                  organizationId,
                  schoolId,
                  id: structure.id,
                });
                await invalidate();
                onRetired();
              } catch (cause) {
                setError(cause);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <FormSheet
      title={copy.fees.setup.structures.editTitle}
      onClose={onClose}
      testIDPrefix="fee-structure-edit-sheet"
      footer={
        <View style={styles.sheetFooter}>
          {canRetire && structure.isActive ? (
            <CapsuleButton
              title={copy.fees.setup.structures.retireAction}
              variant="destructive"
              size="compact"
              onPress={retire}
              disabled={pending}
              testID="fee-structure-retire"
            />
          ) : null}
          <CapsuleButton
            title={copy.fees.setup.structures.save}
            icon="check"
            size="compact"
            loading={pending}
            onPress={() => void submit()}
            testID="fee-structure-save"
          />
        </View>
      }
    >
      <FormField
        label={copy.fees.setup.structures.nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={copy.fees.setup.structures.namePlaceholder}
        error={nameError}
        maxLength={150}
        testID="fee-structure-edit-name"
      />

      {sectionRows.length > 0 ? (
        <View style={styles.periods}>
          <ThemedText variant="sectionLabel">{feesCopy.line.sectionsLabel}</ThemedText>
          <View style={styles.chips}>
            {sectionRows.map((section) => {
              const on = chosen.has(section.id);
              return (
                <Pressable
                  key={section.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={section.name}
                  onPress={() => {
                    const next = new Set(chosen);
                    if (on) next.delete(section.id);
                    else next.add(section.id);
                    setPicked(next);
                  }}
                  style={[styles.chip, on ? styles.chipOn : null]}
                  testID={`fee-structure-section-${section.id}`}
                >
                  <ThemedText
                    variant="meta"
                    color={on ? colors.accentDeep : colors.muted}
                  >
                    {section.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText variant="caption">{feesCopy.line.sectionsHelp}</ThemedText>
        </View>
      ) : null}

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-structure-edit-error"
        />
      ) : null}
    </FormSheet>
  );
}

function LineSheet({
  structureId,
  academicYearId,
  line,
  organizationId,
  schoolId,
  heads,
  usedHeadIds,
  onClose,
  onDone,
}: {
  structureId: string;
  academicYearId: string;
  line?: Line;
  organizationId: string;
  schoolId: string;
  heads: Head[];
  usedHeadIds: Set<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const words = feesCopy.line;
  const editing = Boolean(line);
  const [feeHeadId, setFeeHeadId] = useState<string | null>(
    line?.feeHeadId ?? null,
  );
  const [frequency, setFrequency] = useState<Frequency>(
    (line?.frequency as Frequency | undefined) ?? "monthly",
  );
  const [amount, setAmount] = useState(line ? toInputAmount(line.amount) : "");
  const [whoPays, setWhoPays] = useState<"everyone" | "new_students">(
    (line?.whoPays as "everyone" | "new_students" | undefined) ?? "everyone",
  );
  const [picked, setPicked] = useState<Set<string> | null>(
    line && line.frequency === frequency
      ? new Set(line.periods.map((period) => period.periodKey))
      : null,
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const addLine = trpc.fees.structure.addLine.useMutation();
  const updateLine = trpc.fees.structure.updateLine.useMutation();
  const utils = trpc.useUtils();

  const options = trpc.fees.structure.periodOptions.useQuery({
    organizationId,
    schoolId,
    academicYearId,
    frequency,
  });
  const settings = trpc.fees.settings.getSession.useQuery({
    organizationId,
    schoolId,
    academicYearId,
  });

  // New lines start from the months the school charges, set once in setup.
  const charged = settings.data?.chargedMonths ?? [];
  const optionKeys = (options.data ?? []).map((option) => option.key);
  const selected =
    picked ??
    new Set(
      frequency === "monthly" && charged.length > 0
        ? optionKeys.filter((key) => charged.includes(key))
        : optionKeys,
    );

  const pending = addLine.isPending || updateLine.isPending;
  const parsed = parseMoney(amount);
  const headOptions = heads
    .filter(
      (head) =>
        head.category !== "optional" &&
        (!usedHeadIds.has(head.id) || head.id === line?.feeHeadId),
    )
    .map((head) => ({ id: head.id, label: head.name }));
  const headName =
    heads.find((head) => head.id === feeHeadId)?.name ??
    (editing ? copy.fees.setup.structure.headUnknown : null);

  const onChooseHead = (id: string) => {
    setFeeHeadId(id);
    // A one-time fee type starts as a one-time line. It can still be changed.
    if (!editing && heads.find((head) => head.id === id)?.category === "one_time") {
      setFrequency("once");
      setPicked(null);
    }
  };

  const headError =
    submitted && !editing && !feeHeadId ? copy.fees.setup.structure.headRequired : undefined;
  const amountError =
    submitted && (parsed === null || parsed < 0n) ? words.amountError : undefined;
  const periodError = submitted && selected.size === 0 ? words.periodError : undefined;

  const keys = optionKeys.filter((key) => selected.has(key));
  const total =
    parsed !== null && parsed >= 0n ? formatMoney(toMoneyString(parsed * BigInt(keys.length))) : null;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (!editing && !feeHeadId) return;
    if (parsed === null || parsed < 0n || keys.length === 0) return;

    try {
      if (editing && line) {
        await updateLine.mutateAsync({
          organizationId,
          schoolId,
          id: line.id,
          data: { amount, frequency, whoPays, periodKeys: keys },
        });
      } else if (feeHeadId) {
        await addLine.mutateAsync({
          organizationId,
          schoolId,
          id: structureId,
          data: { feeHeadId, amount, frequency, whoPays, periodKeys: keys },
        });
      }
      await Promise.all([
        utils.fees.structure.listLines.invalidate(),
        utils.fees.structure.list.invalidate(),
      ]);
      onDone(
        editing
          ? copy.fees.setup.structure.lineUpdated
          : copy.fees.setup.structure.lineCreated,
      );
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={
        editing
          ? copy.fees.setup.structure.lineSheetEditTitle
          : copy.fees.setup.structure.lineSheetAddTitle
      }
      onClose={onClose}
      testIDPrefix="fee-line-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.fees.setup.structure.lineSave}
            icon="check"
            size="compact"
            loading={pending}
            onPress={() => void submit()}
            testID="fee-line-save"
          />
        </View>
      }
    >
      <SelectField
        label={copy.fees.setup.structure.headLabel}
        valueLabel={headName}
        placeholder={copy.fees.setup.structure.headPlaceholder}
        options={headOptions}
        currentId={feeHeadId ?? ""}
        onSelect={onChooseHead}
        error={headError}
        disabled={editing}
        testID="fee-line-head"
      />

      <ChoicePills
        label={words.howOften}
        value={frequency}
        options={FREQUENCY_ORDER.map((value) => ({
          value,
          label: words.frequencies[value],
        }))}
        onChange={(next) => {
          setFrequency(next);
          setPicked(null);
        }}
        testIDPrefix="fee-line-frequency"
      />

      <FormField
        label={words.amountLabel[frequency]}
        value={amount}
        onChangeText={(next) => setAmount(sanitizeAmountInput(next))}
        placeholder="1000"
        keyboardType="decimal-pad"
        error={amountError}
        maxLength={11}
        testID="fee-line-amount"
      />

      {frequency !== "once" ? (
        <View style={styles.periods}>
          <ThemedText variant="sectionLabel">{words.periodsLabel[frequency]}</ThemedText>
          <View style={styles.chips}>
            {(options.data ?? []).map((option) => {
              const on = selected.has(option.key);
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={option.label}
                  onPress={() => {
                    const next = new Set(selected);
                    if (on) next.delete(option.key);
                    else next.add(option.key);
                    setPicked(next);
                  }}
                  style={[styles.chip, on ? styles.chipOn : null]}
                  testID={`fee-line-period-${option.key}`}
                >
                  <ThemedText
                    variant="meta"
                    numberOfLines={1}
                    color={on ? colors.accentDeep : colors.muted}
                  >
                    {frequency === "monthly"
                      ? option.label.slice(0, 3)
                      : option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          {periodError ? (
            <ThemedText variant="meta" color={colors.tone.critical.fg}>
              {periodError}
            </ThemedText>
          ) : null}
          {total ? (
            <ThemedText variant="meta" testID="fee-line-total">
              {words.total(keys.length, total)}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      <ChoicePills
        label={words.whoPays}
        value={whoPays}
        options={[
          { value: "everyone", label: words.whoPaysEveryone },
          { value: "new_students", label: words.whoPaysNew },
        ]}
        onChange={setWhoPays}
        help={words.whoPaysHelp}
        testIDPrefix="fee-line-who-pays"
      />

      {editing ? (
        <ThemedText variant="caption" style={styles.hint}>
          {words.editHint}
        </ThemedText>
      ) : null}

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-line-sheet-error"
        />
      ) : null}
    </FormSheet>
  );
}

/** One row of a schedule: "₹1,200 from October" or a different due date. */
function PeriodSheet({
  period,
  organizationId,
  schoolId,
  onClose,
  onDone,
}: {
  period: Line["periods"][number];
  organizationId: string;
  schoolId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const words = feesCopy.line;
  const [amount, setAmount] = useState(toInputAmount(period.amount));
  const [dueDate, setDueDate] = useState(period.dueDate);
  const [error, setError] = useState<unknown>(null);
  const update = trpc.fees.structure.updatePeriod.useMutation();
  const utils = trpc.useUtils();

  const submit = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        organizationId,
        schoolId,
        id: period.id,
        data: { amount, dueDate },
      });
      await utils.fees.structure.listLines.invalidate();
      onDone(words.periodSaved);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={period.label}
      onClose={onClose}
      testIDPrefix="fee-period-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.fees.setup.structure.lineSave}
            icon="check"
            size="compact"
            loading={update.isPending}
            onPress={() => void submit()}
            testID="fee-period-save"
          />
        </View>
      }
    >
      <FormField
        label={words.periodAmount}
        value={amount}
        onChangeText={(next) => setAmount(sanitizeAmountInput(next))}
        keyboardType="decimal-pad"
        maxLength={11}
        testID="fee-period-amount"
      />
      <DateField
        label={words.periodDue}
        value={dueDate}
        onChange={setDueDate}
        testID="fee-period-due"
      />
      <ThemedText variant="caption" style={styles.hint}>
        {words.editHint}
      </ThemedText>
      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-period-error"
        />
      ) : null}
    </FormSheet>
  );
}

function RuleSheet({
  structureId,
  organizationId,
  schoolId,
  onClose,
  onDone,
}: {
  structureId: string;
  organizationId: string;
  schoolId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [type, setType] = useState<RuleType>("flat");
  const [value, setValue] = useState("");
  const [grace, setGrace] = useState("0");
  const [max, setMax] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [hasEnd, setHasEnd] = useState(false);
  const [effectiveTo, setEffectiveTo] = useState(todayIso());
  const [scope, setScope] = useState<RuleScope>("structure");
  const [applyPer, setApplyPer] = useState<ApplyPer>("month");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const addRule = trpc.fees.structure.addLateFeeRule.useMutation();
  const utils = trpc.useUtils();

  const parsedValue = parseMoney(value);
  const parsedMax = max.trim().length > 0 ? parseMoney(max) : null;
  const graceDays = /^\d+$/.test(grace) ? Number(grace) : null;

  const valueError =
    submitted && (parsedValue === null || parsedValue <= 0n)
      ? copy.fees.setup.structure.ruleValueError
      : undefined;
  const graceError =
    submitted && (graceDays === null || graceDays > 365)
      ? copy.fees.setup.structure.graceError
      : undefined;
  const maxError =
    submitted &&
    max.trim().length > 0 &&
    (parsedMax === null || parsedMax <= 0n)
      ? copy.fees.setup.structure.maxError
      : undefined;
  const dateError =
    submitted && hasEnd && effectiveTo < effectiveFrom
      ? copy.fees.setup.structure.ruleDateError
      : undefined;

  const valueLabel =
    type === "percentage"
      ? copy.fees.setup.structure.ruleValuePercent
      : type === "per_day"
        ? copy.fees.setup.structure.ruleValuePerDay
        : copy.fees.setup.structure.ruleValueFlat;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (parsedValue === null || parsedValue <= 0n) return;
    if (graceDays === null || graceDays > 365) return;
    if (max.trim().length > 0 && (parsedMax === null || parsedMax <= 0n)) {
      return;
    }
    if (hasEnd && effectiveTo < effectiveFrom) return;

    try {
      await addRule.mutateAsync({
        organizationId,
        schoolId,
        data: {
          feeStructureId: scope === "structure" ? structureId : null,
          calculationType: type,
          applyPer,
          value,
          gracePeriodDays: graceDays,
          maxLateFee: max.trim().length > 0 ? max : null,
          effectiveFrom,
          effectiveTo: hasEnd ? effectiveTo : null,
        },
      });
      await utils.fees.structure.listLateFeeRules.invalidate();
      onDone(copy.fees.setup.structure.ruleCreated);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={copy.fees.setup.structure.ruleSheetTitle}
      onClose={onClose}
      testIDPrefix="late-rule-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.fees.setup.structure.ruleSave}
            icon="check"
            size="compact"
            loading={addRule.isPending}
            onPress={() => void submit()}
            testID="late-rule-save"
          />
        </View>
      }
    >
      <ChoicePills
        label={copy.fees.setup.structure.ruleTypeLabel}
        value={type}
        options={(["flat", "percentage", "per_day"] as const).map((next) => ({
          value: next,
          label: copy.fees.setup.structure.ruleTypes[next],
        }))}
        onChange={setType}
        testIDPrefix="late-rule-type"
      />

      <FormField
        label={valueLabel}
        value={value}
        onChangeText={(next) => setValue(sanitizeAmountInput(next))}
        placeholder={type === "percentage" ? "5" : "500"}
        keyboardType="decimal-pad"
        suffix={
          type === "percentage"
            ? copy.fees.setup.structure.valueSuffix
            : undefined
        }
        help={copy.fees.setup.structure.ruleValueHelp}
        error={valueError}
        maxLength={10}
        testID="late-rule-value"
      />

      <ChoicePills
        label={feesCopy.line.applyPerLabel}
        value={applyPer}
        options={[
          { value: "month", label: feesCopy.line.applyPerMonth },
          { value: "fee", label: feesCopy.line.applyPerFee },
        ]}
        onChange={setApplyPer}
        help={feesCopy.line.applyPerHelp}
        testIDPrefix="late-rule-apply-per"
      />

      <FormField
        label={copy.fees.setup.structure.graceLabel}
        value={grace}
        onChangeText={(next) => setGrace(next.replace(/[^\d]/g, ""))}
        keyboardType="number-pad"
        help={copy.fees.setup.structure.graceHelp}
        error={graceError}
        maxLength={3}
        testID="late-rule-grace"
      />

      <FormField
        label={copy.fees.setup.structure.maxLabel}
        value={max}
        onChangeText={(next) => setMax(sanitizeAmountInput(next))}
        keyboardType="decimal-pad"
        help={copy.fees.setup.structure.maxHelp}
        error={maxError}
        maxLength={10}
        testID="late-rule-max"
      />

      <DateField
        label={copy.fees.setup.structure.effectiveFromLabel}
        value={effectiveFrom}
        onChange={setEffectiveFrom}
        testID="late-rule-from"
      />

      <SwitchRow
        label={copy.fees.setup.structure.ruleHasEnd}
        value={hasEnd}
        onChange={setHasEnd}
        testID="late-rule-has-end"
      />

      {hasEnd ? (
        <DateField
          label={copy.fees.setup.structure.effectiveToLabel}
          value={effectiveTo}
          onChange={setEffectiveTo}
          error={dateError}
          minimumDate={effectiveFrom}
          testID="late-rule-to"
        />
      ) : null}

      <ChoicePills
        label={copy.fees.setup.structure.scopeLabel}
        value={scope}
        options={[
          { value: "structure", label: copy.fees.setup.structure.scopeThis },
          { value: "school", label: copy.fees.setup.structure.scopeSchool },
        ]}
        onChange={setScope}
        help={copy.fees.setup.structure.scopeHelp}
        testIDPrefix="late-rule-scope"
      />

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="late-rule-sheet-error"
        />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  billCard: {
    gap: spacing.sm,
  },
  body: {
    gap: spacing.xl,
  },
  skeletons: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
    gap: spacing.xxs,
  },
  amount: {
    flexShrink: 0,
    textAlign: "right",
  },
  hint: {
    paddingHorizontal: spacing.xs,
  },
  ruleSide: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  scheduleToggle: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  periodRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  periods: {
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
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
