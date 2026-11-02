import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  isHeldMode,
  nextClientReference,
  PAYMENT_MODES,
  paymentModeLabel,
  referenceFields,
  type PaymentMode,
} from "../../lib/fees";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate } from "../../lib/format";
import {
  formatMoney,
  isPositiveMoney,
  parseMoney,
  sanitizeAmountInput,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";

/**
 * The desk's management sheets (Step 5A).
 *
 * Each sheet owns its mutation and invalidates the reads it changes, so the
 * desk never has to know which query fed which number. The parent unmounts a
 * sheet on close (the FormSheet rule): a fresh mount re-reads the current
 * assignment, never a stale copy from the previous open.
 *
 * Every sheet states the consequence before the act. None of them is
 * optimistic: the success notice is set only after the server answers.
 */

type DoneHandler = (message: string) => void;

/** The shared confirmation anatomy: what will happen, then one clear act. */
function ConfirmSheet({
  title,
  body,
  confirmLabel,
  busyLabel,
  destructive = false,
  busy,
  error,
  onConfirm,
  onClose,
  testIDPrefix,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel: string;
  destructive?: boolean;
  busy: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
  testIDPrefix: string;
  children?: ReactNode;
}) {
  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix={testIDPrefix}
      scroll={
        <>
          <Notice tone={destructive ? "critical" : "caution"} message={body} />
          {children}
          {error ? (
            <Notice
              tone="critical"
              message={toFriendlyError(error).message}
              testID={`${testIDPrefix}-error`}
            />
          ) : null}
        </>
      }
      footer={
        <View style={styles.footerRow}>
          <CapsuleButton
            title={copy.common.cancel}
            variant="secondary"
            size="compact"
            onPress={onClose}
            testID={`${testIDPrefix}-cancel-action`}
          />
          <CapsuleButton
            title={busy ? busyLabel : confirmLabel}
            variant={destructive ? "destructive" : "primary"}
            size="compact"
            loading={busy}
            onPress={onConfirm}
            testID={`${testIDPrefix}-confirm`}
          />
        </View>
      }
    />
  );
}

function InfoSheet({
  title,
  message,
  onClose,
  testIDPrefix,
}: {
  title: string;
  message: string;
  onClose: () => void;
  testIDPrefix: string;
}) {
  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix={testIDPrefix}
      scroll={<Notice tone="caution" message={message} />}
      footer={
        <CapsuleButton
          title={copy.fees.desk.closeAction}
          variant="secondary"
          size="compact"
          onPress={onClose}
          testID={`${testIDPrefix}-close`}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Billing one student
// ---------------------------------------------------------------------------

/** Every read a fee write can change, in one place. */
function useFeeRefresh() {
  const utils = trpc.useUtils();
  return () =>
    Promise.all([
      utils.fees.dashboard.invalidate(),
      utils.fees.assignment.byStudent.invalidate(),
      utils.fees.installment.dues.invalidate(),
      utils.fees.matrix.list.invalidate(),
      utils.fees.matrix.cell.invalidate(),
    ]);
}

export function AssignSheet({
  organizationId,
  schoolId,
  enrollmentId,
  className,
  choices,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  enrollmentId: string | null;
  className: string | null;
  choices: { id: string; name: string }[];
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const [fullCharge, setFullCharge] = useState(true);
  const [structureId, setStructureId] = useState(choices[0]?.id ?? "");
  const [error, setError] = useState<unknown>(null);
  const refresh = useFeeRefresh();
  const assign = trpc.fees.assignment.assign.useMutation();

  const confirm = async () => {
    if (!enrollmentId) return;
    setError(null);
    try {
      const result = await assign.mutateAsync({
        organizationId,
        schoolId,
        data: {
          enrollmentId,
          joiningMonthFullCharge: fullCharge,
          ...(choices.length > 1 ? { feeStructureId: structureId } : {}),
        },
      });
      await refresh();
      onDone(copy.fees.desk.assignDone(result.installmentsCreated));
    } catch (cause) {
      setError(cause);
    }
  };

  if (!enrollmentId) {
    return (
      <InfoSheet
        title={copy.fees.desk.assignSheetTitle}
        message={copy.fees.desk.assignNoEnrollment}
        onClose={onClose}
        testIDPrefix="fees-assign"
      />
    );
  }

  if (choices.length === 0) {
    return (
      <InfoSheet
        title={copy.fees.desk.assignNoStructureTitle}
        message={copy.fees.desk.assignNoStructureBody}
        onClose={onClose}
        testIDPrefix="fees-assign"
      />
    );
  }

  return (
    <ConfirmSheet
      title={copy.fees.desk.assignSheetTitle}
      body={copy.fees.desk.assignSheetBody(className ?? "this class")}
      confirmLabel={copy.fees.desk.assignConfirm}
      busyLabel={copy.fees.desk.assigning}
      busy={assign.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
      testIDPrefix="fees-assign"
    >
      <View style={styles.summary}>
        {choices.length > 1 ? (
          <ChoicePills
            label={feesCopy.student.whichStructure}
            value={structureId}
            options={choices.map((choice) => ({ value: choice.id, label: choice.name }))}
            onChange={setStructureId}
            testIDPrefix="fees-assign-structure"
          />
        ) : (
          <ThemedText variant="bodyStrong" numberOfLines={2}>
            {choices[0]?.name}
          </ThemedText>
        )}
      </View>
      <SwitchRow
        label={copy.fees.desk.joiningFullCharge}
        value={fullCharge}
        onChange={setFullCharge}
        help={copy.fees.desk.joiningFullChargeHelp}
        testID="fees-assign-full-charge"
      />
    </ConfirmSheet>
  );
}

// ---------------------------------------------------------------------------
// One due: waive it, or cancel it if it was created by mistake
// ---------------------------------------------------------------------------

export function DueSheet({
  organizationId,
  schoolId,
  due,
  canManage,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  due: { id: string; title: string; net: string; paid: string; dueDate: string; status: string };
  canManage: boolean;
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const { has } = usePermissions();
  const [action, setAction] = useState<"waive" | "cancel" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = useFeeRefresh();
  const waive = trpc.fees.installment.waive.useMutation();
  const cancel = trpc.fees.installment.cancel.useMutation();
  const words = feesCopy.student;

  const neverPaid = due.status === "unpaid" && !isPositiveMoney(due.paid);
  const canWaive = neverPaid && has("fee_waiver:approve");
  const canCancel = neverPaid && canManage;

  const confirm = async () => {
    setError(null);
    try {
      if (action === "waive") {
        await waive.mutateAsync({ organizationId, schoolId, id: due.id });
        await refresh();
        onDone(copy.fees.desk.waiverDone);
      } else if (action === "cancel") {
        await cancel.mutateAsync({ organizationId, schoolId, id: due.id });
        await refresh();
        onDone(words.cancelDone);
      }
    } catch (cause) {
      setError(cause);
    }
  };

  if (action) {
    return (
      <ConfirmSheet
        title={action === "waive" ? copy.fees.desk.waiveTitle : words.cancelTitle}
        body={
          action === "waive"
            ? copy.fees.desk.waiveBody(due.title)
            : words.cancelBody(due.title)
        }
        confirmLabel={action === "waive" ? copy.fees.desk.waiveConfirm : words.cancelConfirm}
        busyLabel={action === "waive" ? copy.fees.desk.waiving : words.cancelling}
        destructive
        busy={waive.isPending || cancel.isPending}
        error={error}
        onConfirm={() => void confirm()}
        onClose={onClose}
        testIDPrefix="fees-due-action"
      />
    );
  }

  return (
    <FormSheet
      title={due.title}
      onClose={onClose}
      testIDPrefix="fees-due"
      scroll={
        <View style={styles.summary}>
          {due.dueDate ? (
            <ThemedText variant="meta">
              {copy.fees.desk.paidOf(formatMoney(due.paid), formatMoney(due.net))}
              {" · "}
              {words.dueOn(formatReadableDate(due.dueDate))}
            </ThemedText>
          ) : null}
          {!canWaive && !canCancel ? (
            <ThemedText variant="meta">{copy.fees.desk.waiveOnlyUnpaid}</ThemedText>
          ) : null}
        </View>
      }
      footer={
        <View style={styles.footerRow}>
          {canCancel ? (
            <CapsuleButton
              title={words.cancelDueAction}
              variant="secondary"
              size="compact"
              onPress={() => setAction("cancel")}
              testID="fees-due-cancel"
            />
          ) : null}
          {canWaive ? (
            <CapsuleButton
              title={copy.fees.desk.waiverAction}
              variant="secondary"
              size="compact"
              onPress={() => setAction("waive")}
              testID="fees-due-waive"
            />
          ) : null}
        </View>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// A one-off charge: a dress, a notebook, a damage fine
// ---------------------------------------------------------------------------

export function OneOffSheet({
  organizationId,
  schoolId,
  studentId,
  academicYearId,
  studentName,
  className,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  studentId: string;
  academicYearId: string;
  studentName: string;
  className: string;
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const words = feesCopy.student;
  const { has } = usePermissions();
  const canPay = has("fee_payment:create");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidNow, setPaidNow] = useState(false);
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One key for this sheet, so a retry after a lost reply finds the first payment.
  const clientReference = useRef(nextClientReference()).current;
  const refresh = useFeeRefresh();
  const utils = trpc.useUtils();
  const add = trpc.fees.installment.addOneOff.useMutation();

  const fields = referenceFields(mode);
  const parsed = parseMoney(amount);
  const descriptionError = submitted && !description.trim() ? words.oneOffNeedsWhat : undefined;
  const amountError =
    submitted && (parsed === null || parsed <= 0n) ? words.oneOffNeedsAmount : undefined;
  const needsReference = paidNow && fields.reference && !reference.trim();
  const needsBank = paidNow && fields.bank && !bankName.trim();

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (!description.trim() || parsed === null || parsed <= 0n) return;
    if (needsReference || needsBank) return;
    try {
      const result = await add.mutateAsync({
        organizationId,
        schoolId,
        data: {
          studentId,
          academicYearId,
          description: description.trim(),
          amount,
          ...(paidNow
            ? {
                paid: {
                  paymentMode: mode,
                  transactionReference: fields.reference ? reference.trim() : null,
                  bankName: fields.bank ? bankName.trim() : null,
                  chequeDate: fields.chequeDate ? chequeDate : null,
                  clientReference,
                },
              }
            : {}),
        },
      });
      await Promise.all([refresh(), utils.fees.payment.list.invalidate()]);
      onDone(words.oneOffDone(formatMoney(amount)));
      if (result.payment) {
        router.push({
          pathname: "/fees/receipt/[paymentId]",
          params: {
            paymentId: result.payment.id,
            studentId,
            studentName,
            className,
          },
        });
      }
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={words.oneOffAction}
      onClose={onClose}
      testIDPrefix="fees-one-off"
      scroll={
        <View style={styles.form}>
          <FormField
            label={words.oneOffWhat}
            value={description}
            onChangeText={setDescription}
            placeholder={words.oneOffWhatPlaceholder}
            error={descriptionError}
            maxLength={150}
            testID="fees-one-off-what"
          />
          <FormField
            label={words.oneOffAmount}
            value={amount}
            onChangeText={(next) => setAmount(sanitizeAmountInput(next))}
            placeholder="500"
            keyboardType="decimal-pad"
            error={amountError}
            maxLength={11}
            testID="fees-one-off-amount"
          />
          {canPay ? (
            <SwitchRow
              label={words.oneOffPaid}
              value={paidNow}
              onChange={setPaidNow}
              help={words.oneOffPaidHelp}
              testID="fees-one-off-paid"
            />
          ) : null}
          {paidNow ? (
            <>
              <ChoicePills
                label={copy.fees.collect.modeLabel}
                value={mode}
                options={PAYMENT_MODES.map((option) => ({
                  value: option,
                  label: paymentModeLabel(option),
                }))}
                onChange={setMode}
                testIDPrefix="fees-one-off-mode"
              />
              {isHeldMode(mode) ? (
                <Notice
                  tone="neutral"
                  message={copy.fees.collect.modeHint}
                  testID="fees-one-off-held"
                />
              ) : null}
              {fields.reference ? (
                <FormField
                  label={copy.fees.collect.referenceLabel}
                  value={reference}
                  onChangeText={setReference}
                  placeholder={fields.placeholder}
                  help={fields.hint ?? undefined}
                  error={submitted && needsReference ? words.oneOffNeedsReference : undefined}
                  autoCapitalize="characters"
                  maxLength={150}
                  testID="fees-one-off-reference"
                />
              ) : null}
              {fields.bank ? (
                <FormField
                  label={copy.fees.collect.bankLabel}
                  value={bankName}
                  onChangeText={setBankName}
                  error={submitted && needsBank ? words.oneOffNeedsBank : undefined}
                  maxLength={100}
                  testID="fees-one-off-bank"
                />
              ) : null}
              {fields.chequeDate ? (
                <DateField
                  label={copy.fees.collect.chequeDateLabel}
                  value={chequeDate}
                  onChange={setChequeDate}
                  testID="fees-one-off-cheque-date"
                />
              ) : null}
            </>
          ) : null}
          {error ? (
            <Notice tone="critical" message={toFriendlyError(error).message} testID="fees-one-off-error" />
          ) : null}
        </View>
      }
      footer={
        <View style={styles.footerRow}>
          <CapsuleButton
            title={paidNow ? words.oneOffPaidSave : words.oneOffSave}
            icon="check"
            size="compact"
            loading={add.isPending}
            onPress={() => void submit()}
            testID="fees-one-off-save"
          />
        </View>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Suspending a student's billing, and withdrawing a concession
// ---------------------------------------------------------------------------

export function StatusSheet({
  organizationId,
  schoolId,
  assignmentId,
  next,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  assignmentId: string;
  next: "active" | "suspended";
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const words = feesCopy.student;
  const [error, setError] = useState<unknown>(null);
  const refresh = useFeeRefresh();
  const setStatus = trpc.fees.assignment.setStatus.useMutation();

  const confirm = async () => {
    setError(null);
    try {
      await setStatus.mutateAsync({ organizationId, schoolId, id: assignmentId, status: next });
      await refresh();
      onDone(next === "active" ? words.restoreDone : words.suspendDone);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <ConfirmSheet
      title={next === "active" ? words.restoreAction : words.suspendAction}
      body={next === "active" ? words.restoreBody : words.suspendBody}
      confirmLabel={next === "active" ? words.restoreAction : words.suspendAction}
      busyLabel={words.saving}
      busy={setStatus.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
      testIDPrefix="fees-status"
    />
  );
}

export function VoidConcessionSheet({
  organizationId,
  schoolId,
  concessionId,
  label,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  concessionId: string;
  label: string;
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const words = feesCopy.student;
  const [error, setError] = useState<unknown>(null);
  const refresh = useFeeRefresh();
  const voidIt = trpc.fees.assignment.voidConcession.useMutation();

  const confirm = async () => {
    setError(null);
    try {
      await voidIt.mutateAsync({
        organizationId,
        schoolId,
        id: concessionId,
        data: { reason: "Withdrawn by staff" },
      });
      await refresh();
      onDone(words.voidDone);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <ConfirmSheet
      title={words.voidTitle}
      body={words.voidBody(label)}
      confirmLabel={words.voidConfirm}
      busyLabel={words.saving}
      destructive
      busy={voidIt.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
      testIDPrefix="fees-void"
    />
  );
}

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  summary: {
    marginTop: spacing.lg,
    gap: spacing.xxs,
  },
  form: {
    gap: spacing.md,
  },
});
