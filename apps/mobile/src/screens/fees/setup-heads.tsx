import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  formatAmountDigits,
  parseMoney,
  sanitizeAmountInput,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing, touch } from "../../theme/tokens";
import { FactChip, SectionHead } from "./status";

type Head = inferRouterOutputs<AppRouter>["fees"]["head"]["list"][number];
type HeadCategory = "regular" | "one_time" | "optional" | "fine";

const CATEGORY_ORDER: HeadCategory[] = [
  "regular",
  "one_time",
  "optional",
  "fine",
];

/**
 * The school's fee vocabulary (Step 5E). A head is what a bill line names —
 * Tuition, Transport, Lab — and every structure is built from these.
 *
 * Heads are retired, never deleted: old bills and ledger rows keep pointing
 * at the row forever. `head.list` returns active heads only, so a retired
 * head simply leaves this screen while its history stays intact.
 */
export function FeeHeadsScreen() {
  const { organizationId, schoolId, ready, yearPending } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("fee_head:read");
  const canCreate = has("fee_head:create");
  const canUpdate = has("fee_head:update");

  const [sheet, setSheet] = useState<
    { mode: "create" } | { mode: "edit"; head: Head } | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = trpc.fees.head.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: ready && canRead && Boolean(organizationId) },
  );

  const heads = list.data ?? [];

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.setup.heads.title}
      meta={list.data ? copy.fees.setup.heads.meta(heads.length) : null}
      backAccessibilityLabel={copy.common.back}
      action={
        canCreate
          ? {
              label: copy.fees.setup.heads.add,
              icon: "add",
              onPress: () => setSheet({ mode: "create" }),
              testID: "fee-heads-add",
            }
          : undefined
      }
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="fee-heads-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.setup.deniedTitle}
        message={copy.fees.setup.deniedBody}
        testID="fee-heads-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={76} />
        ))}
      </View>,
    );
  }

  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-heads-no-branch"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="fee-heads-error"
      />,
    );
  }

  if (list.isPending && !list.data) {
    return frame(
      <View style={styles.skeletons}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={76} />
        ))}
      </View>,
    );
  }

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice tone="positive" message={notice} testID="fee-heads-notice" />
      ) : null}

      {heads.length === 0 ? (
        <EmptyState
          icon="fees"
          title={copy.fees.setup.heads.emptyTitle}
          message={copy.fees.setup.heads.emptyBody}
          testID="fee-heads-empty"
        >
          {canCreate ? (
            <CapsuleButton
              title={copy.fees.setup.heads.add}
              icon="add"
              variant="secondary"
              size="compact"
              onPress={() => setSheet({ mode: "create" })}
              testID="fee-heads-empty-add"
            />
          ) : null}
        </EmptyState>
      ) : (
        <>
          <SectionHead
            title={copy.fees.setup.heads.title}
            hint={copy.fees.setup.heads.meta(heads.length)}
          />
          <Card padless>
            {heads.map((head, index) => (
              <HeadRow
                key={head.id}
                head={head}
                first={index === 0}
                onPress={
                  canUpdate ? () => setSheet({ mode: "edit", head }) : undefined
                }
              />
            ))}
          </Card>
          {canUpdate ? (
            <ThemedText variant="caption" style={styles.hint}>
              {copy.fees.setup.heads.categoryHelp}
            </ThemedText>
          ) : null}
        </>
      )}

      {sheet ? (
        <HeadSheet
          mode={sheet.mode}
          head={sheet.mode === "edit" ? sheet.head : undefined}
          organizationId={organizationId}
          schoolId={schoolId}
          canRetire={canUpdate}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}
    </View>,
  );
}

function HeadRow({
  head,
  first,
  onPress,
}: {
  head: Head;
  first: boolean;
  onPress?: () => void;
}) {
  const category = head.category as HeadCategory;
  const tax = parseMoney(head.taxPercentage);
  const row = (
    <>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {head.name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {[
            head.shortCode,
            copy.fees.setup.heads.categories[category] ??
              copy.fees.setup.heads.categories.regular,
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
        {head.description ? (
          <ThemedText variant="caption" numberOfLines={2}>
            {head.description}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.rowTrailing}>
        {head.isTaxable ? (
          <FactChip
            label={
              tax !== null && head.taxPercentage
                ? `${copy.fees.setup.heads.taxableChip} · ${formatAmountDigits(head.taxPercentage)}%`
                : copy.fees.setup.heads.taxableChip
            }
            tone="caution"
          />
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, first ? null : styles.divider]}>{row}</View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={head.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`fee-head-row-${head.id}`}
    >
      {row}
    </Pressable>
  );
}

function HeadSheet({
  mode,
  head,
  organizationId,
  schoolId,
  canRetire,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  head?: Head;
  organizationId: string;
  schoolId: string;
  canRetire: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(head?.name ?? "");
  const [shortCode, setShortCode] = useState(head?.shortCode ?? "");
  const [description, setDescription] = useState(head?.description ?? "");
  const [category, setCategory] = useState<HeadCategory>(
    (head?.category as HeadCategory | undefined) ?? "regular",
  );
  const [isTaxable, setIsTaxable] = useState(head?.isTaxable ?? false);
  const [tax, setTax] = useState(
    head?.taxPercentage ? head.taxPercentage.replace(/\.00$/, "") : "",
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = trpc.fees.head.create.useMutation();
  const update = trpc.fees.head.update.useMutation();
  const deactivate = trpc.fees.head.deactivate.useMutation();
  const utils = trpc.useUtils();

  const pending = create.isPending || update.isPending || deactivate.isPending;

  const taxValue = parseMoney(tax);
  const nameError =
    submitted && name.trim().length === 0
      ? copy.fees.setup.heads.nameRequired
      : undefined;
  const taxError =
    submitted &&
    isTaxable &&
    (taxValue === null || taxValue < 0n || taxValue > 10000n)
      ? copy.fees.setup.heads.taxError
      : undefined;

  const invalidate = async () => {
    await Promise.all([
      utils.fees.head.list.invalidate(),
      utils.fees.structure.list.invalidate(),
      utils.fees.structure.listLines.invalidate(),
      utils.fees.matrix.list.invalidate(),
      utils.fees.matrix.cell.invalidate(),
      utils.fees.installment.dues.invalidate(),
    ]);
  };

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (name.trim().length === 0) return;
    if (
      isTaxable &&
      (taxValue === null || taxValue < 0n || taxValue > 10000n)
    ) {
      return;
    }

    const data = {
      name: name.trim(),
      shortCode: shortCode.trim().length > 0 ? shortCode.trim() : null,
      description: description.trim().length > 0 ? description.trim() : null,
      category,
      isTaxable,
      taxPercentage: isTaxable ? tax.trim() : null,
    };

    try {
      if (mode === "create") {
        await create.mutateAsync({ organizationId, schoolId, data });
      } else if (head) {
        await update.mutateAsync({
          organizationId,
          schoolId,
          id: head.id,
          data,
        });
      }
      await invalidate();
      onDone(
        mode === "create"
          ? copy.fees.setup.heads.created
          : copy.fees.setup.heads.updated,
      );
    } catch (cause) {
      setError(cause);
    }
  };

  const retire = () => {
    if (!head) return;
    Alert.alert(
      copy.fees.setup.heads.retireTitle,
      copy.fees.setup.heads.retireBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.fees.setup.heads.retireConfirm,
          style: "destructive",
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                await deactivate.mutateAsync({
                  organizationId,
                  schoolId,
                  id: head.id,
                });
                await invalidate();
                onDone(copy.fees.setup.heads.retired);
              } catch (cause) {
                setError(cause);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <FormSheet
      title={
        mode === "create"
          ? copy.fees.setup.heads.createTitle
          : copy.fees.setup.heads.editTitle
      }
      onClose={onClose}
      testIDPrefix="fee-head-sheet"
      footer={
        <View style={styles.sheetFooter}>
          {mode === "edit" && canRetire ? (
            <CapsuleButton
              title={copy.fees.setup.heads.retireAction}
              variant="destructive"
              size="compact"
              onPress={retire}
              disabled={pending}
              testID="fee-head-retire"
            />
          ) : null}
          <CapsuleButton
            title={copy.fees.setup.heads.save}
            icon="check"
            size="compact"
            loading={pending}
            onPress={() => void submit()}
            testID="fee-head-save"
          />
        </View>
      }
    >
      <FormField
        label={copy.fees.setup.heads.nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={copy.fees.setup.heads.namePlaceholder}
        error={nameError}
        maxLength={150}
        testID="fee-head-name"
      />
      <FormField
        label={copy.fees.setup.heads.shortCodeLabel}
        value={shortCode}
        onChangeText={setShortCode}
        placeholder={copy.fees.setup.heads.shortCodePlaceholder}
        help={copy.fees.setup.heads.shortCodeHelp}
        autoCapitalize="characters"
        maxLength={20}
        testID="fee-head-short-code"
      />
      <ChoicePills
        label={copy.fees.setup.heads.categoryLabel}
        value={category}
        options={CATEGORY_ORDER.map((value) => ({
          value,
          label: copy.fees.setup.heads.categories[value],
        }))}
        onChange={setCategory}
        help={copy.fees.setup.heads.categoryHelp}
        testIDPrefix="fee-head-category"
      />
      <SwitchRow
        label={copy.fees.setup.heads.taxableLabel}
        value={isTaxable}
        onChange={setIsTaxable}
        help={copy.fees.setup.heads.taxableHelp}
        testID="fee-head-taxable"
      />
      {isTaxable ? (
        <FormField
          label={copy.fees.setup.heads.taxLabel}
          value={tax}
          onChangeText={(next) => setTax(sanitizeAmountInput(next))}
          placeholder={copy.fees.setup.heads.taxPlaceholder}
          keyboardType="decimal-pad"
          suffix="%"
          error={taxError}
          maxLength={6}
          testID="fee-head-tax"
        />
      ) : null}
      <FormField
        label={copy.fees.setup.heads.descriptionLabel}
        value={description}
        onChangeText={setDescription}
        placeholder={copy.fees.setup.heads.descriptionPlaceholder}
        multiline
        numberOfLines={3}
        maxLength={255}
        testID="fee-head-description"
      />

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-head-sheet-error"
        />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
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
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
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
