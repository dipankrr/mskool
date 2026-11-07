import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { todayIso } from "../../../lib/format";
import { parseMoney } from "../../../lib/money";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import {
  concessionKey,
  duesInMonth,
  isOverdue,
  isPositive,
  modeKey,
  MONTH_TONE,
  monthOf,
  openDues,
  PAYMENT_TONE,
} from "../../lib/fees";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import {
  FButton,
  FCard,
  FEmptyState,
  FErrorState,
  FMascot,
  FNumber,
  FOfflineNote,
  FRow,
  FRowStack,
  FScreen,
  FSkeleton,
  FText,
  useFamilyTabBarSpace,
} from "../../ui";
import { FamilyTabHeader } from "../tab-header";
import { useFeeDocument } from "./use-fee-document";
import { useDueLabel } from "./use-due-label";

/**
 * Family Fees: the same figures as the admin student fee page, read-only and
 * in the family look (owner F1 to F4). What's due now, the months strip (tap
 * a month to see its dues), what to pay, earlier sessions' dues,
 * concessions, payments (tap for the receipt), and the statement PDF.
 */
export function FamilyFees() {
  const { t } = useTranslation("fees");
  const { t: tf } = useTranslation("family");
  const format = useFormat();
  const dueLabel = useDueLabel();
  const theme = useFamilyTheme();
  const space = useFamilyTabBarSpace();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const [month, setMonth] = useState<{ studentId: string; key: string } | null>(null);
  const selected = month?.studentId === studentId ? month.key : null;
  const today = todayIso();

  const summary = trpc.portalFees.summary.useQuery({ studentId }, { enabled: studentId.length > 0 });
  const statement = useFeeDocument();
  const data = summary.data;
  const header = <FamilyTabHeader title={tf("tabs.fees")} />;

  if (summary.isError && !data) {
    return (
      <FScreen bottomSpace={space} header={header}>
        <FErrorState onRetry={() => void summary.refetch()} />
      </FScreen>
    );
  }

  if (data && !data.feeAssigned) {
    return (
      <FScreen bottomSpace={space} header={header} onRefresh={() => void summary.refetch()} refreshing={summary.isRefetching}>
        <FEmptyState title={t("notSet.title")} body={t("notSet.body")} />
      </FScreen>
    );
  }

  const dueNow = data ? (parseMoney(data.totals.dueNow) ?? 0n) : 0n;
  const listed = data ? (selected ? duesInMonth(data.dues, selected) : openDues(data.dues)) : [];
  const previous = data ? data.previousDues.filter((d) => isPositive(d.balance)) : [];

  return (
    <FScreen
      testID="family-fees"
      bottomSpace={space}
      header={header}
      refreshing={summary.isRefetching}
      onRefresh={() => void summary.refetch()}
    >
      {summary.isError && data ? <FOfflineNote /> : null}

      <Reveal
        loading={summary.isPending}
        placeholder={
          <View style={{ gap: theme.space.sm }}>
            <FSkeleton width="30%" height={14} />
            <FSkeleton width="60%" height={56} />
          </View>
        }
      >
        {data ? (
          <View testID="fees-hero" style={[styles.row, { gap: theme.space.md }]}>
            <View style={styles.flex}>
              {dueNow > 0n ? (
                <>
                  <FText variant="meta" color="muted">
                    {t("dueNow")}
                  </FText>
                  <FNumber
                    value={Number(dueNow) / 100}
                    format={(n) => format.money((Math.round(n * 100) / 100).toFixed(2))}
                    size="numberHero"
                    color="critical"
                    replayKey={studentId}
                  />
                  {isPositive(data.totals.overdue) ? (
                    <FText variant="meta" color="critical">
                      {t("overdue", { amount: format.money(data.totals.overdue) })}
                    </FText>
                  ) : isPositive(data.totals.thisMonth) ? (
                    <FText variant="meta" color="muted">
                      {t("thisMonth", { amount: format.money(data.totals.thisMonth) })}
                    </FText>
                  ) : null}
                </>
              ) : (
                <>
                  <FText variant="display" color="positive">
                    {t("allPaid")}
                  </FText>
                  <FText variant="meta" color="muted">
                    {t("allPaidBody")}
                  </FText>
                </>
              )}
            </View>
            {dueNow === 0n ? <FMascot size={80} mood="happy" /> : null}
          </View>
        ) : null}
      </Reveal>

      {data ? (
        <>
          <View style={[styles.row, { gap: theme.space.sm }]}>
            <Tile label={t("tiles.paid")} value={format.money(data.totals.paid)} />
            {isPositive(data.totals.concession) ? (
              <Tile label={t("tiles.concession")} value={format.money(data.totals.concession)} />
            ) : null}
            {isPositive(data.totals.later) ? <Tile label={t("tiles.later")} value={format.money(data.totals.later)} /> : null}
          </View>

          {data.months.length > 0 ? (
            <Section title={t("months")}>
              <MonthStrip
                months={data.months}
                selected={selected}
                onSelect={(key) => setMonth(key === selected ? null : { studentId, key })}
              />
            </Section>
          ) : null}

          <Section
            title={selected ? t("duesFor", { month: format.month(selected) }) : t("dues")}
            action={
              selected ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setMonth(null)}>
                  <FText variant="meta">{t("showAll")}</FText>
                </Pressable>
              ) : null
            }
          >
            {listed.length === 0 ? (
              <FText variant="body" color="muted">
                {t("duesNone")}
              </FText>
            ) : (
              <FRowStack>
                {listed.map((due, index) => {
                  const overdue = isOverdue(due, today);
                  const open = isPositive(due.balance) && (due.status === "unpaid" || due.status === "partial");
                  return (
                    <Enter key={due.id} index={index}>
                      <FRow
                        testID={`fees-due-${due.id}`}
                        title={dueLabel(due)}
                        subtitle={
                          !open
                            ? t("paidOn")
                            : due.status === "partial"
                              ? t("partPaid", { paid: format.money(due.paidAmount), net: format.money(due.netAmount) })
                              : overdue
                                ? t("overdueSince", { date: format.date(due.dueDate) })
                                : t("dueOn", { date: format.date(due.dueDate) })
                        }
                        subtitleTone={!open ? "positive" : overdue ? "critical" : undefined}
                        value={format.money(open ? due.balance : due.netAmount)}
                        valueVariant="heading"
                      />
                    </Enter>
                  );
                })}
              </FRowStack>
            )}
          </Section>

          {previous.length > 0 ? (
            <Section title={t("previousDues")}>
              <FRowStack>
                {previous.map((d) => (
                  <FRow
                    key={d.id}
                    title={d.label ?? t("previousDue")}
                    value={format.money(d.balance)}
                    valueVariant="heading"
                    valueColor="critical"
                  />
                ))}
              </FRowStack>
            </Section>
          ) : null}

          {data.concessions.length > 0 ? (
            <Section title={t("concessions")}>
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
            </Section>
          ) : null}

          <Section title={t("payments")}>
            {data.payments.length === 0 ? (
              <FText variant="body" color="muted">
                {t("paymentsNone")}
              </FText>
            ) : (
              <FRowStack>
                {data.payments.map((p) => (
                  <FRow
                    key={p.id}
                    testID={`fees-payment-${p.id}`}
                    title={p.receiptNumber}
                    subtitle={
                      p.status === "cleared"
                        ? t("paymentSub", { date: format.date(p.paymentDate), mode: t(`mode.${modeKey(p.paymentMode)}`) })
                        : t("paymentSubStatus", {
                            date: format.date(p.paymentDate),
                            mode: t(`mode.${modeKey(p.paymentMode)}`),
                            status: t(`status.${p.status}`),
                          })
                    }
                    subtitleTone={p.status === "cleared" ? undefined : PAYMENT_TONE[p.status]}
                    value={format.money(p.totalAmount)}
                    valueVariant="heading"
                    onPress={() => router.push({ pathname: "/family/payment/[id]", params: { id: p.id } })}
                  />
                ))}
              </FRowStack>
            )}
          </Section>

          <View style={{ gap: theme.space.sm }}>
            <FButton
              testID="fees-statement"
              label={t("statement")}
              icon="receipt"
              variant="secondary"
              block
              loading={statement.busy}
              onPress={() => void statement.share({ kind: "statement", studentId }, t("statement"))}
            />
            {statement.error ? (
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

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <View style={[styles.row, styles.between]}>
        <FText variant="heading">{title}</FText>
        {action}
      </View>
      {children}
    </View>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <FCard style={styles.tile}>
      <FText variant="meta" color="muted" numberOfLines={2}>
        {label}
      </FText>
      <FText variant="heading" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </FText>
    </FCard>
  );
}

type MonthRow = { month: string; label: string; balance: string; state: "overdue" | "due" | "upcoming" | "paid" | "none" };

function MonthStrip({
  months,
  selected,
  onSelect,
}: {
  months: MonthRow[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const theme = useFamilyTheme();
  const k = theme.components.monthChip;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: k.gap }}>
      {months.map((m) => {
        const key = monthOf(m.month);
        const colors = k.tone[MONTH_TONE[m.state]];
        const isSelected = key === selected;
        return (
          <Pressable
            key={m.month}
            testID={`fees-month-${key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={t("monthA11y", {
              month: format.month(key),
              state: t(`monthState.${m.state}`),
              balance: format.money(m.balance),
            })}
            onPress={() => onSelect(key)}
            style={[
              styles.chip,
              {
                width: k.width,
                height: k.height,
                borderRadius: k.radius,
                backgroundColor: colors.bg,
                borderColor: isSelected ? k.selectedBorder : "transparent",
              },
            ]}
          >
            <FText variant="label" tint={colors.fg}>
              {format.month(key, "short")}
            </FText>
            <FText variant="caption" tint={colors.fg} numberOfLines={1}>
              {t(`monthState.${m.state}`)}
            </FText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  between: {
    justifyContent: "space-between",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  tile: {
    flex: 1,
    minWidth: 0,
  },
  chip: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
});
