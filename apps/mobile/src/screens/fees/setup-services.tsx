import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { PersonRow } from "../../components/person-row";
import { ScreenFrame } from "../../components/screen-frame";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  formatMoney,
  isPositiveMoney,
  parseMoney,
  sanitizeAmountInput,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import type { Tone } from "../../theme/brand-admin";
import { colors } from "../../theme/brand-admin";
import { spacing, touch } from "../../theme/tokens";
import { SectionHead } from "./status";
import { useSessionOpen } from "../../hooks/use-session-open";

type Student = inferRouterOutputs<AppRouter>["student"]["list"][number];
type Subscription =
  inferRouterOutputs<AppRouter>["fees"]["subscription"]["list"][number];
type OpeningBalance =
  inferRouterOutputs<AppRouter>["fees"]["ledger"]["listOpeningBalances"][number];
type Head = inferRouterOutputs<AppRouter>["fees"]["head"]["list"][number];
type Year = inferRouterOutputs<AppRouter>["academic"]["year"]["list"][number];

type Done = { tone: Tone; message: string };

function studentName(student: Student): string {
  return [student.firstName, student.middleName, student.lastName]
    .filter(Boolean)
    .join(" ");
}

/**
 * Per-student fee services (Step 5E): the optional heads a student subscribes
 * to, and dues carried in from an earlier session.
 *
 * These two belong together because both are exceptions to the class bill —
 * one adds a charge, the other carries one forward — and both are recorded
 * against one student. The screen starts with the register search, then keeps
 * that student in view while either list is managed.
 */
export function FeeServicesScreen() {
  const { organizationId, schoolId, academicYear, ready, yearPending } =
    useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();

  const canRead = has("fee_structure:read");
  const canReadStudents = has("student:read");
  const canReadHeads = has("fee_head:read");
  const canCreate = has("fee_structure:create") && sessionOpen;
  const canUpdate = has("fee_structure:update") && sessionOpen;
  const canReadAssignment = has("student_fee_assignment:read");
  const canGenerate = has("student_fee_assignment:update");

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);
  const [sheet, setSheet] = useState<"subscribe" | "opening" | null>(null);
  const [notice, setNotice] = useState<Done | null>(null);

  const cancel = trpc.fees.subscription.cancel.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const enabled =
    ready &&
    canRead &&
    canReadStudents &&
    Boolean(organizationId) &&
    Boolean(schoolId);

  const students = trpc.student.list.useQuery(
    {
      organizationId: organizationId ?? "",
      q: search.length > 0 ? search : undefined,
    },
    {
      enabled:
        enabled && !selected && search.length > 0 && Boolean(organizationId),
      staleTime: 30_000,
    },
  );

  const subscriptions = trpc.fees.subscription.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      includeHistory: true,
      studentId: selected?.id ?? "",
    },
    {
      enabled: enabled && Boolean(selected) && Boolean(academicYear?.id),
      staleTime: 30_000,
    },
  );

  const openings = trpc.fees.ledger.listOpeningBalances.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId: selected?.id ?? "",
    },
    {
      enabled: enabled && Boolean(selected) && Boolean(academicYear?.id),
      staleTime: 30_000,
    },
  );

  const heads = trpc.fees.head.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled:
        ready && canReadHeads && Boolean(organizationId) && Boolean(selected),
      staleTime: 5 * 60_000,
    },
  );

  const years = trpc.academic.year.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: enabled && Boolean(organizationId), staleTime: 5 * 60_000 },
  );

  const assignment = trpc.fees.assignment.byStudent.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      studentId: selected?.id ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        enabled &&
        canReadAssignment &&
        Boolean(selected) &&
        Boolean(schoolId) &&
        Boolean(academicYear?.id),
      staleTime: 30_000,
    },
  );

  const headNames = new Map(
    (heads.data ?? []).map((row) => [row.id, row.name] as const),
  );
  const yearNames = new Map(
    (years.data ?? []).map((row) => [row.id, row.name] as const),
  );
  const optionalHeads = (heads.data ?? []).filter(
    (row) => row.category === "optional",
  );
  const originYears = (years.data ?? []).filter(
    (row) => row.id !== academicYear?.id,
  );

  const subscriptionRows = subscriptions.data ?? [];
  const openingRows = openings.data ?? [];

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.setup.services.title}
      meta={selected ? studentName(selected) : branchName}
      backAccessibilityLabel={copy.common.back}
      onRefresh={
        enabled
          ? () => {
              if (selected) {
                void subscriptions.refetch();
                void openings.refetch();
              } else if (search.length > 0) {
                void students.refetch();
              }
            }
          : undefined
      }
      refreshing={
        subscriptions.isRefetching ||
        openings.isRefetching ||
        students.isRefetching
      }
      titleTestID="fee-services-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead || !canReadStudents) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.setup.services.deniedTitle}
        message={copy.fees.setup.services.deniedBody}
        testID="fee-services-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={56} />
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
        testID="fee-services-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.ledger.noYearTitle}
        message={copy.fees.ledger.noYearBody}
        testID="fee-services-no-year"
      />,
    );
  }

  const closeSheet = (done: Done | null) => {
    setSheet(null);
    if (done) setNotice(done);
  };

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice
          tone={notice.tone}
          message={notice.message}
          testID="fee-services-notice"
        />
      ) : null}

      {!selected ? (
        <>
          <FormField
            label={copy.fees.setup.services.searchLabel}
            value={query}
            onChangeText={setQuery}
            placeholder={copy.fees.setup.services.searchPlaceholder}
            help={copy.fees.setup.services.searchHint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={100}
            testID="fee-services-search"
          />

          {search.length === 0 ? (
            <EmptyState
              icon="students"
              title={copy.fees.setup.services.noStudentTitle}
              message={copy.fees.setup.services.noStudentBody}
              testID="fee-services-prompt"
            />
          ) : students.isError ? (
            <ErrorCard
              cause={students.error}
              onRetry={() => void students.refetch()}
              testID="fee-services-search-error"
            />
          ) : students.isPending && !students.data ? (
            <View style={styles.skeletons}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} height={64} />
              ))}
            </View>
          ) : (students.data ?? []).length === 0 ? (
            <EmptyState
              icon="search"
              title={copy.fees.setup.services.searchEmptyTitle}
              message={copy.fees.setup.services.searchEmptyBody}
              testID="fee-services-search-empty"
            />
          ) : (
            <Card padless>
              {(students.data ?? []).map((student, index) => (
                <PersonRow
                  key={student.id}
                  name={studentName(student)}
                  meta={student.admissionNumber}
                  first={index === 0}
                  onPress={() => {
                    setNotice(null);
                    setSelected(student);
                  }}
                  trailing={
                    <AppIcon
                      name="chevronRight"
                      size={18}
                      color={colors.muted}
                    />
                  }
                  testID={`fee-services-student-${student.id}`}
                />
              ))}
            </Card>
          )}
        </>
      ) : (
        <>
          <Card>
            <PersonRow
              name={studentName(selected)}
              meta={selected.admissionNumber}
              first
              trailing={
                <CapsuleButton
                  title={copy.fees.setup.services.changeStudent}
                  variant="secondary"
                  size="mini"
                  onPress={() => {
                    setNotice(null);
                    setSelected(null);
                    setQuery("");
                    setSearch("");
                  }}
                  testID="fee-services-change-student"
                />
              }
              testID="fee-services-student"
            />
          </Card>

          <View style={styles.section}>
            <SectionHead
              title={copy.fees.setup.services.subscriptionsTitle}
              hint={copy.fees.setup.services.subscriptionsHint}
            >
              {canCreate && canReadHeads ? (
                <CapsuleButton
                  title={copy.fees.setup.services.addSubscription}
                  icon="add"
                  variant="secondary"
                  size="mini"
                  onPress={() => setSheet("subscribe")}
                  testID="fee-services-add-subscription"
                />
              ) : null}
            </SectionHead>

            {subscriptions.isError ? (
              <ErrorCard
                cause={subscriptions.error}
                onRetry={() => void subscriptions.refetch()}
                testID="fee-services-subscriptions-error"
              />
            ) : subscriptions.isPending && !subscriptions.data ? (
              <Skeleton height={120} />
            ) : subscriptionRows.length === 0 ? (
              <ThemedText variant="meta" style={styles.emptyLine}>
                {copy.fees.setup.services.noSubscriptions}
              </ThemedText>
            ) : (
              <Card padless>
                {subscriptionRows.map((subscription, index) => (
                  <SubscriptionRow
                    key={subscription.id}
                    subscription={subscription}
                    headName={
                      headNames.get(subscription.feeHeadId) ??
                      copy.fees.setup.structure.headUnknown
                    }
                    first={index === 0}
                    canCancel={canUpdate}
                    onCancel={() => {
                      Alert.alert(
                        copy.fees.setup.services.cancelTitle,
                        copy.fees.setup.services.cancelBody,
                        [
                          { text: copy.common.cancel, style: "cancel" },
                          {
                            text: copy.fees.setup.services.cancelConfirm,
                            style: "destructive",
                            onPress: () => {
                              void (async () => {
                                try {
                                  await cancel.mutateAsync({
                                    organizationId,
                                    schoolId,
                                    id: subscription.id,
                                  });
                                  await Promise.all([
                                    utils.fees.subscription.list.invalidate(),
                                    utils.fees.matrix.list.invalidate(),
                                    utils.fees.installment.dues.invalidate(),
                                  ]);
                                  setNotice({
                                    tone: "positive",
                                    message: copy.fees.setup.services.cancelled,
                                  });
                                } catch (cause) {
                                  setNotice({
                                    tone: "critical",
                                    message: toFriendlyError(cause).message,
                                  });
                                }
                              })();
                            },
                          },
                        ],
                      );
                    }}
                  />
                ))}
              </Card>
            )}
          </View>

          <View style={styles.section}>
            <SectionHead
              title={copy.fees.setup.services.openingTitle}
              hint={copy.fees.setup.services.openingHint}
            >
              {canCreate ? (
                <CapsuleButton
                  title={copy.fees.setup.services.addOpening}
                  icon="add"
                  variant="secondary"
                  size="mini"
                  onPress={() => setSheet("opening")}
                  testID="fee-services-add-opening"
                />
              ) : null}
            </SectionHead>

            {openings.isError ? (
              <ErrorCard
                cause={openings.error}
                onRetry={() => void openings.refetch()}
                testID="fee-services-openings-error"
              />
            ) : openings.isPending && !openings.data ? (
              <Skeleton height={100} />
            ) : openingRows.length === 0 ? (
              <ThemedText variant="meta" style={styles.emptyLine}>
                {copy.fees.setup.services.noOpening}
              </ThemedText>
            ) : (
              <Card padless>
                {openingRows.map((balance, index) => (
                  <OpeningRow
                    key={balance.id}
                    balance={balance}
                    originName={
                      yearNames.get(balance.originAcademicYearId) ?? "—"
                    }
                    first={index === 0}
                  />
                ))}
              </Card>
            )}

            <ThemedText variant="caption" style={styles.hint}>
              {copy.fees.setup.services.openingReadOnly}
            </ThemedText>
          </View>

          {sheet === "subscribe" ? (
            <SubscribeSheet
              studentId={selected.id}
              academicYearId={academicYear.id}
              organizationId={organizationId}
              schoolId={schoolId}
              heads={optionalHeads}
              assignmentId={assignment.data?.id ?? null}
              canGenerate={canGenerate}
              onClose={() => setSheet(null)}
              onDone={closeSheet}
            />
          ) : null}

          {sheet === "opening" ? (
            <OpeningSheet
              studentId={selected.id}
              academicYearId={academicYear.id}
              organizationId={organizationId}
              schoolId={schoolId}
              originYears={originYears}
              onClose={() => setSheet(null)}
              onDone={closeSheet}
            />
          ) : null}
        </>
      )}
    </View>,
  );
}

function SubscriptionRow({
  subscription,
  headName,
  first,
  canCancel,
  onCancel,
}: {
  subscription: Subscription;
  headName: string;
  first: boolean;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const active = subscription.status === "active";
  const period = copy.fees.setup.services.fromTo(
    formatReadableDate(subscription.subscribedFrom),
    subscription.subscribedTo
      ? formatReadableDate(subscription.subscribedTo)
      : null,
  );

  return (
    <View
      style={[styles.row, first ? null : styles.divider]}
      accessible
      accessibilityLabel={[
        headName,
        subscription.serviceDetail,
        copy.fees.setup.services.monthlyLabel(
          formatMoney(subscription.monthlyAmount),
        ),
        period,
        active
          ? copy.fees.setup.services.activePill
          : copy.fees.setup.services.cancelledPill,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {headName}
        </ThemedText>
        {subscription.serviceDetail ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {subscription.serviceDetail}
          </ThemedText>
        ) : null}
        <ThemedText variant="caption" numberOfLines={1}>
          {copy.fees.setup.services.monthlyLabel(
            formatMoney(subscription.monthlyAmount),
          )}{" "}
          · {period}
        </ThemedText>
      </View>
      <View style={styles.rowTrailing}>
        <StatusPill
          label={
            active
              ? copy.fees.setup.services.activePill
              : copy.fees.setup.services.cancelledPill
          }
          tone={active ? "positive" : "neutral"}
        />
        {active && canCancel ? (
          <CapsuleButton
            title={copy.fees.setup.services.cancelAction}
            variant="destructive"
            size="mini"
            onPress={onCancel}
            testID={`fee-services-cancel-${subscription.id}`}
          />
        ) : null}
      </View>
    </View>
  );
}

function OpeningRow({
  balance,
  originName,
  first,
}: {
  balance: OpeningBalance;
  originName: string;
  first: boolean;
}) {
  const status =
    copy.fees.setup.services.statuses[
      balance.status as keyof typeof copy.fees.setup.services.statuses
    ] ?? balance.status;
  const paid = isPositiveMoney(balance.paidAmount);

  return (
    <View
      style={[styles.row, first ? null : styles.divider]}
      accessible
      accessibilityLabel={[
        formatMoney(balance.amount),
        copy.fees.setup.services.originOf(originName),
        status,
        balance.description,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {formatMoney(balance.amount)}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {copy.fees.setup.services.originOf(originName)}
        </ThemedText>
        {paid ? (
          <ThemedText variant="caption" numberOfLines={1}>
            {copy.fees.setup.services.paidOf(
              formatMoney(balance.paidAmount),
              formatMoney(balance.amount),
            )}
          </ThemedText>
        ) : balance.description ? (
          <ThemedText variant="caption" numberOfLines={1}>
            {balance.description}
          </ThemedText>
        ) : null}
      </View>
      <StatusPill
        label={status}
        tone={
          balance.status === "paid"
            ? "positive"
            : balance.status === "waived"
              ? "neutral"
              : "caution"
        }
      />
    </View>
  );
}

function SubscribeSheet({
  studentId,
  academicYearId,
  organizationId,
  schoolId,
  heads,
  assignmentId,
  canGenerate,
  onClose,
  onDone,
}: {
  studentId: string;
  academicYearId: string;
  organizationId: string;
  schoolId: string;
  heads: Head[];
  assignmentId: string | null;
  canGenerate: boolean;
  onClose: () => void;
  onDone: (done: Done | null) => void;
}) {
  const [feeHeadId, setFeeHeadId] = useState<string | null>(null);
  const [serviceDetail, setServiceDetail] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [subscribedFrom, setSubscribedFrom] = useState(todayIso());
  const [hasEnd, setHasEnd] = useState(false);
  const [subscribedTo, setSubscribedTo] = useState(todayIso());
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = trpc.fees.subscription.create.useMutation();
  const generate = trpc.fees.assignment.generateInstallments.useMutation();
  const utils = trpc.useUtils();

  const pending = create.isPending || generate.isPending;
  const headName = heads.find((head) => head.id === feeHeadId)?.name ?? null;
  const monthly = parseMoney(monthlyAmount);
  const annual = parseMoney(annualAmount);

  const headError =
    submitted && !feeHeadId ? copy.fees.setup.services.headRequired : undefined;
  const monthlyError =
    submitted && (monthly === null || monthly <= 0n)
      ? copy.fees.setup.services.amountError
      : undefined;
  const annualError =
    submitted && (annual === null || annual <= 0n)
      ? copy.fees.setup.services.amountError
      : undefined;
  const dateError =
    submitted && hasEnd && subscribedTo < subscribedFrom
      ? copy.fees.setup.services.dateError
      : undefined;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (!feeHeadId) return;
    if (monthly === null || monthly <= 0n) return;
    if (annual === null || annual <= 0n) return;
    if (hasEnd && subscribedTo < subscribedFrom) return;

    try {
      await create.mutateAsync({
        organizationId,
        schoolId,
        data: {
          studentId,
          academicYearId,
          feeHeadId,
          serviceDetail:
            serviceDetail.trim().length > 0 ? serviceDetail.trim() : null,
          monthlyAmount,
          annualAmount,
          subscribedFrom,
          subscribedTo: hasEnd ? subscribedTo : null,
        },
      });

      let done: Done = {
        tone: "positive",
        message: copy.fees.setup.services.subscribedNotBilled,
      };

      if (assignmentId && canGenerate) {
        try {
          await generate.mutateAsync({
            organizationId,
            schoolId,
            id: assignmentId,
          });
          done = {
            tone: "positive",
            message: copy.fees.setup.services.subscribedBilled,
          };
        } catch {
          done = {
            tone: "caution",
            message: copy.fees.setup.services.subscribedGenerateFailed,
          };
        }
      }

      await Promise.all([
        utils.fees.subscription.list.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.installment.dues.invalidate(),
      ]);
      onDone(done);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={copy.fees.setup.services.subscriptionSheetTitle}
      onClose={onClose}
      testIDPrefix="fee-subscribe-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.fees.setup.services.subscribe}
            icon="check"
            size="compact"
            loading={pending}
            onPress={() => void submit()}
            testID="fee-subscribe-save"
          />
        </View>
      }
    >
      {heads.length === 0 ? (
        <Notice
          tone="caution"
          message={copy.fees.setup.services.headEmpty}
          testID="fee-subscribe-no-heads"
        />
      ) : null}

      <SelectField
        label={copy.fees.setup.services.headLabel}
        valueLabel={headName}
        placeholder={copy.fees.setup.services.headPlaceholder}
        options={heads.map((head) => ({ id: head.id, label: head.name }))}
        currentId={feeHeadId ?? ""}
        onSelect={setFeeHeadId}
        error={headError}
        testID="fee-subscribe-head"
      />

      <FormField
        label={copy.fees.setup.services.detailLabel}
        value={serviceDetail}
        onChangeText={setServiceDetail}
        placeholder={copy.fees.setup.services.detailPlaceholder}
        maxLength={255}
        testID="fee-subscribe-detail"
      />

      <FormField
        label={copy.fees.setup.services.monthlyAmountLabel}
        value={monthlyAmount}
        onChangeText={(next) => setMonthlyAmount(sanitizeAmountInput(next))}
        placeholder="1500"
        keyboardType="decimal-pad"
        error={monthlyError}
        maxLength={10}
        testID="fee-subscribe-monthly"
      />

      <FormField
        label={copy.fees.setup.services.annualAmountLabel}
        value={annualAmount}
        onChangeText={(next) => setAnnualAmount(sanitizeAmountInput(next))}
        placeholder="18000"
        keyboardType="decimal-pad"
        error={annualError}
        maxLength={10}
        testID="fee-subscribe-annual"
      />

      <DateField
        label={copy.fees.setup.services.fromLabel}
        value={subscribedFrom}
        onChange={setSubscribedFrom}
        testID="fee-subscribe-from"
      />

      <SwitchRow
        label={copy.fees.setup.services.toLabel}
        value={hasEnd}
        onChange={setHasEnd}
        help={copy.fees.setup.services.toHelp}
        testID="fee-subscribe-has-end"
      />

      {hasEnd ? (
        <DateField
          label={copy.fees.setup.services.toLabel}
          value={subscribedTo}
          onChange={setSubscribedTo}
          error={dateError}
          minimumDate={subscribedFrom}
          testID="fee-subscribe-to"
        />
      ) : null}

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-subscribe-error"
        />
      ) : null}
    </FormSheet>
  );
}

function OpeningSheet({
  studentId,
  academicYearId,
  organizationId,
  schoolId,
  originYears,
  onClose,
  onDone,
}: {
  studentId: string;
  academicYearId: string;
  organizationId: string;
  schoolId: string;
  originYears: Year[];
  onClose: () => void;
  onDone: (done: Done | null) => void;
}) {
  const [originId, setOriginId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const record = trpc.fees.ledger.recordOpeningBalance.useMutation();
  const utils = trpc.useUtils();

  const parsed = parseMoney(amount);
  const originName =
    originYears.find((year) => year.id === originId)?.name ?? null;

  const originError =
    submitted && !originId
      ? copy.fees.setup.services.originRequired
      : undefined;
  const amountError =
    submitted && (parsed === null || parsed <= 0n)
      ? copy.fees.setup.services.openingAmountError
      : undefined;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (!originId) return;
    if (parsed === null || parsed <= 0n) return;

    try {
      await record.mutateAsync({
        organizationId,
        schoolId,
        data: {
          studentId,
          academicYearId,
          originAcademicYearId: originId,
          amount,
          description:
            description.trim().length > 0 ? description.trim() : null,
        },
      });
      await Promise.all([
        utils.fees.ledger.listOpeningBalances.invalidate(),
        utils.fees.ledger.list.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.installment.dues.invalidate(),
      ]);
      onDone({
        tone: "positive",
        message: copy.fees.setup.services.recorded,
      });
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={copy.fees.setup.services.openingSheetTitle}
      onClose={onClose}
      testIDPrefix="fee-opening-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.fees.setup.services.recordBalance}
            icon="check"
            size="compact"
            loading={record.isPending}
            onPress={() => void submit()}
            testID="fee-opening-save"
          />
        </View>
      }
    >
      {originYears.length === 0 ? (
        <Notice
          tone="caution"
          message={copy.fees.setup.services.originNone}
          testID="fee-opening-no-origin"
        />
      ) : null}

      <SelectField
        label={copy.fees.setup.services.originLabel}
        valueLabel={originName}
        placeholder={copy.fees.setup.services.originPlaceholder}
        options={originYears.map((year) => ({
          id: year.id,
          label: year.name,
        }))}
        currentId={originId ?? ""}
        onSelect={setOriginId}
        error={originError}
        testID="fee-opening-origin"
      />

      <FormField
        label={copy.fees.setup.services.amountLabel}
        value={amount}
        onChangeText={(next) => setAmount(sanitizeAmountInput(next))}
        placeholder="12000"
        keyboardType="decimal-pad"
        error={amountError}
        maxLength={10}
        testID="fee-opening-amount"
      />

      <FormField
        label={copy.fees.setup.services.descriptionLabel}
        value={description}
        onChangeText={setDescription}
        placeholder={copy.fees.setup.services.descriptionPlaceholder}
        maxLength={255}
        testID="fee-opening-description"
      />

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-opening-error"
        />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
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
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  emptyLine: {
    paddingHorizontal: spacing.xs,
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
