import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  CONCESSION_CALCULATIONS,
  CONCESSION_CALCULATION_LABEL,
  CONCESSION_TYPES,
  CONCESSION_TYPE_LABEL,
  concessionValueError,
} from "../../lib/fees";
import type { ConcessionCalculation, ConcessionType } from "../../lib/fees";
import {
  formatMoney,
  parseMoney,
  toMoneyString,
  sanitizeAmountInput,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";

type Duration = "session" | "dated";

const DURATION_OPTIONS = [
  {
    value: "session" as const,
    label: copy.fees.desk.concessionDurationSession,
  },
  {
    value: "dated" as const,
    label: copy.fees.desk.concessionDurationDated,
  },
];

/**
 * Record a concession against one student's assignment (Step 5A).
 *
 * The server computes the audit amount from the base it applies to, so this
 * sheet never sends an amount. It sends the rule — type, calculation, value,
 * head and validity window — and then re-apportions the never-paid
 * installments so the bill on the desk matches the concession just recorded.
 *
 * The window is the subtle part: a concession only reaches an installment
 * whose due date falls inside it. "Whole session" therefore starts at the
 * session's first day, not today, or a mid-year entry would silently skip the
 * installments already raised this year.
 */
export function ConcessionSheet({
  organizationId,
  schoolId,
  assignmentId,
  academicYearStart,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  assignmentId: string;
  academicYearStart: string;
  onClose: () => void;
  onDone: (message: string, tone?: "positive" | "caution") => void;
}) {
  const [type, setType] = useState<ConcessionType>("sibling_discount");
  const [calculation, setCalculation] = useState<ConcessionCalculation>("flat");
  const [headId, setHeadId] = useState("");
  const [value, setValue] = useState("");
  const [validFrom, setValidFrom] = useState(academicYearStart);
  const [duration, setDuration] = useState<Duration>("session");
  const [validTo, setValidTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const utils = trpc.useUtils();
  const heads = trpc.fees.head.list.useQuery(
    { organizationId },
    { staleTime: 5 * 60_000 },
  );
  const add = trpc.fees.assignment.addConcession.useMutation();
  const recompute = trpc.fees.assignment.recomputeConcessions.useMutation();

  const valueError = submitted
    ? (concessionValueError(calculation, value) ?? undefined)
    : undefined;
  const reasonError =
    submitted && reason.trim().length === 0
      ? copy.fees.desk.concessionNeedsReason
      : undefined;
  const endError =
    submitted && duration === "dated" && !validTo
      ? copy.fees.desk.concessionNeedsEnd
      : undefined;
  const hasErrors = Boolean(valueError || reasonError || endError);

  const headOptions = [
    { id: "", label: copy.fees.desk.concessionAllHeads },
    ...(heads.data ?? []).map((head) => ({
      id: head.id,
      label: head.name,
    })),
  ];
  const headLabel =
    headId.length === 0
      ? copy.fees.desk.concessionAllHeads
      : (heads.data?.find((head) => head.id === headId)?.name ?? null);

  const busy = add.isPending || recompute.isPending;

  const submit = async () => {
    setSubmitted(true);
    setError(null);

    // Validate from the values in hand, not from the render that is one step
    // behind this handler — the first tap must not slip past an empty field.
    const nextValueError = concessionValueError(calculation, value);
    const nextReasonError =
      reason.trim().length === 0 ? copy.fees.desk.concessionNeedsReason : null;
    const nextEndError =
      duration === "dated" && !validTo
        ? copy.fees.desk.concessionNeedsEnd
        : null;
    if (nextValueError || nextReasonError || nextEndError) return;

    const amount = parseMoney(value);
    if (amount === null || amount <= 0n) return;

    try {
      const created = await add.mutateAsync({
        organizationId,
        schoolId,
        id: assignmentId,
        data: {
          feeHeadId: headId.length > 0 ? headId : null,
          concessionType: type,
          calculationType: calculation,
          value: toMoneyString(amount),
          reason: reason.trim(),
          validFrom,
          validTo: duration === "dated" ? validTo : null,
        },
      });

      await Promise.all([
        utils.fees.assignment.byStudent.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
      ]);

      const recorded = formatMoney(created.concessionAmount);
      try {
        await recompute.mutateAsync({
          organizationId,
          schoolId,
          id: assignmentId,
        });
        await Promise.all([
          utils.fees.assignment.byStudent.invalidate(),
          utils.fees.installment.dues.invalidate(),
          utils.fees.matrix.list.invalidate(),
          utils.fees.matrix.cell.invalidate(),
        ]);
        onDone(copy.fees.desk.concessionDone(recorded));
      } catch {
        // The concession is recorded; only its apportionment failed. Saying
        // "failed" would send the clerk to record it twice.
        onDone(
          copy.fees.desk.concessionRecordedNeedsRecompute(recorded),
          "caution",
        );
      }
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={copy.fees.desk.concessionTitle}
      onClose={onClose}
      testIDPrefix="fee-concession"
      scroll={
        <>
          <Notice
            tone="neutral"
            message={copy.fees.desk.concessionIntro}
            testID="fee-concession-intro"
          />

          <SelectField
            label={copy.fees.desk.concessionTypeLabel}
            valueLabel={CONCESSION_TYPE_LABEL[type]}
            placeholder={copy.fees.desk.concessionTypeLabel}
            options={CONCESSION_TYPES.map((option) => ({
              id: option,
              label: CONCESSION_TYPE_LABEL[option],
            }))}
            currentId={type}
            onSelect={(id) => setType(id as ConcessionType)}
            testID="fee-concession-type"
          />

          <ChoicePills
            label={copy.fees.desk.concessionCalculationLabel}
            value={calculation}
            options={CONCESSION_CALCULATIONS.map((option) => ({
              value: option,
              label: CONCESSION_CALCULATION_LABEL[option],
            }))}
            onChange={setCalculation}
            testIDPrefix="fee-concession-calculation"
          />

          <SelectField
            label={copy.fees.desk.concessionHeadLabel}
            valueLabel={headLabel}
            placeholder={copy.fees.desk.concessionAllHeads}
            options={headOptions}
            currentId={headId}
            onSelect={setHeadId}
            help={copy.fees.desk.concessionHeadHelp}
            disabled={heads.isPending}
            testID="fee-concession-head"
          />

          <FormField
            label={copy.fees.desk.concessionValueLabel}
            value={value}
            onChangeText={(next) => setValue(sanitizeAmountInput(next))}
            keyboardType="decimal-pad"
            suffix={calculation === "flat" ? "₹" : "%"}
            help={
              calculation === "flat"
                ? copy.fees.desk.concessionValueFlatHelp
                : copy.fees.desk.concessionValuePercentHelp
            }
            error={valueError}
            maxLength={12}
            testID="fee-concession-value"
          />

          <DateField
            label={copy.fees.desk.concessionFromLabel}
            value={validFrom}
            onChange={setValidFrom}
            help={copy.fees.desk.concessionFromHelp}
            maximumDate={
              duration === "dated" ? (validTo ?? undefined) : undefined
            }
            testID="fee-concession-from"
          />

          <ChoicePills
            label={copy.fees.desk.concessionDurationLabel}
            value={duration}
            options={DURATION_OPTIONS}
            onChange={setDuration}
            testIDPrefix="fee-concession-duration"
          />

          {duration === "dated" ? (
            <DateField
              label={copy.fees.desk.concessionToLabel}
              value={validTo}
              onChange={setValidTo}
              help={copy.fees.desk.concessionEndHelp}
              minimumDate={validFrom}
              error={endError}
              testID="fee-concession-to"
            />
          ) : null}

          <FormField
            label={copy.fees.desk.concessionReasonLabel}
            value={reason}
            onChangeText={setReason}
            placeholder={copy.fees.desk.concessionReasonPlaceholder}
            multiline
            numberOfLines={3}
            error={reasonError}
            maxLength={500}
            testID="fee-concession-reason"
          />

          {error ? (
            <Notice
              tone="critical"
              message={toFriendlyError(error).message}
              testID="fee-concession-error"
            />
          ) : null}
        </>
      }
      footer={
        <>
          {submitted && hasErrors ? (
            <Notice tone="critical" message={copy.forms.invalidSummary} />
          ) : null}
          <View style={styles.footerRow}>
            <CapsuleButton
              title={copy.common.cancel}
              variant="secondary"
              size="compact"
              onPress={onClose}
              testID="fee-concession-cancel-action"
            />
            <CapsuleButton
              title={
                busy
                  ? copy.fees.desk.concessionSaving
                  : copy.fees.desk.concessionSubmit
              }
              variant="primary"
              size="compact"
              loading={busy}
              onPress={() => void submit()}
              testID="fee-concession-submit"
            />
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
