import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  applyDiscount,
  collectShortcuts,
  coverRows,
  distributeAmount,
  feeNameOf,
  focusAmounts,
  focusLabel,
  installmentTitle,
  isHeldMode,
  isPayable,
  nextClientReference,
  oldestFirst,
  PAYMENT_MODES,
  paymentModeLabel,
  referenceFields,
  monthKeyOf,
  monthLabel,
} from "../../lib/fees";
import type { PaymentMode } from "../../lib/fees";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  clampAllocation,
  formatMoney,
  parseMoney,
  sumMoney,
  toMoneyString,
  isPositiveMoney,
  sanitizeAmountInput,
  subtractMoney,
  toInputAmount,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import {
  fontFamily,
  fontSize,
  radius,
  spacing,
  touch,
} from "../../theme/tokens";
import { useSessionOpen } from "../../hooks/use-session-open";
import { feesCopy } from "../../lib/fees-copy";

/**
 * Take the money.
 *
 * It opens ready to record the usual case: everything due now, in cash. One
 * amount is spread oldest first across the open dues, and "This pays" shows
 * exactly where it lands. Shortcuts are running totals, so tapping one is the
 * same as typing it. Opened from "Pay" on a month or a due, only that is
 * filled. The per-fee boxes live in a sheet for the rare parent who names fees.
 * An amount cannot exceed its due: it is capped with a visible reason, so the
 * server never has to reject an over-allocation.
 *
 * `clientReference` is minted once per mount and kept across retries. A
 * dropped response can therefore be retried safely: the server returns the
 * payment it already recorded instead of taking the money twice.
 */
/** "2026-10" → "2026-11". */
function nextMonthOf(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** "2026-11" → "2026-11-30". */
function endOfMonthKey(key: string): string {
  const last = new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)),
    0,
  ).getDate();
  return `${key}-${String(last).padStart(2, "0")}`;
}

/** One amount box on collect: an installment or a carried-forward balance. */
type PayableLine = {
  kind: "installment" | "opening";
  /** The amounts-map key; namespaced so the two kinds never collide. */
  key: string;
  id: string;
  title: string;
  /** The fee's name without its month, for "This pays". */
  name: string;
  /** The due's month; null for a balance carried in from an earlier session. */
  month: string | null;
  paid: string | null;
  net: string | null;
  balance: string;
  /** Due after the current month: paying ahead. */
  ahead: boolean;
};

export function CollectPaymentScreen() {
  const params = useLocalSearchParams<{
    studentId?: string;
    studentName?: string;
    className?: string;
    carriedForward?: string;
    /** From "Pay": `month:2026-04`, `fee:Tuition Fee`, `due:<id>` or `previous`. */
    focus?: string;
  }>();
  const { organizationId, schoolId, academicYear, ready, yearPending } =
    useActiveContext();
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();

  const studentId = params.studentId ?? "";
  const canCollect = has("fee_payment:create") && sessionOpen;
  const canReadDues = has("student_fee_assignment:read");
  // Carried-forward balances are read through the setup grant; a cashier
  // without it still collects installments and sees the notice instead.
  const canReadOpenings = has("fee_structure:read");
  // Monthly schools (ADR-051) create later months only when asked: "pay
  // ahead" first adds the next month's dues for this student.
  const canAddMonths = has("student_fee_assignment:update") && sessionOpen;

  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [clamped, setClamped] = useState<Record<string, string | null>>({});
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [review, setReview] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One amount by default: the cashier types what was handed over and the split
  // follows, oldest first. The per-fee boxes are one tap away for the rare case.
  const [adjust, setAdjust] = useState(false);
  const [received, setReceived] = useState<string | null>(null);
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [waiveLateFee, setWaiveLateFee] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const focus = typeof params.focus === "string" && params.focus.length > 0 ? params.focus : null;
  // Opened from "Pay": the card says so until the cashier switches to all due.
  const [focusOn, setFocusOn] = useState(Boolean(focus));
  const canGiveOff = has("fee_waiver:create");
  const currentMonth = monthKeyOf(todayIso());

  // One key for this attempt. Kept for the component's life so a retry after
  // a network failure is idempotent rather than a second payment.
  const clientReference = useRef(nextClientReference()).current;
  const prefilled = useRef(false);

  const today = todayIso();

  const student = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: studentId },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        Boolean(studentId) &&
        !params.studentName,
    },
  );

  const dues = trpc.fees.installment.dues.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canReadDues &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );

  const assignmentQuery = trpc.fees.assignment.byStudent.useQuery(
    {
      organizationId: organizationId ?? "",
      studentId,
      academicYearId: academicYear?.id ?? "",
      schoolId: schoolId ?? "",
    },
    {
      enabled:
        ready &&
        canAddMonths &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  const addMonth = trpc.fees.assignment.generateInstallments.useMutation();
  const utils = trpc.useUtils();

  const openings = trpc.fees.ledger.listOpeningBalances.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canReadOpenings &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  // Collect waits for the openings read only when it can make it. A failed read
  // is not settled: prefilling without it would quote a smaller bill than is owed.
  const openingsSettled = !canReadOpenings || openings.isSuccess;

  // Everything payable on one receipt, oldest money first: carried-forward
  // balances (an earlier session), then installments oldest-due first.
  const lines = useMemo<PayableLine[]>(() => {
    const carried = (openings.data ?? [])
      .filter((row) => isPositiveMoney(row.balanceAmount))
      .map((row) => ({
        kind: "opening" as const,
        key: `opening:${row.id}`,
        id: row.id,
        title: row.description?.trim() || copy.fees.collect.carriedForwardLine,
        name: row.description?.trim() || copy.fees.collect.carriedForwardLine,
        month: null,
        paid: row.paidAmount,
        net: row.amount,
        balance: row.balanceAmount ?? "0.00",
        ahead: false,
      }));
    const due = oldestFirst((dues.data ?? []).filter(isPayable)).map((row) => ({
      kind: "installment" as const,
      key: row.id,
      id: row.id,
      title: installmentTitle(row),
      name: feeNameOf(row.description),
      month: monthKeyOf(row.dueDate),
      paid: row.paidAmount,
      net: row.netAmount,
      balance: row.balanceAmount ?? "0.00",
      // Due after this month: offered under "Pay ahead", never prefilled.
      ahead: monthKeyOf(row.dueDate) > currentMonth,
    }));
    return [...carried, ...due];
  }, [openings.data, dues.data, currentMonth]);

  const nowLines = useMemo(() => lines.filter((line) => !line.ahead), [lines]);
  const aheadLines = useMemo(() => lines.filter((line) => line.ahead), [lines]);

  // The common case is "pay everything due up to now": prefill once, after
  // both reads. Future months start empty.
  const dueNowAmounts = useMemo(() => {
    const next: Record<string, string> = {};
    for (const line of nowLines) next[line.key] = toInputAmount(line.balance);
    return next;
  }, [nowLines]);

  useEffect(() => {
    if (prefilled.current || !dues.data || !openingsSettled) return;
    prefilled.current = true;
    // From "Pay": only what was picked, whole. A fee type pays up to this month.
    const picked = focus ? focusAmounts(lines, focus, currentMonth) : null;
    setAmounts(picked && Object.keys(picked).length > 0 ? picked : dueNowAmounts);
  }, [dues.data, openingsSettled, dueNowAmounts, focus, lines, currentMonth]);

  const billed = useMemo(
    () =>
      lines
        .map((line) => ({
          line,
          amount: clampAllocation(amounts[line.key] ?? "", line.balance),
        }))
        .filter((entry) => (parseMoney(entry.amount) ?? 0n) > 0n),
    [lines, amounts],
  );

  // A discount comes off the bill: less cash on the dues it lands on.
  const discounted = useMemo(
    () =>
      applyDiscount(
        billed.map((entry) => ({
          key: entry.line.key,
          id: entry.line.id,
          kind: entry.line.kind,
          amount: entry.amount,
        })),
        discount,
      ),
    [billed, discount],
  );
  const discountsToSend = discounted.discounts;
  const appliedDiscount = discounted.appliedDiscount;
  const allocations = useMemo(
    () =>
      billed
        .map((entry, index) => ({
          line: entry.line,
          amount: discounted.lines[index]?.cash ?? entry.amount,
        }))
        .filter(
          (entry) =>
            (parseMoney(entry.amount) ?? 0n) > 0n ||
            discountsToSend.some((d) => d.installmentId === entry.line.id),
        ),
    [billed, discounted, discountsToSend],
  );

  const bill = useMemo(() => sumMoney(billed.map((entry) => entry.amount)), [billed]);
  const total = useMemo(
    () => sumMoney(allocations.map((entry) => entry.amount)),
    [allocations],
  );

  // What recording this would cost, so the parent hears the full amount first.
  const quote = trpc.fees.payment.quote.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      data: {
        studentId,
        academicYearId: academicYear?.id ?? "",
        paymentDate,
        allocations: allocations
          .filter(
            (entry) =>
              entry.line.kind === "installment" && (parseMoney(entry.amount) ?? 0n) > 0n,
          )
          .map((entry) => ({ installmentId: entry.line.id, amount: entry.amount })),
      },
    },
    {
      enabled:
        ready &&
        Boolean(academicYear?.id) &&
        allocations.some(
          (entry) =>
            entry.line.kind === "installment" && (parseMoney(entry.amount) ?? 0n) > 0n,
        ),
    },
  );
  const lateFee = waiveLateFee ? "0.00" : (quote.data?.lateFeeAmount ?? "0.00");
  const grandTotal = sumMoney([total, lateFee]);
  const outstanding = useMemo(
    () => sumMoney(nowLines.map((line) => line.balance)),
    [nowLines],
  );

  // The month "Add {month}" would create: one past the latest open due, and
  // never before next month. Pressing it again steps forward a month, so a
  // month that already exists (paid, so not listed) is simply skipped over.
  const [addedThrough, setAddedThrough] = useState<string | null>(null);
  const latestDueMonth = (dues.data ?? []).reduce(
    (max, row) =>
      row.dueDate.slice(0, 7) > max ? row.dueDate.slice(0, 7) : max,
    currentMonth,
  );
  const nextMonthKey = nextMonthOf(
    addedThrough && addedThrough > latestDueMonth
      ? addedThrough
      : latestDueMonth,
  );
  const sessionLastMonth = academicYear?.endDate.slice(0, 7) ?? "";
  const canOfferNextMonth =
    canAddMonths &&
    Boolean(assignmentQuery.data) &&
    nextMonthKey <= sessionLastMonth;

  const addNextMonth = async () => {
    const assignment = assignmentQuery.data;
    if (!assignment) return;
    setError(null);
    try {
      await addMonth.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        id: assignment.id,
        through: endOfMonthKey(nextMonthKey),
      });
      setAddedThrough(nextMonthKey);
      await Promise.all([
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
      ]);
    } catch (cause) {
      setError(cause);
    }
  };

  const nextMonthButton = canOfferNextMonth ? (
    <CapsuleButton
      title={copy.fees.collect.addMonth(
        `${monthLabel(Number(nextMonthKey.slice(5, 7)))} ${nextMonthKey.slice(0, 4)}`,
      )}
      icon="add"
      variant="secondary"
      size="compact"
      loading={addMonth.isPending}
      onPress={() => void addNextMonth()}
      testID="fee-collect-add-month"
    />
  ) : null;

  const studentName =
    (typeof params.studentName === "string" && params.studentName.length > 0
      ? params.studentName
      : null) ??
    (student.data
      ? [student.data.firstName, student.data.middleName, student.data.lastName]
          .filter(Boolean)
          .join(" ")
      : copy.fees.collect.studentFallback);
  const classLine =
    typeof params.className === "string" && params.className.length > 0
      ? params.className
      : null;

  const fields = referenceFields(mode);
  const referenceError =
    submitted && fields.reference && reference.trim().length === 0
      ? copy.fees.collect.referenceRequired
      : undefined;
  const bankError =
    submitted && fields.bank && bankName.trim().length === 0
      ? copy.fees.collect.bankRequired
      : undefined;
  const chequeDateError =
    submitted && fields.chequeDate && !chequeDate
      ? copy.fees.collect.chequeDateRequired
      : undefined;

  const anyClamped = Object.values(clamped).some(Boolean);

  const setAmount = (id: string, next: string) => {
    setAmounts((current) => ({
      ...current,
      [id]: sanitizeAmountInput(next),
    }));
    setClamped((current) => ({ ...current, [id]: null }));
  };

  const settleAmount = (id: string, balance: string | null) => {
    const raw = parseMoney(amounts[id] ?? "");
    const limit = parseMoney(balance ?? "0.00") ?? 0n;
    if (raw === null) {
      setAmounts((current) => ({ ...current, [id]: "" }));
      return;
    }
    if (raw > limit) {
      setAmounts((current) => ({
        ...current,
        [id]: limit > 0n ? toInputAmount(toMoneyString(limit)) : "",
      }));
      setClamped((current) => ({
        ...current,
        [id]: formatMoney(balance),
      }));
      return;
    }
    setAmounts((current) => ({
      ...current,
      [id]: raw > 0n ? toInputAmount(toMoneyString(raw)) : "",
    }));
    setClamped((current) => ({ ...current, [id]: null }));
  };

  const payFull = () => {
    setAmounts(dueNowAmounts);
    setReceived(null);
    setClamped({});
    setFocusOn(false);
  };

  // The one-amount box: what was handed over, spread oldest first.
  const changeReceived = (next: string) => {
    const value = sanitizeAmountInput(next);
    setReceived(value);
    setFocusOn(false);
    setAmounts(
      distributeAmount(
        value,
        lines.map((line) => ({ key: line.key, balance: line.balance })),
      ),
    );
  };

  const payRestOfYear = async () => {
    const assignment = assignmentQuery.data;
    if (!assignment || !academicYear) return;
    setError(null);
    try {
      await addMonth.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        id: assignment.id,
        through: academicYear.endDate,
      });
      const [fresh] = await Promise.all([
        dues.refetch(),
        utils.fees.dashboard.invalidate(),
      ]);
      // The bill is now everything open. `lines` is a render behind, so the
      // new dues are read from the refetch.
      const next: Record<string, string> = {};
      for (const line of lines) {
        if (line.kind === "opening") next[line.key] = toInputAmount(line.balance);
      }
      for (const row of (fresh.data ?? []).filter(isPayable)) {
        next[row.id] = toInputAmount(row.balanceAmount ?? "0.00");
      }
      setAmounts(next);
      setReceived(null);
      setAdjust(false);
    } catch (cause) {
      setError(cause);
    }
  };

  const openReview = () => {
    setSubmitted(true);
    setError(null);
    if (allocations.length === 0) return;
    if (isPositiveMoney(appliedDiscount) && discountReason.trim().length === 0) return;
    if (fields.reference && reference.trim().length === 0) return;
    if (fields.bank && bankName.trim().length === 0) return;
    if (fields.chequeDate && !chequeDate) return;
    setReview(true);
  };

  const record = trpc.fees.payment.record.useMutation();

  const confirm = async () => {
    if (!academicYear) return;
    setError(null);
    try {
      const payment = await record.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        data: {
          studentId,
          academicYearId: academicYear.id,
          paymentDate,
          paymentMode: mode,
          discounts: discountsToSend,
          discountReason: isPositiveMoney(appliedDiscount)
            ? discountReason.trim()
            : null,
          waiveLateFee,
          allocations: allocations
            .filter(
              (entry) =>
                entry.line.kind === "installment" &&
                (parseMoney(entry.amount) ?? 0n) > 0n,
            )
            .map((entry) => ({
              installmentId: entry.line.id,
              amount: entry.amount,
            })),
          openingBalanceAllocations: allocations
            .filter((entry) => entry.line.kind === "opening")
            .map((entry) => ({
              openingBalanceId: entry.line.id,
              amount: entry.amount,
            })),
          transactionReference: fields.reference ? reference.trim() : null,
          bankName: fields.bank ? bankName.trim() : null,
          chequeDate: fields.chequeDate ? chequeDate : null,
          remarks: remarks.trim().length > 0 ? remarks.trim() : null,
          clientReference,
        },
      });

      await Promise.all([
        utils.fees.dashboard.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.ledger.listOpeningBalances.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.payment.list.invalidate(),
        utils.fees.ledger.list.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);

      router.replace({
        pathname: "/fees/receipt/[paymentId]",
        params: {
          paymentId: payment.id,
          studentId: payment.studentId,
          studentName,
          className: classLine ?? "",
          recorded: "1",
        },
      });
    } catch (cause) {
      setError(cause);
    }
  };

  const words = feesCopy.collect;
  const modeLabel = paymentModeLabel(mode);
  const shownAmount = received ?? toInputAmount(bill);
  const shownPaise = parseMoney(shownAmount) ?? 0n;
  const owedInAll = sumMoney(lines.map((line) => line.balance));
  const overAsked =
    received !== null && (parseMoney(received) ?? 0n) > (parseMoney(owedInAll) ?? 0n);
  const shortcuts = collectShortcuts(lines, currentMonth);
  const covers = coverRows(lines, amounts);
  const billedNow = sumMoney(
    billed.filter((entry) => !entry.line.ahead).map((entry) => entry.amount),
  );
  const leftNow = subtractMoney(outstanding, billedNow);
  // Only when "Pay" found something to fill; otherwise collect opened as usual.
  const focusFound = focus ? Object.keys(focusAmounts(lines, focus, currentMonth)).length > 0 : false;
  const focusText = focusOn && focus && focusFound ? focusLabel(lines, focus) : null;
  const nothingDueNow = nowLines.length === 0;
  const hasLateFee = isPositiveMoney(quote.data?.lateFeeAmount);

  const footer =
    lines.length > 0 ? (
      <CapsuleButton
        title={words.record(formatMoney(grandTotal), modeLabel)}
        icon="check"
        onPress={openReview}
        disabled={allocations.length === 0}
        style={styles.wide}
        testID="fee-collect-review"
      />
    ) : undefined;

  const frame = (children: ReactNode, footerSlot?: ReactNode) => (
    <ScreenFrame
      title={studentName}
      meta={classLine ? `${copy.fees.collect.title} · ${classLine}` : copy.fees.collect.title}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canReadDues ? () => void dues.refetch() : undefined}
      refreshing={dues.isRefetching}
      footer={footerSlot}
      footerVariant="floating"
      titleTestID="fee-collect-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canCollect) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.fees.collect.deniedTitle}
        message={copy.fees.collect.deniedBody}
        testID="fee-collect-denied"
      >
        <CapsuleButton
          title={copy.fees.collect.backToDesk}
          variant="secondary"
          size="compact"
          onPress={() => router.back()}
          testID="fee-collect-back"
        />
      </EmptyState>,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={160} />
        <Skeleton height={140} />
        <Skeleton height={140} />
      </View>,
    );
  }

  if (!organizationId || !schoolId || !academicYear) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-collect-no-context"
      />,
    );
  }

  if (!canReadDues) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.collect.missingTitle}
        message={copy.fees.collect.missingBody}
        testID="fee-collect-no-dues"
      />,
    );
  }

  if (dues.isError || (canReadOpenings && openings.isError)) {
    return frame(
      <ErrorCard
        cause={dues.error ?? openings.error}
        onRetry={() => {
          if (dues.isError) void dues.refetch();
          if (openings.isError) void openings.refetch();
        }}
        testID="fee-collect-error"
      />,
    );
  }

  if ((dues.isPending && !dues.data) || !openingsSettled) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={160} />
        <Skeleton height={140} />
        <Skeleton height={140} />
      </View>,
    );
  }

  if (lines.length === 0) {
    return frame(
      <EmptyState
        icon="check"
        title={copy.fees.collect.emptyTitle}
        message={copy.fees.collect.emptyBody}
        testID="fee-collect-empty"
      >
        {nextMonthButton}
        <CapsuleButton
          title={copy.fees.collect.backToDesk}
          variant="secondary"
          size="compact"
          onPress={() => router.back()}
          testID="fee-collect-back"
        />
      </EmptyState>,
    );
  }

  const renderLine = (line: PayableLine, index: number) => {
    const { title } = line;
    const note = clamped[line.key];
    const value = amounts[line.key] ?? "";
    return (
      <View
        key={line.key}
        style={[styles.row, index === 0 ? null : styles.divider]}
      >
        <View style={styles.rowText}>
          <ThemedText variant="bodyStrong" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={2}>
            {copy.fees.desk.paidOf(
              formatMoney(line.paid),
              formatMoney(line.net),
            )}
          </ThemedText>
          {note ? (
            <ThemedText variant="caption" color={colors.tone.caution.fg}>
              {copy.fees.collect.clamped(note)}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.rowTrailing}>
          <View style={styles.amountBox}>
            <ThemedText variant="body" color={colors.muted}>
              ₹
            </ThemedText>
            <TextInput
              value={value}
              onChangeText={(next) => {
                setAmount(line.key, next);
                setReceived(null);
                setFocusOn(false);
              }}
              onBlur={() => settleAmount(line.key, line.balance)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="0"
              placeholderTextColor={colors.muted}
              accessibilityLabel={copy.fees.collect.amountA11y(
                title,
                formatMoney(line.balance),
              )}
              selectTextOnFocus
              maxFontSizeMultiplier={1.2}
              style={styles.amountInput}
              testID={`fee-collect-amount-${line.id}`}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${words.removeRow} ${title}`}
            hitSlop={8}
            onPress={() => {
              setAmount(line.key, "");
              setReceived(null);
              setClamped((current) => ({
                ...current,
                [line.key]: null,
              }));
            }}
            style={styles.clear}
            testID={`fee-collect-clear-${line.id}`}
          >
            <ThemedText variant="caption" color={colors.accentDeep}>
              {words.removeRow}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  const lateFeeLink = canGiveOff && hasLateFee ? (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => setWaiveLateFee((value) => !value)}
      testID="fee-collect-waive-late"
    >
      <ThemedText variant="meta" color={colors.accentDeep}>
        {waiveLateFee ? words.undo : words.forgive}
      </ThemedText>
    </Pressable>
  ) : null;

  return frame(
    <>
      <View style={styles.body}>
        <Card style={styles.amountCard}>
          <View style={styles.amountHead}>
            <ThemedText variant="sectionLabel" numberOfLines={1} style={styles.flex}>
              {focusText
                ? words.paying(focusText)
                : nothingDueNow
                  ? words.payAhead
                  : words.amount}
            </ThemedText>
            {nothingDueNow ? (
              <StatusPill label={words.nothingDue} tone="positive" />
            ) : (
              <ThemedText variant="meta">{words.dueNow(formatMoney(outstanding))}</ThemedText>
            )}
          </View>

          <View style={styles.bigField}>
            <ThemedText style={styles.bigRupee} maxFontSizeMultiplier={1.15}>
              ₹
            </ThemedText>
            <TextInput
              value={shownAmount}
              onChangeText={changeReceived}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="0"
              placeholderTextColor={colors.muted}
              selectTextOnFocus
              maxLength={11}
              maxFontSizeMultiplier={1.15}
              accessibilityLabel={words.amountA11y}
              style={styles.bigInput}
              testID="fee-collect-received"
            />
            <AppIcon name="edit" size={18} color={colors.muted} />
          </View>
          {overAsked ? (
            <ThemedText variant="caption" color={colors.tone.caution.fg}>
              {words.capped(formatMoney(owedInAll))}
            </ThemedText>
          ) : null}
          {hasLateFee ? (
            <View style={styles.lateRow}>
              <ThemedText variant="meta" style={styles.flex}>
                {waiveLateFee
                  ? words.lateForgiven
                  : words.lateLine(formatMoney(lateFee), formatMoney(grandTotal))}
              </ThemedText>
              {lateFeeLink}
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.chipScroll}
            contentContainerStyle={styles.chips}
            testID="fee-collect-shortcuts"
          >
            {shortcuts.map((shortcut) => {
              const on = !focusText && shownPaise === (parseMoney(shortcut.amount) ?? -1n);
              return (
                <Pressable
                  key={shortcut.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setClamped({});
                    changeReceived(toInputAmount(shortcut.amount));
                  }}
                  style={[styles.chip, on ? styles.chipOn : null]}
                  testID={`fee-collect-shortcut-${shortcut.id}`}
                >
                  <ThemedText variant="bodyStrong" color={on ? colors.accentDeep : colors.ink}>
                    {shortcut.label}
                  </ThemedText>
                  <ThemedText variant="meta" color={on ? colors.accentDeep : colors.muted}>
                    {formatMoney(shortcut.amount)}
                  </ThemedText>
                </Pressable>
              );
            })}
            {canOfferNextMonth ? (
              <Pressable
                accessibilityRole="button"
                disabled={addMonth.isPending}
                onPress={() => void addNextMonth()}
                style={[styles.chip, addMonth.isPending ? styles.dim : null]}
                testID="fee-collect-add-month"
              >
                <AppIcon name="add" size={16} color={colors.accentDeep} />
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {words.addMonthChip(
                    `${monthLabel(Number(nextMonthKey.slice(5, 7))).slice(0, 3)}`,
                  )}
                </ThemedText>
              </Pressable>
            ) : null}
            {canOfferNextMonth ? (
              <Pressable
                accessibilityRole="button"
                disabled={addMonth.isPending}
                onPress={() => void payRestOfYear()}
                style={[styles.chip, addMonth.isPending ? styles.dim : null]}
                testID="fee-collect-pay-rest"
              >
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {words.payRest}
                </ThemedText>
              </Pressable>
            ) : null}
          </ScrollView>

          {focusText ? (
            <View style={styles.context}>
              <ThemedText variant="meta" numberOfLines={1} style={styles.flex}>
                {words.openedFrom(focusText)}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={payFull}
                testID="fee-collect-pay-all-instead"
              >
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {words.payAllInstead}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
        </Card>

        {covers.length > 0 ? (
          <Card padless>
            <View style={styles.coverHead}>
              <ThemedText variant="sectionLabel">{words.thisPays}</ThemedText>
              <ThemedText variant="meta">{words.oldestFirst}</ThemedText>
            </View>
            {covers.map((row, index) => (
              <View
                key={row.key}
                style={[styles.cover, index === 0 ? null : styles.coverDivider]}
                testID={`fee-collect-covers-${index}`}
              >
                {row.full ? (
                  <View style={styles.ok}>
                    <AppIcon name="check" size={14} color={colors.onAccent} />
                  </View>
                ) : (
                  <View style={styles.part} />
                )}
                <ThemedText variant="body" numberOfLines={1}>
                  {row.label}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={1} style={styles.flex}>
                  {row.detail ?? ""}
                </ThemedText>
                <ThemedText variant="bodyStrong" maxFontSizeMultiplier={1.2}>
                  {formatMoney(row.amount)}
                </ThemedText>
              </View>
            ))}
            <View style={styles.coverFoot}>
              <ThemedText
                variant="meta"
                numberOfLines={1}
                style={styles.flex}
                color={isPositiveMoney(leftNow) ? colors.tone.critical.fg : undefined}
              >
                {isPositiveMoney(leftNow)
                  ? words.stillDue(formatMoney(leftNow))
                  : words.nothingLeft}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setAdjust(true)}
                style={styles.adjustLink}
                testID="fee-collect-adjust"
              >
                <AppIcon name="manage" size={16} color={colors.accentDeep} />
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {words.adjust}
                </ThemedText>
              </Pressable>
            </View>
          </Card>
        ) : (
          <Notice
            tone="neutral"
            message={nothingDueNow ? copy.fees.collect.nothingDueNow : copy.fees.collect.noAllocations}
            testID="fee-collect-nothing-due"
          />
        )}

        {isPositiveMoney(params.carriedForward) && !canReadOpenings ? (
          <Notice
            tone="caution"
            message={copy.fees.collect.carriedForwardNotice(
              formatMoney(params.carriedForward),
            )}
            testID="fee-collect-carried-forward"
          />
        ) : null}

        {anyClamped ? (
          <Notice
            tone="caution"
            message={copy.fees.collect.clampedNotice}
            testID="fee-collect-clamped"
          />
        ) : null}

        <ThemedText variant="sectionLabel" style={styles.sectionLabel}>
          {words.paidBy}
        </ThemedText>
        <View style={styles.modes}>
          {PAYMENT_MODES.map((option) => {
            const on = mode === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setMode(option)}
                style={[styles.mode, on ? styles.modeOn : null]}
                testID={`fee-collect-mode-${option}`}
              >
                <AppIcon
                  name={MODE_ICON[option]}
                  size={22}
                  color={on ? colors.accentDeep : colors.tone.neutral.fg}
                />
                <ThemedText
                  variant="caption"
                  color={on ? colors.accentDeep : colors.tone.neutral.fg}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                >
                  {paymentModeLabel(option)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        {isHeldMode(mode) ? (
          <Notice
            tone="caution"
            message={copy.fees.collect.modeHint}
            testID="fee-collect-mode-hint"
          />
        ) : null}

        <Card style={styles.fields}>
          {fields.reference ? (
            <FormField
              label={copy.fees.collect.referenceLabel}
              value={reference}
              onChangeText={setReference}
              placeholder={fields.placeholder}
              help={fields.hint ?? undefined}
              error={referenceError}
              autoCapitalize="characters"
              maxLength={150}
              testID="fee-collect-reference"
            />
          ) : null}
          {fields.bank ? (
            <FormField
              label={copy.fees.collect.bankLabel}
              value={bankName}
              onChangeText={setBankName}
              placeholder={copy.fees.collect.bankLabel}
              error={bankError}
              maxLength={100}
              testID="fee-collect-bank"
            />
          ) : null}
          {fields.chequeDate ? (
            <DateField
              label={copy.fees.collect.chequeDateLabel}
              value={chequeDate}
              onChange={setChequeDate}
              error={chequeDateError}
              testID="fee-collect-cheque-date"
            />
          ) : null}
          <DateField
            label={copy.fees.collect.paymentDateLabel}
            value={paymentDate}
            onChange={setPaymentDate}
            help={copy.fees.collect.paymentDateHelp}
            maximumDate={today}
            testID="fee-collect-date"
          />

          {canGiveOff && (showDiscount || discount.length > 0) ? (
            <>
              <FormField
                label={words.discountLabel}
                value={discount}
                onChangeText={(next) => setDiscount(sanitizeAmountInput(next))}
                keyboardType="decimal-pad"
                placeholder="0"
                help={words.discountHelp}
                maxLength={11}
                testID="fee-collect-discount"
              />
              {isPositiveMoney(appliedDiscount) ? (
                <FormField
                  label={words.discountReason}
                  value={discountReason}
                  onChangeText={setDiscountReason}
                  error={
                    submitted && discountReason.trim().length === 0
                      ? words.discountNeedsReason
                      : undefined
                  }
                  maxLength={255}
                  testID="fee-collect-discount-reason"
                />
              ) : null}
            </>
          ) : canGiveOff ? (
            <AddLink
              icon="fees"
              label={words.addDiscount}
              onPress={() => setShowDiscount(true)}
              testID="fee-collect-add-discount"
            />
          ) : null}

          {showNote || remarks.length > 0 ? (
            <FormField
              label={copy.fees.collect.remarksLabel}
              value={remarks}
              onChangeText={setRemarks}
              placeholder={copy.fees.collect.remarksPlaceholder}
              multiline
              numberOfLines={3}
              maxLength={500}
              testID="fee-collect-remarks"
            />
          ) : (
            <AddLink
              icon="edit"
              label={words.addNote}
              onPress={() => setShowNote(true)}
              testID="fee-collect-add-note"
            />
          )}
        </Card>

        <Card style={styles.totals}>
          <SummaryLine label={words.fees} value={formatMoney(bill)} />
          {isPositiveMoney(appliedDiscount) ? (
            <SummaryLine
              label={words.discountLine}
              value={`− ${formatMoney(appliedDiscount)}`}
            />
          ) : null}
          {hasLateFee ? (
            <SummaryLine
              label={words.lateFeeLine}
              value={formatMoney(lateFee)}
              trailing={lateFeeLink}
            />
          ) : null}
          <View style={styles.totalLine}>
            <ThemedText variant="bodyStrong">{words.toTake}</ThemedText>
            <ThemedText
              variant="title"
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
              testID="fee-collect-total"
            >
              {formatMoney(grandTotal)}
            </ThemedText>
          </View>
        </Card>

        {submitted && allocations.length === 0 ? (
          <Notice
            tone="critical"
            message={copy.fees.collect.noAllocations}
            testID="fee-collect-no-allocations"
          />
        ) : null}

        {error && !review ? (
          <Notice
            tone="critical"
            message={toFriendlyError(error).message}
            testID="fee-collect-error-notice"
          />
        ) : null}
      </View>

      {adjust ? (
        <FormSheet
          title={words.adjustTitle}
          onClose={() => setAdjust(false)}
          testIDPrefix="fee-collect-adjust-sheet"
          scroll={
            <>
              <ThemedText variant="meta">{words.adjustSub}</ThemedText>
              <Card padless>{[...nowLines, ...aheadLines].map(renderLine)}</Card>
            </>
          }
          footer={
            <View style={styles.sheetFooter}>
              <CapsuleButton
                title={words.payAll}
                variant="secondary"
                size="compact"
                onPress={payFull}
                testID="fee-collect-pay-full"
              />
              <CapsuleButton
                title={words.usePerFee(formatMoney(bill))}
                size="compact"
                onPress={() => {
                  setReceived(null);
                  setAdjust(false);
                }}
                testID="fee-collect-adjust-done"
              />
            </View>
          }
        />
      ) : null}

      {review ? (
        <FormSheet
          title={words.reviewTitle(formatMoney(grandTotal), modeLabel)}
          onClose={() => setReview(false)}
          testIDPrefix="fee-collect-review"
          scroll={
            <>
              <ThemedText variant="meta">
                {words.reviewSub(studentName, formatReadableDate(paymentDate))}
              </ThemedText>
              <View style={styles.receipt}>
                {/* Before any discount, so the lines add up to the total shown. */}
                {covers.map((row) => (
                  <SummaryLine
                    key={row.key}
                    label={row.detail ? `${row.label} · ${row.detail}` : row.label}
                    value={formatMoney(row.amount)}
                  />
                ))}
                {isPositiveMoney(appliedDiscount) ? (
                  <SummaryLine
                    label={words.discountLine}
                    value={`− ${formatMoney(appliedDiscount)}`}
                  />
                ) : null}
                {isPositiveMoney(lateFee) ? (
                  <SummaryLine label={words.lateFeeLine} value={formatMoney(lateFee)} />
                ) : null}
                <View style={styles.totalLine}>
                  <ThemedText variant="bodyStrong">{copy.fees.collect.reviewTotal}</ThemedText>
                  <ThemedText variant="title" testID="fee-collect-review-total">
                    {formatMoney(grandTotal)}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.reviewFacts}>
                {fields.reference && reference.trim().length > 0 ? (
                  <ThemedText variant="meta">
                    {copy.fees.collect.reviewReference}: {reference.trim()}
                  </ThemedText>
                ) : null}
                {fields.bank && bankName.trim().length > 0 ? (
                  <ThemedText variant="meta">
                    {copy.fees.collect.bankLabel}: {bankName.trim()}
                  </ThemedText>
                ) : null}
                {fields.chequeDate && chequeDate ? (
                  <ThemedText variant="meta">
                    {copy.fees.collect.chequeDateLabel}: {formatReadableDate(chequeDate)}
                  </ThemedText>
                ) : null}
                {isPositiveMoney(leftNow) ? (
                  <ThemedText variant="meta" color={colors.tone.critical.fg}>
                    {words.stillDue(formatMoney(leftNow))}
                  </ThemedText>
                ) : null}
              </View>

              {isHeldMode(mode) ? (
                <Notice
                  tone="caution"
                  message={copy.fees.collect.modeHint}
                  testID="fee-collect-review-pending"
                />
              ) : null}

              {error ? (
                <Notice
                  tone="critical"
                  message={toFriendlyError(error).message}
                  testID="fee-collect-review-error"
                />
              ) : null}
            </>
          }
          footer={
            <View style={styles.sheetFooter}>
              <CapsuleButton
                title={words.edit}
                variant="secondary"
                size="compact"
                onPress={() => setReview(false)}
                testID="fee-collect-review-cancel"
              />
              <CapsuleButton
                title={
                  record.isPending
                    ? copy.fees.collect.recording
                    : copy.fees.collect.confirm
                }
                variant="primary"
                size="compact"
                loading={record.isPending}
                onPress={() => void confirm()}
                testID="fee-collect-confirm"
              />
            </View>
          }
        />
      ) : null}
    </>,
    footer,
  );
}

const MODE_ICON: Record<PaymentMode, AppIconName> = {
  cash: "collect",
  upi: "modeUpi",
  cheque: "modeCheque",
  neft_rtgs: "modeBank",
  card: "modeCard",
  dd: "modeDraft",
};

function AddLink({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.addLink}
      testID={testID}
    >
      <AppIcon name={icon} size={20} color={colors.accentDeep} />
      <ThemedText variant="bodyStrong" color={colors.accentDeep}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SummaryLine({
  label,
  value,
  trailing,
}: {
  label: string;
  value: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.summaryLine}>
      <ThemedText variant="body" numberOfLines={2} style={styles.flexShrink}>
        {label}
      </ThemedText>
      {trailing}
      <View style={styles.flex} />
      <ThemedText variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeletons: {
    gap: spacing.md,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  flexShrink: {
    flexShrink: 1,
  },
  wide: {
    alignSelf: "stretch",
  },
  dim: {
    opacity: 0.5,
  },
  amountCard: {
    gap: spacing.xs,
  },
  amountHead: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // A real field, so the amount reads as something to change.
  bigField: {
    marginTop: spacing.xs,
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  bigRupee: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.hero,
    color: colors.ink,
  },
  bigInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xs,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.hero,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  lateRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  chipScroll: {
    marginTop: spacing.sm,
    marginHorizontal: -spacing.lg,
  },
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  chip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.canvas,
  },
  chipOn: {
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  context: {
    marginTop: spacing.sm,
    marginHorizontal: -spacing.lg,
    marginBottom: -spacing.lg,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  coverHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  cover: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  coverDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  ok: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  // Part paid: an amber ring beside the "₹100 of ₹1,200" text.
  part: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.tone.caution.fg,
    backgroundColor: colors.tone.caution.bg,
  },
  coverFoot: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  adjustLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  sectionLabel: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  modes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  mode: {
    width: "31.5%",
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  modeOn: {
    backgroundColor: colors.accentTint,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  fields: {
    gap: spacing.md,
  },
  addLink: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  totals: {
    gap: spacing.xs,
  },
  summaryLine: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  totalLine: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.row,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    // Wide enough for "100000.00" at the capped text size: a right-aligned
    // input that overflows scrolls its LEADING digits out of view, so a
    // ₹5000.00 line would read "000.00".
    minWidth: 148,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  amountInput: {
    flex: 1,
    minHeight: touch.comfortable,
    paddingVertical: spacing.xs,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.body,
    color: colors.ink,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  clear: {
    minHeight: touch.min,
    justifyContent: "center",
  },
  receipt: {
    gap: spacing.xxs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.canvas,
  },
  reviewFacts: {
    gap: spacing.xxs,
  },
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
