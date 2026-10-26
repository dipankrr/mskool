import { useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { INSTALLMENT_MODE_LABEL } from "../../lib/fees";
import { formatReadableDate } from "../../lib/format";
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

export type DeskStructure = {
  id: string;
  name: string;
  installmentMode: string;
};

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
// Assignment
// ---------------------------------------------------------------------------

export function AssignSheet({
  organizationId,
  schoolId,
  enrollmentId,
  className,
  structure,
  effectiveFrom,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  enrollmentId: string | null;
  className: string | null;
  structure: DeskStructure | null;
  effectiveFrom: string | null;
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const [fullCharge, setFullCharge] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const utils = trpc.useUtils();
  const assign = trpc.fees.assignment.assign.useMutation();

  const confirm = async () => {
    if (!enrollmentId) return;
    setError(null);
    try {
      await assign.mutateAsync({
        organizationId,
        schoolId,
        data: { enrollmentId, joiningMonthFullCharge: fullCharge },
      });
      await Promise.all([
        utils.fees.assignment.byStudent.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
      ]);
      onDone(copy.fees.desk.assignDone);
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

  if (!structure) {
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
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {copy.fees.desk.assignStructureSummary(
            structure.name,
            INSTALLMENT_MODE_LABEL[structure.installmentMode] ??
              structure.installmentMode,
          )}
        </ThemedText>
        {effectiveFrom ? (
          <ThemedText variant="meta">
            {copy.fees.desk.assignmentEffective(
              formatReadableDate(effectiveFrom),
            )}
          </ThemedText>
        ) : null}
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
// Generator and concessions
// ---------------------------------------------------------------------------

export function GenerateSheet({
  organizationId,
  schoolId,
  assignmentId,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  assignmentId: string;
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const [error, setError] = useState<unknown>(null);
  const utils = trpc.useUtils();
  const generate = trpc.fees.assignment.generateInstallments.useMutation();

  const confirm = async () => {
    setError(null);
    try {
      const result = await generate.mutateAsync({
        organizationId,
        schoolId,
        id: assignmentId,
      });
      await Promise.all([
        utils.fees.assignment.byStudent.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
      ]);
      onDone(
        result.inserted > 0
          ? copy.fees.desk.generateDone(result.inserted)
          : copy.fees.desk.generateUpToDate,
      );
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <ConfirmSheet
      title={copy.fees.desk.generateTitle}
      body={copy.fees.desk.generateBody}
      confirmLabel={copy.fees.desk.generateConfirm}
      busyLabel={copy.fees.desk.generating}
      busy={generate.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
      testIDPrefix="fees-generate"
    />
  );
}

export function RecomputeSheet({
  organizationId,
  schoolId,
  assignmentId,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  assignmentId: string;
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const [error, setError] = useState<unknown>(null);
  const utils = trpc.useUtils();
  const recompute = trpc.fees.assignment.recomputeConcessions.useMutation();

  const confirm = async () => {
    setError(null);
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
      onDone(copy.fees.desk.recomputeDone);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <ConfirmSheet
      title={copy.fees.desk.recomputeTitle}
      body={copy.fees.desk.recomputeBody}
      confirmLabel={copy.fees.desk.recomputeConfirm}
      busyLabel={copy.fees.desk.recomputing}
      busy={recompute.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
      testIDPrefix="fees-recompute"
    />
  );
}

// ---------------------------------------------------------------------------
// Waiver
// ---------------------------------------------------------------------------

export function WaiveSheet({
  organizationId,
  schoolId,
  installment,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  installment: { id: string; title: string };
  onClose: () => void;
  onDone: DoneHandler;
}) {
  const [error, setError] = useState<unknown>(null);
  const utils = trpc.useUtils();
  const waive = trpc.fees.installment.waive.useMutation();

  const confirm = async () => {
    setError(null);
    try {
      await waive.mutateAsync({ organizationId, schoolId, id: installment.id });
      await Promise.all([
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
      ]);
      onDone(copy.fees.desk.waiverDone);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <ConfirmSheet
      title={copy.fees.desk.waiveTitle}
      body={copy.fees.desk.waiveBody(installment.title)}
      confirmLabel={copy.fees.desk.waiveConfirm}
      busyLabel={copy.fees.desk.waiving}
      destructive
      busy={waive.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
      testIDPrefix="fees-waive"
    >
      <ThemedText variant="meta">{copy.fees.desk.waiveOnlyUnpaid}</ThemedText>
    </ConfirmSheet>
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
});
