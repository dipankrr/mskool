import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing, touch } from "../../theme/tokens";
import { SectionHead } from "./status";

type Structure =
  inferRouterOutputs<AppRouter>["fees"]["structure"]["list"][number];
type InstallmentMode = "upfront" | "term_wise" | "monthly";

const MODE_ORDER: InstallmentMode[] = ["term_wise", "monthly", "upfront"];

/**
 * Each class's bill for the session (Step 5E).
 *
 * A structure is a template, not a bill: it names the class and how the year
 * splits, and its lines say which heads apply for how much. Assigning it to a
 * student is what creates installments. Retired structures stay in history
 * (the toggle asks the server for them) but can no longer be assigned.
 */
export function FeeStructuresScreen() {
  const { organizationId, schoolId, academicYear, ready, yearPending } =
    useActiveContext();
  const { has } = usePermissions();

  const canRead = has("fee_structure:read");
  const canCreate = has("fee_structure:create");
  const canReadClasses = has("class:read");

  const [showRetired, setShowRetired] = useState(false);
  const [sheet, setSheet] = useState<
    { mode: "create" } | { mode: "edit"; structure: Structure } | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = trpc.fees.structure.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      // One read, filtered locally: the toggle then answers instantly and the
      // "everything here is retired" empty state can tell the truth.
      includeHistory: true,
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
      staleTime: 60_000,
    },
  );

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled: ready && canReadClasses && Boolean(organizationId),
      staleTime: 5 * 60_000,
    },
  );

  const all = list.data ?? [];
  const visible = showRetired ? all : all.filter((row) => row.isActive);
  const retiredCount = all.filter((row) => !row.isActive).length;
  const classNames = new Map(
    (classes.data ?? []).map((row) => [row.id, row.name] as const),
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.setup.structures.title}
      meta={list.data ? copy.fees.setup.structures.meta(all.length) : null}
      backAccessibilityLabel={copy.common.back}
      action={
        canCreate && canReadClasses
          ? {
              label: copy.fees.setup.structures.add,
              icon: "add",
              onPress: () => setSheet({ mode: "create" }),
              testID: "fee-structures-add",
            }
          : undefined
      }
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="fee-structures-title"
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
        testID="fee-structures-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={84} />
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
        testID="fee-structures-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.ledger.noYearTitle}
        message={copy.fees.ledger.noYearBody}
        testID="fee-structures-no-year"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="fee-structures-error"
      />,
    );
  }

  if (list.isPending && !list.data) {
    return frame(
      <View style={styles.skeletons}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={84} />
        ))}
      </View>,
    );
  }

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice
          tone="positive"
          message={notice}
          testID="fee-structures-notice"
        />
      ) : null}

      {all.length === 0 ? (
        <EmptyState
          icon="stack"
          title={copy.fees.setup.structures.emptyTitle}
          message={copy.fees.setup.structures.emptyBody}
          testID="fee-structures-empty"
        >
          {canCreate && canReadClasses ? (
            <CapsuleButton
              title={copy.fees.setup.structures.add}
              icon="add"
              variant="secondary"
              size="compact"
              onPress={() => setSheet({ mode: "create" })}
              testID="fee-structures-empty-add"
            />
          ) : null}
        </EmptyState>
      ) : (
        <>
          <SwitchRow
            label={copy.fees.setup.structures.showRetired}
            value={showRetired}
            onChange={setShowRetired}
            help={
              retiredCount > 0
                ? copy.fees.setup.structures.retiredCount(retiredCount)
                : undefined
            }
            testID="fee-structures-show-retired"
          />

          {visible.length === 0 ? (
            <EmptyState
              icon="stack"
              title={copy.fees.setup.structures.emptyActiveTitle}
              message={copy.fees.setup.structures.emptyActiveBody}
              testID="fee-structures-empty-active"
            />
          ) : (
            <>
              <SectionHead
                title={copy.fees.setup.structures.title}
                hint={copy.fees.setup.structures.meta(visible.length)}
              />
              <Card padless>
                {visible.map((structure, index) => (
                  <StructureRow
                    key={structure.id}
                    structure={structure}
                    className={
                      classNames.get(structure.classId) ??
                      copy.fees.setup.structures.classNameUnknown
                    }
                    first={index === 0}
                    onPress={() =>
                      router.push({
                        pathname: "/fees/setup/structures/[structureId]",
                        params: {
                          structureId: structure.id,
                          className:
                            classNames.get(structure.classId) ??
                            copy.fees.setup.structures.classNameUnknown,
                        },
                      })
                    }
                  />
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {sheet ? (
        <StructureSheet
          mode={sheet.mode}
          structure={sheet.mode === "edit" ? sheet.structure : undefined}
          organizationId={organizationId}
          schoolId={schoolId}
          academicYearId={academicYear.id}
          classOptions={(classes.data ?? []).map((row) => ({
            id: row.id,
            label: row.name,
          }))}
          onClose={() => setSheet(null)}
          onCreated={(created) => {
            setSheet(null);
            router.push({
              pathname: "/fees/setup/structures/[structureId]",
              params: { structureId: created.id },
            });
          }}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}
    </View>,
  );
}

function StructureRow({
  structure,
  className,
  first,
  onPress,
}: {
  structure: Structure;
  className: string;
  first: boolean;
  onPress: () => void;
}) {
  const mode =
    copy.fees.setup.structures.modes[
      structure.installmentMode as InstallmentMode
    ] ?? structure.installmentMode;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        structure.name,
        className,
        mode,
        structure.isActive ? null : copy.fees.setup.structures.inactivePill,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`fee-structure-row-${structure.id}`}
    >
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {structure.name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {className} · {mode}
        </ThemedText>
      </View>
      {structure.isActive ? null : (
        <StatusPill
          label={copy.fees.setup.structures.inactivePill}
          tone="neutral"
        />
      )}
      <AppIcon name="chevronRight" size={18} color={colors.muted} />
    </Pressable>
  );
}

function StructureSheet({
  mode,
  structure,
  organizationId,
  schoolId,
  academicYearId,
  classOptions,
  onClose,
  onCreated,
  onDone,
}: {
  mode: "create" | "edit";
  structure?: Structure;
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  classOptions: { id: string; label: string }[];
  onClose: () => void;
  onCreated: (structure: Structure) => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(structure?.name ?? "");
  const [classId, setClassId] = useState<string | null>(
    structure?.classId ?? null,
  );
  const [installmentMode, setInstallmentMode] = useState<InstallmentMode>(
    (structure?.installmentMode as InstallmentMode | undefined) ?? "term_wise",
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = trpc.fees.structure.create.useMutation();
  const update = trpc.fees.structure.update.useMutation();
  const utils = trpc.useUtils();

  const pending = create.isPending || update.isPending;
  const nameError =
    submitted && name.trim().length === 0
      ? copy.fees.setup.structures.nameRequired
      : undefined;
  const classError =
    submitted && mode === "create" && !classId
      ? copy.fees.setup.structures.classRequired
      : undefined;

  const className = classId
    ? (classOptions.find((row) => row.id === classId)?.label ?? null)
    : null;

  const invalidate = async () => {
    await Promise.all([
      utils.fees.structure.list.invalidate(),
      utils.fees.structure.byId.invalidate(),
    ]);
  };

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (name.trim().length === 0) return;
    if (mode === "create" && !classId) return;

    try {
      if (mode === "create" && classId) {
        const created = await create.mutateAsync({
          organizationId,
          schoolId,
          data: {
            name: name.trim(),
            academicYearId,
            classId,
            installmentMode,
          },
        });
        await invalidate();
        onCreated(created);
        return;
      }
      if (structure) {
        await update.mutateAsync({
          organizationId,
          schoolId,
          id: structure.id,
          data: { name: name.trim(), installmentMode },
        });
        await invalidate();
        onDone(copy.fees.setup.structures.updated);
      }
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={
        mode === "create"
          ? copy.fees.setup.structures.createTitle
          : copy.fees.setup.structures.editTitle
      }
      onClose={onClose}
      testIDPrefix="fee-structure-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.fees.setup.structures.save}
            icon="check"
            size="compact"
            loading={pending}
            onPress={() => void submit()}
            testID="fee-structure-save"
          />
        </View>
      }
    >
      <FormField
        label={copy.fees.setup.structures.nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={copy.fees.setup.structures.namePlaceholder}
        error={nameError}
        maxLength={150}
        testID="fee-structure-name"
      />

      <SelectField
        label={copy.fees.setup.structures.classLabel}
        valueLabel={className}
        placeholder={copy.fees.setup.structures.classPlaceholder}
        options={classOptions}
        currentId={classId ?? ""}
        onSelect={setClassId}
        error={classError}
        help={
          mode === "edit" ? copy.fees.setup.structures.classLocked : undefined
        }
        disabled={mode === "edit"}
        testID="fee-structure-class"
      />

      <ChoicePills
        label={copy.fees.setup.structures.modeLabel}
        value={installmentMode}
        options={MODE_ORDER.map((value) => ({
          value,
          label: copy.fees.setup.structures.modes[value],
        }))}
        onChange={setInstallmentMode}
        help={copy.fees.setup.structures.modeHelp}
        testIDPrefix="fee-structure-mode"
      />

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-structure-sheet-error"
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
    alignItems: "center",
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
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
