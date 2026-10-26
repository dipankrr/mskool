import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormSheet } from "../../components/form-sheet";
import { Skeleton } from "../../components/skeleton";
import { StatTile } from "../../components/stat-tile";
import { ThemedText } from "../../components/themed-text";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { installmentTitle } from "../../lib/fees";
import { todayIso } from "../../lib/format";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { InstallmentRow } from "./installment-row";
import { SectionHead } from "./status";

/**
 * One month of a student's year (Step 5A). The matrix's month column, opened
 * as a sheet: the three totals, then every installment DUE in that month with
 * its own status and waiver control.
 *
 * The cell is keyed by due date, not by the period the fee is for. A
 * term-wise installment due in April belongs to April even when it covers the
 * term; the copy says "due", never "for".
 */
export function MonthSheet({
  organizationId,
  studentId,
  academicYearId,
  month,
  label,
  onClose,
  onWaive,
}: {
  organizationId: string;
  studentId: string;
  academicYearId: string;
  month: string;
  label: string;
  onClose: () => void;
  onWaive: (installment: { id: string; title: string }) => void;
}) {
  const { has } = usePermissions();
  const cell = trpc.fees.matrix.cell.useQuery({
    organizationId,
    academicYearId,
    studentId,
    month,
  });

  const installments = cell.data?.installments ?? [];
  const hasFees = installments.length > 0;
  const today = todayIso();
  const canWaive = has("fee_waiver:approve");

  return (
    <FormSheet
      title={label}
      onClose={onClose}
      testIDPrefix="fee-month"
      scroll={
        <>
          {cell.isPending && !cell.data ? (
            <View style={styles.skeletons}>
              <Skeleton height={74} />
              <Skeleton height={88} />
              <Skeleton height={88} />
            </View>
          ) : cell.isError ? (
            <ErrorCard
              cause={cell.error}
              onRetry={() => void cell.refetch()}
              testID="fee-month-error"
            />
          ) : !hasFees ? (
            <EmptyState
              icon="calendar"
              title={copy.fees.desk.monthSheetEmptyTitle}
              message={copy.fees.desk.monthEmpty}
              testID="fee-month-empty"
            />
          ) : (
            <>
              <View style={styles.tiles}>
                <StatTile
                  value={formatMoney(cell.data?.netAmount)}
                  label={copy.fees.desk.monthNetLabel}
                  tone="neutral"
                />
                <StatTile
                  value={formatMoney(cell.data?.paidAmount)}
                  label={copy.fees.desk.monthPaidLabel}
                  tone="positive"
                />
                <StatTile
                  value={formatMoney(cell.data?.balanceAmount)}
                  label={copy.fees.desk.monthBalanceLabel}
                  tone={
                    isPositiveMoney(cell.data?.balanceAmount)
                      ? "caution"
                      : "positive"
                  }
                />
              </View>

              <SectionHead
                title={copy.fees.desk.monthInstallmentsTitle}
                hint={copy.fees.desk.monthInstallments(installments.length)}
              />
              <Card padless>
                {installments.map((installment, index) => {
                  const description = installment.description?.trim()
                    ? installment.description
                    : installment.feeHeadName;
                  const title = installmentTitle({ description });
                  return (
                    <InstallmentRow
                      key={installment.id}
                      installment={{
                        id: installment.id,
                        description: title,
                        installmentNumber: 0,
                        dueDate: installment.dueDate,
                        netAmount: installment.netAmount,
                        paidAmount: installment.paidAmount,
                        balanceAmount: installment.balanceAmount,
                        paymentStatus: installment.paymentStatus,
                        lateFeeApplicable: "0.00",
                      }}
                      today={today}
                      can={has}
                      onWaive={
                        installment.paymentStatus === "unpaid"
                          ? () => onWaive({ id: installment.id, title })
                          : undefined
                      }
                      first={index === 0}
                    />
                  );
                })}
              </Card>
              {canWaive ? (
                <ThemedText variant="meta" style={styles.note}>
                  {copy.fees.desk.waiveOnlyUnpaid}
                </ThemedText>
              ) : null}
            </>
          )}
        </>
      }
      footer={
        <CapsuleButton
          title={copy.fees.desk.closeAction}
          variant="secondary"
          size="compact"
          onPress={onClose}
          testID="fee-month-close"
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  skeletons: {
    gap: spacing.md,
  },
  tiles: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  note: {
    marginTop: spacing.md,
  },
});
