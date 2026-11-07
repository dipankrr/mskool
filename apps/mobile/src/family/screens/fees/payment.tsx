import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { isPositive, modeKey, PAYMENT_TONE } from "../../lib/fees";
import { Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import {
  FButton,
  FErrorState,
  FHeader,
  FNumber,
  FPill,
  FRow,
  FRowStack,
  FScreen,
  FSkeleton,
  FText,
} from "../../ui";
import { useFeeDocument } from "./use-fee-document";
import { useDueLabel } from "./use-due-label";

/**
 * One payment: amount, date and mode, its status (with what it means when it
 * didn't go through), what it paid, and the school's receipt to share or
 * print.
 */
export function FamilyPayment() {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const dueLabel = useDueLabel();
  const theme = useFamilyTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const payment = trpc.portalFees.payment.useQuery(
    { studentId, paymentId: id ?? "" },
    { enabled: studentId.length > 0 && !!id },
  );
  const receipt = useFeeDocument();
  const data = payment.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/family/fees"));

  const header = (
    <FHeader
      title={data ? t("receipt.title", { number: data.receiptNumber }) : ""}
      onBack={back}
      backLabel={t("receipt.back")}
    />
  );

  if (payment.isError && !data) {
    return (
      <FScreen header={header}>
        <FErrorState onRetry={() => void payment.refetch()} />
      </FScreen>
    );
  }

  return (
    <FScreen testID="family-payment" header={header}>
      <Reveal
        loading={payment.isPending}
        placeholder={
          <View style={{ gap: theme.space.sm }}>
            <FSkeleton width="55%" height={56} />
            <FSkeleton width="40%" height={14} />
          </View>
        }
      >
        {data ? (
          <View style={{ gap: theme.space.sm }}>
            <FNumber
              value={Number(data.totalAmount)}
              format={(n) => format.money(n.toFixed(2))}
              size="numberHero"
              countUp={false}
            />
            <FText variant="meta" color="muted">
              {t("paymentSub", { date: format.date(data.paymentDate, "dayMonthYear"), mode: t(`mode.${modeKey(data.paymentMode)}`) })}
            </FText>
            <View style={[styles.row, { gap: theme.space.sm }]}>
              <FPill label={t(`status.${data.status}`)} tone={PAYMENT_TONE[data.status]} />
              {isPositive(data.refundedAmount) ? (
                <FPill label={t("refunded", { amount: format.money(data.refundedAmount) })} tone="info" />
              ) : null}
            </View>
            {data.status !== "cleared" ? (
              <FText variant="body" color="muted">
                {t(`statusNote.${data.status}`)}
              </FText>
            ) : null}
          </View>
        ) : null}
      </Reveal>

      {data ? (
        <>
          <View style={{ gap: theme.space.md }}>
            <FText variant="heading">{t("receipt.paidFor")}</FText>
            <FRowStack>
              {data.allocations.map((a, index) => (
                <FRow
                  key={`${a.periodKey}-${index}`}
                  title={dueLabel(a)}
                  subtitle={
                    isPositive(a.lateFeeAmount)
                      ? t("receipt.lateFee", { amount: format.money(a.lateFeeAmount) })
                      : t("dueOn", { date: format.date(a.dueDate) })
                  }
                  value={format.money(a.amount)}
                  valueVariant="heading"
                />
              ))}
              {isPositive(data.lateFeeAmount) ? (
                <FRow title={t("receipt.lateFeeRow")} value={format.money(data.lateFeeAmount)} valueVariant="heading" />
              ) : null}
              {data.previousDues.map((d, index) => (
                <FRow
                  key={`prev-${index}`}
                  title={d.label ?? t("previousDue")}
                  subtitle={d.originAcademicYearName}
                  value={format.money(d.amount)}
                  valueVariant="heading"
                />
              ))}
            </FRowStack>
          </View>

          <View style={{ gap: theme.space.sm }}>
            <FButton
              testID="payment-share"
              label={t("receipt.share")}
              icon="share"
              block
              loading={receipt.busy}
              onPress={() => void receipt.share({ kind: "receipt", studentId, paymentId: data.id }, t("receipt.shareTitle"))}
            />
            <FButton
              testID="payment-print"
              label={t("receipt.print")}
              icon="print"
              variant="secondary"
              block
              disabled={receipt.busy}
              onPress={() => void receipt.print({ kind: "receipt", studentId, paymentId: data.id })}
            />
            {receipt.error ? (
              <FText variant="meta" color="critical" align="center">
                {t("documentFailed")}
              </FText>
            ) : null}
          </View>
        </>
      ) : null}
    </FScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
});
