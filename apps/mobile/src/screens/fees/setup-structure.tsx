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
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { monthLabel, monthRangeLabel } from "../../lib/fees";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  formatAmountDigits,
  formatMoney,
  parseMoney,
  sanitizeAmountInput,
  toInputAmount,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing, touch } from "../../theme/tokens";
import { FactChip, SectionHead } from "./status";
import { useSessionOpen } from "../../hooks/use-session-open";

type Structure = inferRouterOutputs<AppRouter>["fees"]["structure"]["byId"];
type Line =
  inferRouterOutputs<AppRouter>["fees"]["structure"]["listLines"][number];
type Rule =
  inferRouterOutputs<AppRouter>["fees"]["structure"]["listLateFeeRules"][number];
type Head = inferRouterOutputs<AppRouter>["fees"]["head"]["list"][number];
type Frequency =
  "inherit" | "monthly" | "quarterly" | "half_yearly" | "annual" | "term_wise";
type RuleType = "flat" | "percentage" | "per_day";
type RuleScope = "structure" | "school";

const FREQUENCY_ORDER: Frequency[] = [
  "inherit",
  "monthly",
  "quarterly",
  "half_yearly",
  "annual",
  "term_wise",
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  label: monthLabel(index + 1),
}));

/**
 * One structure's bill (Step 5E): its fee lines and the late-fee rules that
 * apply to it.
 *
 * A structure is a template. Editing it never reaches a generated bill —
 * installments freeze the amounts they were created with — so this screen can
 * offer ordinary edits without a warning banner. Retiring it only stops new
 * assignments.
 */
export function FeeStructureScreen() {
  const params = useLocalSearchParams<{
    structureId?: string;
    className?: string;
  }>();
  const { organizationId, schoolId, ready, yearPending } = useActiveContext();
  const branchName = useActiveBranchName();
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
    { mode: "edit" } | { mode: "line"; line?: Line } | { mode: "rule" } | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [billResult, setBillResult] = useState<{
    tone: "positive" | "caution" | "critical";
    message: string;
  } | null>(null);
  const billClass = trpc.fees.assignment.billClass.useMutation();
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

  const mode = structure.data
    ? (copy.fees.setup.structures.modes[
        structure.data
          .installmentMode as keyof typeof copy.fees.setup.structures.modes
      ] ?? structure.data.installmentMode)
    : null;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={structure.data?.name ?? copy.fees.setup.structure.title}
      meta={
        className && mode
          ? `${className} · ${mode}`
          : structure.data
            ? className
            : branchName
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

  // "Bill all students in this class": a shortcut beside per-student billing.
  // The server skips anyone already billed, so pressing it twice is harmless.
  const runBillClass = async () => {
    if (!structure.data) return;
    setBillResult(null);
    try {
      const result = await billClass.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        data: {
          academicYearId: structure.data.academicYearId,
          classId: structure.data.classId,
        },
      });
      await Promise.all([
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
            {copy.fees.setup.structure.billTitle}
          </ThemedText>
          <ThemedText variant="meta">
            {copy.fees.setup.structure.billBody(className ?? "")}
          </ThemedText>
          <CapsuleButton
            title={copy.fees.setup.structure.billAction}
            icon="collect"
            size="compact"
            loading={billClass.isPending}
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
}: {
  line: Line;
  headName: string;
  first: boolean;
  onPress?: () => void;
}) {
  const frequency =
    copy.fees.setup.structure.frequencies[
      line.installmentFrequency as Frequency
    ] ?? line.installmentFrequency;
  const months = monthRangeLabel(
    line.applicableFromMonth,
    line.applicableToMonth,
  );
  const detail = copy.fees.setup.structure.lineFrequency(frequency, months);

  const row = (
    <>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {headName}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {detail}
        </ThemedText>
      </View>
      <ThemedText
        variant="numeric"
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={styles.amount}
      >
        {formatMoney(line.annualAmount)}
      </ThemedText>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, first ? null : styles.divider]}>{row}</View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${headName}, ${formatMoney(line.annualAmount)}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`fee-structure-line-${line.id}`}
    >
      {row}
    </Pressable>
  );
}

function RuleRow({
  rule,
  first,
  schoolWide,
}: {
  rule: Rule;
  first: boolean;
  schoolWide: boolean;
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
      </View>
      {schoolWide ? (
        <FactChip label={copy.fees.setup.structure.schoolWide} tone="neutral" />
      ) : (
        <FactChip label={copy.fees.setup.structure.scopeThis} tone="neutral" />
      )}
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
  const [installmentMode, setInstallmentMode] = useState<
    "upfront" | "term_wise" | "monthly"
  >(structure.installmentMode as "upfront" | "term_wise" | "monthly");
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
        data: { name: name.trim(), installmentMode },
      });
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

      <ChoicePills
        label={copy.fees.setup.structures.modeLabel}
        value={installmentMode}
        options={(["term_wise", "monthly", "upfront"] as const).map(
          (value) => ({
            value,
            label: copy.fees.setup.structures.modes[value],
          }),
        )}
        onChange={setInstallmentMode}
        help={copy.fees.setup.structures.modeHelp}
        testIDPrefix="fee-structure-edit-mode"
      />

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
  line,
  organizationId,
  schoolId,
  heads,
  usedHeadIds,
  onClose,
  onDone,
}: {
  structureId: string;
  line?: Line;
  organizationId: string;
  schoolId: string;
  heads: Head[];
  usedHeadIds: Set<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = Boolean(line);
  const [feeHeadId, setFeeHeadId] = useState<string | null>(
    line?.feeHeadId ?? null,
  );
  const [annualAmount, setAnnualAmount] = useState(
    line ? toInputAmount(line.annualAmount) : "",
  );
  const [frequency, setFrequency] = useState<Frequency>(
    (line?.installmentFrequency as Frequency | undefined) ?? "inherit",
  );
  const [fromMonth, setFromMonth] = useState(
    String(line?.applicableFromMonth ?? 1),
  );
  const [toMonth, setToMonth] = useState(String(line?.applicableToMonth ?? 12));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const addLine = trpc.fees.structure.addLine.useMutation();
  const updateLine = trpc.fees.structure.updateLine.useMutation();
  const utils = trpc.useUtils();

  const pending = addLine.isPending || updateLine.isPending;
  const amount = parseMoney(annualAmount);
  const headOptions = heads
    .filter((head) => !usedHeadIds.has(head.id) || head.id === line?.feeHeadId)
    .map((head) => ({ id: head.id, label: head.name }));
  const headName =
    heads.find((head) => head.id === feeHeadId)?.name ??
    (editing ? copy.fees.setup.structure.headUnknown : null);

  const headError =
    submitted && !editing && !feeHeadId
      ? copy.fees.setup.structure.headRequired
      : undefined;
  const amountError =
    submitted && (amount === null || amount < 0n)
      ? copy.fees.setup.structure.annualAmountError
      : undefined;
  const monthError =
    submitted && Number(fromMonth) > Number(toMonth)
      ? copy.fees.setup.structure.monthError
      : undefined;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (!editing && !feeHeadId) return;
    if (amount === null || amount < 0n) return;
    if (Number(fromMonth) > Number(toMonth)) return;

    try {
      if (editing && line) {
        await updateLine.mutateAsync({
          organizationId,
          schoolId,
          id: line.id,
          data: {
            annualAmount,
            installmentFrequency: frequency,
            applicableFromMonth: Number(fromMonth),
            applicableToMonth: Number(toMonth),
          },
        });
      } else if (feeHeadId) {
        await addLine.mutateAsync({
          organizationId,
          schoolId,
          id: structureId,
          data: {
            feeHeadId,
            annualAmount,
            installmentFrequency: frequency,
            applicableFromMonth: Number(fromMonth),
            applicableToMonth: Number(toMonth),
          },
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
        onSelect={setFeeHeadId}
        error={headError}
        disabled={editing}
        testID="fee-line-head"
      />

      <FormField
        label={copy.fees.setup.structure.annualAmountLabel}
        value={annualAmount}
        onChangeText={(next) => setAnnualAmount(sanitizeAmountInput(next))}
        placeholder="45000"
        keyboardType="decimal-pad"
        error={amountError}
        maxLength={12}
        testID="fee-line-amount"
      />

      <ChoicePills
        label={copy.fees.setup.structure.frequencyLabel}
        value={frequency}
        options={FREQUENCY_ORDER.map((value) => ({
          value,
          label: copy.fees.setup.structure.frequencies[value],
        }))}
        onChange={setFrequency}
        testIDPrefix="fee-line-frequency"
      />

      <SelectField
        label={copy.fees.setup.structure.fromMonth}
        valueLabel={monthLabel(Number(fromMonth))}
        placeholder={copy.fees.setup.structure.fromMonth}
        options={MONTH_OPTIONS}
        currentId={fromMonth}
        onSelect={setFromMonth}
        testID="fee-line-from-month"
      />
      <SelectField
        label={copy.fees.setup.structure.toMonth}
        valueLabel={monthLabel(Number(toMonth))}
        placeholder={copy.fees.setup.structure.toMonth}
        options={MONTH_OPTIONS}
        currentId={toMonth}
        onSelect={setToMonth}
        error={monthError}
        testID="fee-line-to-month"
      />

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
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
