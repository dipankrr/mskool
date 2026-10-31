import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { moveItem, trimDecimal } from "../../lib/homework-questions";
import {
  checkCriterionDraft,
  checkRubricDraft,
  emptyCriterionDraft,
  emptyLevelDraft,
  emptyRubricDraft,
  firstRubricError,
  rubricCreatePayload,
  rubricFingerprint,
} from "../../lib/homework-settings";
import type {
  RubricCriterionCheck,
  RubricCriterionDraft,
  RubricDraft,
  RubricLevelDraft,
} from "../../lib/homework-settings";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConfirmSheet } from "./confirm-sheet";

/**
 * The rubric builder.
 *
 * A rubric is written in two layers: the rubric's own name and description,
 * then its criteria, each with its own levels. The sheet edits ONE criterion at
 * a time because a criterion plus three levels is already more fields than a
 * pushed screen should hold; the builder keeps the list and its order.
 *
 * Nothing is sent until Save: adding, editing, reordering and removing criteria
 * are all local draft operations, and the sheet says so. Save sends whole rows
 * (positions from list order), which is the create contract's shape — there is
 * no update endpoint, so a saved rubric is read-only apart from retire/restore.
 */
export function HomeworkRubricNewScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useBranchMeta();
  const { has } = usePermissions();

  const canWrite = has("school_settings:update");

  const [draft, setDraft] = useState<RubricDraft>(emptyRubricDraft);
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<
    "added" | "updated" | "removed" | null
  >(null);
  const [sheet, setSheet] = useState<{
    mode: "add" | "edit";
    criterion: RubricCriterionDraft;
  } | null>(null);
  const [removeKey, setRemoveKey] = useState<string | null>(null);

  const text = copy.homework.rubrics;
  const check = checkRubricDraft(draft);
  const initialFingerprint = useMemo(
    () => rubricFingerprint(emptyRubricDraft()),
    [],
  );
  const dirty = rubricFingerprint(draft) !== initialFingerprint;

  useUnsavedChanges(canWrite && !createdId && dirty);

  const utils = trpc.useUtils();
  const create = trpc.homework.rubrics.create.useMutation({
    onSuccess: (data) => {
      setSaveError(null);
      void utils.homework.rubrics.list.invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedId(data.id);
    },
    onError: (error) => setSaveError(error),
  });

  useEffect(() => {
    if (!createdId) return;
    router.replace({
      pathname: "/homework/rubrics/[rubricId]",
      params: { rubricId: createdId, created: "1" },
    });
  }, [createdId]);

  const openAdd = () => {
    setLastAction(null);
    setSheet({ mode: "add", criterion: emptyCriterionDraft() });
  };

  const openEdit = (criterion: RubricCriterionDraft) => {
    setLastAction(null);
    setSheet({
      mode: "edit",
      criterion: {
        ...criterion,
        levels: criterion.levels.map((level) => ({ ...level })),
      },
    });
  };

  const saveCriterion = (next: RubricCriterionDraft) => {
    const mode = sheet?.mode ?? "add";
    setDraft((current) => ({
      ...current,
      criteria:
        mode === "edit"
          ? current.criteria.map((criterion) =>
              criterion.key === next.key ? next : criterion,
            )
          : [...current.criteria, next],
    }));
    setSheet(null);
    setTouched(false);
    setLastAction(mode === "edit" ? "updated" : "added");
  };

  const moveCriterion = (index: number, delta: number) => {
    void Haptics.selectionAsync();
    setDraft((current) => ({
      ...current,
      criteria: moveItem(current.criteria, index, delta),
    }));
    setLastAction(null);
  };

  const removeCriterion = () => {
    if (!removeKey) return;
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.filter((criterion) => criterion.key !== removeKey),
    }));
    setRemoveKey(null);
    setTouched(false);
    setLastAction("removed");
  };

  const removeTarget = draft.criteria.find(
    (criterion) => criterion.key === removeKey,
  );

  const submit = () => {
    setTouched(true);
    setLastAction(null);
    if (!checkRubricDraft(draft).valid) return;
    setSaveError(null);
    create.mutate({
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      ...rubricCreatePayload(draft),
    });
  };

  const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={text.newTitle}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-rubric-new-back"
      titleTestID="homework-rubric-new-title"
      footer={footer}
    >
      {children}
    </ScreenFrame>
  );

  if (!canWrite) {
    return frame(
      <EmptyState
        icon="shield"
        title={text.viewerTitle}
        message={text.viewerBody}
        testID="homework-rubric-new-denied"
      />,
    );
  }

  if (!ready) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={120} />
        <Skeleton height={200} />
      </View>,
    );
  }

  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.homework.settings.noBranchTitle}
        message={copy.homework.settings.noBranchBody}
        testID="homework-rubric-new-no-branch"
      />,
    );
  }

  const footer = (
    <>
      {saveError ? (
        <Notice
          tone="critical"
          title={text.saveError}
          message={errorMessage(saveError)}
          style={styles.footerNotice}
          testID="homework-rubric-new-save-error"
        />
      ) : null}
      {touched && !check.valid ? (
        <Notice
          tone="caution"
          title={text.checkTitle}
          message={firstRubricError(check) ?? text.criteriaError}
          style={styles.footerNotice}
          testID="homework-rubric-new-check"
        />
      ) : null}
      <CapsuleButton
        title={create.isPending ? text.saving : text.save}
        icon="check"
        onPress={submit}
        loading={create.isPending}
        disabled={create.isPending}
        testID="homework-rubric-new-save"
      />
    </>
  );

  return (
    <>
      {frame(
        <View style={styles.body}>
          <Notice
            tone="neutral"
            message={text.builderIntro}
            testID="homework-rubric-new-intro"
          />

          <SectionLabel>{text.details}</SectionLabel>
          <Card>
            <FormField
              label={text.name}
              value={draft.name}
              onChangeText={(next) =>
                setDraft((current) => ({ ...current, name: next }))
              }
              placeholder={text.namePlaceholder}
              help={text.nameHelp}
              error={touched ? check.errors.name : undefined}
              testID="homework-rubric-new-name"
            />
            <FormField
              label={text.description}
              value={draft.description}
              onChangeText={(next) =>
                setDraft((current) => ({ ...current, description: next }))
              }
              placeholder={text.descriptionPlaceholder}
              help={text.descriptionHelp}
              error={touched ? check.errors.description : undefined}
              multiline
              testID="homework-rubric-new-description"
            />
          </Card>

          <View style={styles.criteriaHead}>
            <SectionLabel>{text.criteria}</SectionLabel>
            <CapsuleButton
              title={text.addCriterion}
              icon="add"
              variant="secondary"
              size="compact"
              onPress={openAdd}
              testID="homework-rubric-new-add-criterion"
            />
          </View>

          {lastAction ? (
            <Notice
              tone="positive"
              message={
                lastAction === "added"
                  ? text.criterionAdded
                  : lastAction === "updated"
                    ? text.criterionUpdated
                    : text.criterionRemoved
              }
              testID="homework-rubric-new-last-action"
            />
          ) : null}

          {draft.criteria.length === 0 ? (
            <Notice
              tone="neutral"
              title={text.criteriaError}
              message={text.criteriaEmpty}
              testID="homework-rubric-new-empty"
            />
          ) : (
            <View style={styles.cards}>
              {draft.criteria.map((criterion, index) => (
                <CriterionCard
                  key={criterion.key}
                  criterion={criterion}
                  position={index}
                  first={index === 0}
                  last={index === draft.criteria.length - 1}
                  onEdit={() => openEdit(criterion)}
                  onMoveUp={() => moveCriterion(index, -1)}
                  onMoveDown={() => moveCriterion(index, 1)}
                  onRemove={() => {
                    setLastAction(null);
                    setRemoveKey(criterion.key);
                  }}
                />
              ))}
            </View>
          )}

          {touched && check.errors.criteria ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
            >
              {check.errors.criteria}
            </ThemedText>
          ) : null}
        </View>,
        footer,
      )}

      {sheet ? (
        <CriterionSheet
          mode={sheet.mode}
          initial={sheet.criterion}
          onSave={saveCriterion}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {removeTarget ? (
        <ConfirmSheet
          title={text.removeCriterionTitle}
          body={text.removeCriterionBody(removeTarget.name)}
          confirmLabel={text.removeCriterionConfirm}
          keepLabel={copy.homework.actions.keep}
          tone="destructive"
          submitting={false}
          error={null}
          onConfirm={removeCriterion}
          onClose={() => setRemoveKey(null)}
          testIDPrefix="homework-rubric-remove"
        />
      ) : null}
    </>
  );
}

function CriterionCard({
  criterion,
  position,
  first,
  last,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  criterion: RubricCriterionDraft;
  position: number;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const text = copy.homework.rubrics;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.position}>
          <ThemedText variant="caption" color={colors.accentDeep}>
            {position + 1}
          </ThemedText>
        </View>
        <ThemedText variant="name" numberOfLines={2} style={styles.cardName}>
          {criterion.name}
        </ThemedText>
      </View>

      {criterion.description.trim().length > 0 ? (
        <ThemedText variant="meta">{criterion.description}</ThemedText>
      ) : null}

      <View style={styles.levels}>
        {criterion.levels.map((level) => (
          <View key={level.key} style={styles.levelLine}>
            <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.levelName}>
              {level.label}
            </ThemedText>
            <ThemedText variant="caption" color={colors.muted}>
              {text.points(trimDecimal(level.points))}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <CardAction
          icon="edit"
          label={text.editCriterion}
          onPress={onEdit}
          testID={`homework-rubric-criterion-edit-${position}`}
        />
        <CardAction
          icon="chevronDown"
          label={text.moveDown}
          disabled={last}
          onPress={onMoveDown}
          testID={`homework-rubric-criterion-down-${position}`}
        />
        <CardAction
          icon="chevronDown"
          label={text.moveUp}
          disabled={first}
          onPress={onMoveUp}
          rotate
          testID={`homework-rubric-criterion-up-${position}`}
        />
        <CardAction
          icon="close"
          label={text.removeCriterion}
          tone="critical"
          onPress={onRemove}
          testID={`homework-rubric-criterion-remove-${position}`}
        />
      </View>
    </Card>
  );
}

function CriterionSheet({
  mode,
  initial,
  onSave,
  onClose,
}: {
  mode: "add" | "edit";
  initial: RubricCriterionDraft;
  onSave: (criterion: RubricCriterionDraft) => void;
  onClose: () => void;
}) {
  const text = copy.homework.rubrics;
  const [value, setValue] = useState<RubricCriterionDraft>(initial);
  const [touched, setTouched] = useState(false);
  const check = checkCriterionDraft(value);

  const updateLevel = (
    key: string,
    patch: Partial<RubricLevelDraft>,
  ) => {
    setValue((current) => ({
      ...current,
      levels: current.levels.map((level) =>
        level.key === key ? { ...level, ...patch } : level,
      ),
    }));
  };

  const moveLevel = (index: number, delta: number) => {
    void Haptics.selectionAsync();
    setValue((current) => ({
      ...current,
      levels: moveItem(current.levels, index, delta),
    }));
  };

  const removeLevel = (key: string) => {
    setValue((current) =>
      current.levels.length <= 1
        ? current
        : {
            ...current,
            levels: current.levels.filter((level) => level.key !== key),
          },
    );
  };

  const submit = () => {
    setTouched(true);
    if (!checkCriterionDraft(value).valid) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      ...value,
      name: value.name.trim(),
      description: value.description.trim(),
    });
  };

  return (
    <FormSheet
      title={mode === "edit" ? text.editCriterion : text.newCriterion}
      onClose={onClose}
      testIDPrefix="homework-rubric-criterion"
      footer={
        <>
          {touched && !check.valid ? (
            <Notice
              tone="caution"
              title={text.checkTitle}
              message={firstCriterionError(check) ?? text.levelsError}
              style={styles.footerNotice}
              testID="homework-rubric-criterion-check"
            />
          ) : null}
          <CapsuleButton
            title={text.saveCriterion}
            icon="check"
            onPress={submit}
            testID="homework-rubric-criterion-save"
          />
        </>
      }
    >
      <Notice
        tone="neutral"
        message={text.criterionHint}
        testID="homework-rubric-criterion-hint"
      />

      <FormField
        label={text.criterionName}
        value={value.name}
        onChangeText={(next) => setValue((current) => ({ ...current, name: next }))}
        placeholder={text.criterionNamePlaceholder}
        error={touched ? check.errors.name : undefined}
        testID="homework-rubric-criterion-name"
      />
      <FormField
        label={text.criterionDescription}
        value={value.description}
        onChangeText={(next) =>
          setValue((current) => ({ ...current, description: next }))
        }
        placeholder={text.criterionDescriptionPlaceholder}
        error={touched ? check.errors.description : undefined}
        multiline
        numberOfLines={2}
        testID="homework-rubric-criterion-description"
      />

      <View style={styles.sheetLevelsHead}>
        <SectionLabel>{text.levels}</SectionLabel>
        <ThemedText variant="meta">{text.levelsHelp}</ThemedText>
      </View>

      {value.levels.map((level, index) => {
        const levelErrors = check.errors.levelsByKey[level.key];
        return (
          <View key={level.key} style={styles.levelBox}>
            <View style={styles.levelHead}>
              <ThemedText variant="caption">
                {`${text.levelLabel} ${index + 1}`}
              </ThemedText>
              <View style={styles.levelActions}>
                <CardAction
                  icon="chevronDown"
                  label={text.moveUp}
                  rotate
                  disabled={index === 0}
                  onPress={() => moveLevel(index, -1)}
                  testID={`homework-rubric-level-up-${index}`}
                />
                <CardAction
                  icon="chevronDown"
                  label={text.moveDown}
                  disabled={index === value.levels.length - 1}
                  onPress={() => moveLevel(index, 1)}
                  testID={`homework-rubric-level-down-${index}`}
                />
                <CardAction
                  icon="close"
                  label={text.removeLevel}
                  tone="critical"
                  disabled={value.levels.length === 1}
                  onPress={() => removeLevel(level.key)}
                  testID={`homework-rubric-level-remove-${index}`}
                />
              </View>
            </View>

            <FormField
              label={text.levelLabel}
              value={level.label}
              onChangeText={(next) => updateLevel(level.key, { label: next })}
              placeholder={text.levelLabelPlaceholder}
              error={touched ? levelErrors?.label : undefined}
              testID={`homework-rubric-level-label-${index}`}
            />
            <FormField
              label={text.levelPoints}
              value={level.points}
              onChangeText={(next) => updateLevel(level.key, { points: next })}
              keyboardType="decimal-pad"
              suffix={text.pointsSuffix}
              error={touched ? levelErrors?.points : undefined}
              testID={`homework-rubric-level-points-${index}`}
            />
            <FormField
              label={text.levelDescription}
              value={level.description}
              onChangeText={(next) =>
                updateLevel(level.key, { description: next })
              }
              placeholder={text.levelDescriptionPlaceholder}
              error={touched ? levelErrors?.description : undefined}
              multiline
              numberOfLines={2}
              testID={`homework-rubric-level-description-${index}`}
            />
          </View>
        );
      })}

      {touched && check.errors.levels ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.levelsError}
          accessibilityLiveRegion="polite"
        >
          {check.errors.levels}
        </ThemedText>
      ) : null}

      <CapsuleButton
        title={text.addLevel}
        icon="add"
        variant="secondary"
        size="compact"
        onPress={() =>
          setValue((current) => ({
            ...current,
            levels: [...current.levels, emptyLevelDraft()],
          }))
        }
        style={styles.addLevel}
        testID="homework-rubric-level-add"
      />
    </FormSheet>
  );
}

function firstCriterionError(check: RubricCriterionCheck): string | null {
  if (check.errors.name) return check.errors.name;
  if (check.errors.description) return check.errors.description;
  if (check.errors.levels) return check.errors.levels;
  for (const level of Object.values(check.errors.levelsByKey)) {
    if (level.label) return level.label;
    if (level.points) return level.points;
    if (level.description) return level.description;
  }
  return null;
}

function CardAction({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "neutral",
  rotate = false,
  testID,
}: {
  icon: "edit" | "chevronDown" | "close";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "neutral" | "critical";
  rotate?: boolean;
  testID: string;
}) {
  const color =
    tone === "critical" ? colors.tone.critical.fg : colors.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        pressed ? styles.pressed : null,
        disabled ? styles.actionDisabled : null,
      ]}
      testID={testID}
    >
      <AppIcon
        name={icon}
        size={18}
        color={color}
        style={rotate ? styles.rotate : undefined}
      />
      <ThemedText variant="meta" color={color} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  criteriaHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cards: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardName: {
    flex: 1,
  },
  position: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  levels: {
    gap: spacing.xxs,
    marginTop: spacing.xxs,
  },
  levelLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  levelName: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  action: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  rotate: {
    transform: [{ rotate: "180deg" }],
  },
  sheetLevelsHead: {
    gap: spacing.xxs,
    marginTop: spacing.lg,
  },
  levelBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    gap: spacing.xs,
  },
  levelHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  levelActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    marginLeft: "auto",
    gap: spacing.xxs,
  },
  levelsError: {
    marginTop: spacing.sm,
  },
  addLevel: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  footerNotice: {
    marginBottom: spacing.sm,
  },
});
