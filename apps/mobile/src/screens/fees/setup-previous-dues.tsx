import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import { feesCopy } from "../../lib/fees-copy";
import { formatMoney, parseMoney, sanitizeAmountInput } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";

const words = feesCopy.setup.previousDues;

/**
 * Previous dues, one class at a time: what students already owed before this.
 * Most rows stay empty, so it reads as a list of exceptions. A student who
 * already has an entry shows it instead of a box; correcting one means cancelling
 * it first, so a wrong amount can't quietly be typed over.
 */
export function PreviousDuesScreen() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();
  const canWrite = has("fee_structure:create") && sessionOpen;

  const [classId, setClassId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ tone: "positive" | "caution"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const yearId = academicYear?.id ?? "";
  const enabled = ready && Boolean(organizationId) && Boolean(yearId);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled },
  );
  const students = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: yearId,
      classId: classId ?? undefined,
    },
    { enabled: enabled && Boolean(classId) },
  );
  const existing = trpc.fees.ledger.listOpeningBalances.useQuery(
    { organizationId: organizationId ?? "", academicYearId: yearId },
    { enabled },
  );
  const record = trpc.fees.ledger.recordOpeningBalance.useMutation();
  const utils = trpc.useUtils();

  const entered = Object.entries(amounts).filter(([, value]) => value.trim().length > 0);
  const invalid = entered.some(([, value]) => {
    const parsed = parseMoney(value);
    return parsed === null || parsed <= 0n;
  });
  const existingByStudent = new Map(
    (existing.data ?? []).map((row) => [row.studentId, row.amount]),
  );

  const saveAll = async () => {
    if (invalid || !schoolId || !organizationId) return;
    setSaving(true);
    setResult(null);
    let saved = 0;
    let failed = 0;
    for (const [studentId, amount] of entered) {
      try {
        await record.mutateAsync({
          organizationId,
          schoolId,
          data: { studentId, academicYearId: yearId, amount },
        });
        saved += 1;
      } catch {
        failed += 1;
      }
    }
    await Promise.all([
      utils.fees.ledger.listOpeningBalances.invalidate(),
      utils.fees.dashboard.invalidate(),
    ]);
    setAmounts({});
    setSaving(false);
    setResult({
      tone: failed > 0 ? "caution" : "positive",
      message: [words.saved(saved), failed > 0 ? words.failed(failed) : null]
        .filter(Boolean)
        .join(" "),
    });
  };

  return (
    <ScreenFrame
      title={words.title}
      meta={words.meta}
      backAccessibilityLabel={copy.common.back}
      titleTestID="fee-previous-title"
      footer={
        canWrite && entered.length > 0 ? (
          <CapsuleButton
            title={words.save(entered.length)}
            icon="check"
            loading={saving}
            disabled={invalid}
            onPress={() => void saveAll()}
            testID="fee-previous-save"
          />
        ) : undefined
      }
    >
      <View style={styles.body}>
        <ThemedText variant="meta">{words.intro}</ThemedText>
        {result ? (
          <Notice tone={result.tone} message={result.message} testID="fee-previous-result" />
        ) : null}
        {invalid ? (
          <Notice tone="caution" message={words.invalid} testID="fee-previous-invalid" />
        ) : null}
        <SelectField
          label={words.classLabel}
          valueLabel={classes.data?.find((row) => row.id === classId)?.name ?? null}
          placeholder={words.classPlaceholder}
          options={(classes.data ?? []).map((row) => ({ id: row.id, label: row.name }))}
          currentId={classId ?? ""}
          onSelect={setClassId}
          testID="fee-previous-class"
        />

        {!classId ? null : students.isError ? (
          <ErrorCard
            cause={students.error}
            onRetry={() => void students.refetch()}
            testID="fee-previous-error"
          />
        ) : students.isPending ? (
          <Skeleton height={200} />
        ) : (students.data?.length ?? 0) === 0 ? (
          <EmptyState icon="students" title={words.empty} testID="fee-previous-empty" />
        ) : (
          <Card padless>
            {students.data?.map(({ student }, index) => {
              const already = existingByStudent.get(student.id);
              return (
                <View
                  key={student.id}
                  style={[styles.row, index === 0 ? null : styles.divider]}
                >
                  <View style={styles.who}>
                    <ThemedText variant="bodyStrong" numberOfLines={1}>
                      {[student.firstName, student.lastName].filter(Boolean).join(" ")}
                    </ThemedText>
                    <ThemedText variant="meta" numberOfLines={1}>
                      {already
                        ? words.already(formatMoney(already))
                        : student.admissionNumber}
                    </ThemedText>
                  </View>
                  {already || !canWrite ? null : (
                    <TextInput
                      value={amounts[student.id] ?? ""}
                      onChangeText={(value) =>
                        setAmounts((current) => ({
                          ...current,
                          [student.id]: sanitizeAmountInput(value),
                        }))
                      }
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${words.title}: ${student.firstName}`}
                      style={styles.input}
                      testID={`fee-previous-${student.id}`}
                    />
                  )}
                </View>
              );
            })}
          </Card>
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  who: {
    flex: 1,
    gap: 2,
  },
  input: {
    width: 110,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    color: colors.ink,
    textAlign: "right",
    fontSize: fontSize.callout,
    fontFamily: fontFamily.regular,
  },
});
