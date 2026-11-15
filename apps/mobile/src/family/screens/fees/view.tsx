import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { parseMoney, toMoneyString } from "../../../lib/money";
import { useFormat } from "../../i18n/format";
import { concessionKey, isPositive, modeKey, nextUp, PAYMENT_TONE, splitDues } from "../../lib/fees";
import type { FeeSummary, PaymentStatus } from "../../lib/fees";
import { Enter } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FButton, FRow, FRowStack, FText } from "../../ui";
import { SectionHead } from "../home/parts";
import { DueRow } from "./due-row";
import { FeesHero } from "./hero";
import { FeesYear } from "./year";

/** Payments shown before "Show all". */
const MAX_PAYMENTS = 3;

const PAYMENT_ICON: Record<PaymentStatus, AppIconName> = {
  cleared: "check",
  pending: "clock",
  bounced: "warning",
  reversed: "refund",
  cancelled: "close",
};

export type StatementAction = { busy: boolean; error: boolean; share: () => void };

/**
 * Family Fees, top to bottom: what to pay now, the session at a glance,
 * the dues that make up "now", the next month, concessions, payments (tap
 * for the receipt) and the statement PDF. Read-only: fees are paid at the
 * school. Takes its data as a prop so the dev preview can show every state.
 */
export function FeesView({
  data,
  today,
  onPayment,
  statement,
}: {
  data: FeeSummary;
  today: string;
  onPayment: (paymentId: string) => void;
  statement: StatementAction;
}) {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const theme = useFamilyTheme();
  const [month, setMonth] = useState<string | null>(null);
  const [allPayments, setAllPayments] = useState(false);

  const { now, later } = splitDues(data.dues, today);
  const previous = data.previousDues.filter((d) => isPositive(d.balance));
  const next = nextUp(later);
  const afterNext = next ? (parseMoney(data.totals.later) ?? 0n) - (parseMoney(next.amount) ?? 0n) : 0n;
  const payments = allPayments ? data.payments : data.payments.slice(0, MAX_PAYMENTS);

  return (
    <>
      <FeesHero data={data} today={today} replayKey={data.student.id} />

      {now.length > 0 || previous.length > 0 ? (
        <View testID="fees-to-pay" style={{ gap: theme.space.md }}>
          <SectionHead title={t("toPay.title")} aside={format.money(data.totals.dueNow)} />
          <FRowStack>
            {previous.map((d) => (
              <FRow
                key={d.id}
                title={d.label ?? t("previousDue")}
                subtitle={t("previousDues")}
                subtitleTone="critical"
                value={format.money(d.balance)}
                valueVariant="heading"
              />
            ))}
            {now.map((due, index) => (
              <Enter key={due.id} index={index}>
                <DueRow due={due} today={today} />
              </Enter>
            ))}
          </FRowStack>
          <FText variant="meta" color="faint">
            {t("toPay.note")}
          </FText>
        </View>
      ) : null}

      {data.months.length > 0 ? <FeesYear data={data} today={today} selected={month} onSelect={setMonth} /> : null}

      {next ? (
        <View testID="fees-coming-up" style={{ gap: theme.space.md }}>
          <SectionHead title={t("comingUp.title")} />
          <FRowStack>
            <FRow
              title={format.month(next.month, "long")}
              subtitle={t("comingUp.sub", { count: next.count, date: format.date(next.date) })}
              value={format.money(next.amount)}
              valueVariant="heading"
            />
          </FRowStack>
          {afterNext > 0n ? (
            <FText variant="meta" color="faint">
              {t("comingUp.more", { amount: format.money(toMoneyString(afterNext)) })}
            </FText>
          ) : null}
        </View>
      ) : null}

      {data.concessions.length > 0 ? (
        <View style={{ gap: theme.space.md }}>
          <SectionHead title={t("concessions")} />
          <FRowStack>
            {data.concessions.map((c, index) => (
              <FRow
                key={`${c.concessionType}-${index}`}
                title={t(`concessionType.${concessionKey(c.concessionType)}`)}
                value={format.money(c.amount)}
                valueVariant="heading"
                valueColor="positive"
              />
            ))}
          </FRowStack>
        </View>
      ) : null}

      <View testID="fees-payments" style={{ gap: theme.space.md }}>
        <SectionHead title={t("payments")} />
        {data.payments.length === 0 ? (
          <FText variant="body" color="muted">
            {t("paymentsNone")}
          </FText>
        ) : (
          <FRowStack>
            {payments.map((p) => {
              const mode = t(`mode.${modeKey(p.paymentMode)}`);
              return (
                <FRow
                  key={p.id}
                  testID={`fees-payment-${p.id}`}
                  leading={<PaymentMark status={p.status} />}
                  title={format.date(p.paymentDate, "dayMonthYear")}
                  subtitle={
                    p.status === "cleared"
                      ? t("paymentRow.sub", { mode, receipt: p.receiptNumber })
                      : t("paymentRow.subStatus", { mode, receipt: p.receiptNumber, status: t(`status.${p.status}`) })
                  }
                  subtitleTone={p.status === "cleared" ? undefined : PAYMENT_TONE[p.status]}
                  value={format.money(p.totalAmount)}
                  valueVariant="heading"
                  onPress={() => onPayment(p.id)}
                />
              );
            })}
          </FRowStack>
        )}
        {!allPayments && data.payments.length > MAX_PAYMENTS ? (
          <FButton
            testID="fees-payments-all"
            label={t("paymentRow.all", { count: data.payments.length })}
            variant="quiet"
            size="sm"
            onPress={() => setAllPayments(true)}
            style={styles.start}
          />
        ) : null}
      </View>

      <View style={{ gap: theme.space.sm }}>
        <FButton
          testID="fees-statement"
          label={t("statement")}
          icon="receipt"
          variant="secondary"
          block
          loading={statement.busy}
          onPress={statement.share}
        />
        {statement.error ? (
          <FText variant="meta" color="critical" align="center">
            {t("documentFailed")}
          </FText>
        ) : null}
      </View>
    </>
  );
}

function PaymentMark({ status }: { status: PaymentStatus }) {
  const theme = useFamilyTheme();
  const k = theme.components.fees.payment;
  const colors = k.tone[PAYMENT_TONE[status]];
  return (
    <View style={[styles.center, { width: k.size, height: k.size, borderRadius: k.size / 2, backgroundColor: colors.bg }]}>
      <AppIcon name={PAYMENT_ICON[status]} size={20} color={colors.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  start: { alignSelf: "flex-start" },
});
