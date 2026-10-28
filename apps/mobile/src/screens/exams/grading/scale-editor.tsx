import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { FormField } from "../../../components/form-field";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { SwitchRow } from "../../../components/switch-row";
import { ThemedText } from "../../../components/themed-text";
import { useActiveBranchName } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { useUnsavedChanges } from "../../../hooks/use-unsaved-changes";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import {
  bandDraftsFromRows,
  bandProblem,
  bandsFromKey,
  bandsKey,
  bandsPayload,
  checkBands,
  firstBandProblem,
  hundredthsOf,
  largestUncoveredInterval,
  removeBandAndExtend,
  resolveGrade,
  sharedEdge,
} from "../../../lib/grading-scale";
import type { BandDraft } from "../../../lib/grading-scale";
import { colors } from "../../../theme/brand-admin";
import { spacing } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { CoverageBar, QuietChip, SectionHead } from "./ui";
import { useGradingScaleActions, useGradingScalesAdmin } from "./use-grading";

type ScaleRow = inferRouterOutputs<AppRouter>["exam"]["gradingScales"]["list"][number];

/**
 * GRADING SCALE EDITOR (chunk 7F) — one pushed screen for "new" and "edit".
 *
 * The coverage rule is the screen: bands are judged with the server's exact
 * arithmetic before the save, the strip paints the holes, and the first
 * problem rides above the save so a long scroll never hides the reason.
 *
 * Save order is bands first, then name/description: a band refusal must not
 * leave a renamed scale with old bands. A used (locked) scale keeps its bands
 * read-only while name and description still save; "make default" stays
 * available because it only steers future computes.
 */
export function ScaleEditorScreen() {
  const { scaleId } = useLocalSearchParams<{ scaleId?: string }>();
  const scope = useExamScope();
  const branchName = useActiveBranchName();
  const scales = useGradingScalesAdmin();

  const isNew = !scaleId;
  const rows = scales.data ?? [];
  const scale = scaleId ? (rows.find((row) => row.id === scaleId) ?? null) : null;
  const hasDefault = rows.some((row) => row.isDefault);

  const meta = isNew
    ? copy.exams.meta(scope.academicYear?.name ?? null, branchName)
    : scale
      ? [
          scale.isDefault ? copy.exams.grading.scales.defaultChip : null,
          scale.isLocked ? copy.exams.grading.scales.lockedChip : null,
          copy.exams.grading.scales.bandsHint(scale.bands.length),
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  const allowed = isNew ? scope.canCreate : scope.canUpdate;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={
        isNew
          ? copy.exams.grading.scales.createTitle
          : (scale?.name ?? copy.exams.grading.scales.editTitle)
      }
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="scale-editor-back"
      titleTestID="scale-editor-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead || !allowed) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="scale-editor-denied"
      />,
    );
  }

  if (!scope.ready || scales.isPending) {
    return frame(
      <View style={styles.skeletons} testID="scale-editor-loading">
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={156} />
      </View>,
    );
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="scale-editor-no-branch"
      />,
    );
  }

  if (scales.isError) {
    return frame(
      <ErrorCard
        cause={scales.error}
        onRetry={() => void scales.refetch()}
        testID="scale-editor-error"
      />,
    );
  }

  if (!isNew && !scale) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.grading.scales.gone}
        message={copy.exams.grading.scales.goneBody}
        testID="scale-editor-gone"
      />,
    );
  }

  return (
    <ScaleForm
      key={scale?.id ?? "new"}
      scale={scale}
      hasDefault={hasDefault}
      meta={meta}
    />
  );
}

function ScaleForm({
  scale,
  hasDefault,
  meta,
}: {
  scale: ScaleRow | null;
  hasDefault: boolean;
  meta: string | null;
}) {
  const { has } = usePermissions();
  const canWrite = has(scale ? "exam:update" : "exam:create");
  const actions = useGradingScaleActions();

  const initialBands = scale
    ? bandDraftsFromRows(scale.bands)
    : [
        {
          minMarks: "0",
          maxMarks: "100",
          gradeLabel: "",
          gradePoint: "",
          descriptor: null,
        } satisfies BandDraft,
      ];
  const initialKey = scale ? bandsFromKey(scale.bands) : bandsKey(initialBands);
  const initialDefault = scale ? scale.isDefault : !hasDefault;
  const initialDescription = scale?.description ?? "";

  const [name, setName] = useState(scale?.name ?? "");
  const [description, setDescription] = useState(initialDescription);
  const [isDefault, setIsDefault] = useState(initialDefault);
  const [bands, setBands] = useState<BandDraft[]>(initialBands);
  const [score, setScore] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const locked = scale?.isLocked ?? false;
  const check = checkBands(bands);
  const bandsTouched = bandsKey(bands) !== initialKey;
  const dirty = scale
    ? name.trim() !== scale.name ||
      description.trim() !== initialDescription.trim() ||
      bandsTouched
    : name.trim().length > 0 ||
      description.trim().length > 0 ||
      isDefault !== initialDefault ||
      bandsTouched;
  const nameMissing = name.trim().length === 0;
  const bandsProblem = firstBandProblem(check);
  /**
   * A brand-new scale opens with one 0–100 band that has no grade yet. That
   * band is unfinished, not wrong: nothing red until the admin presses Save
   * or edits a band, exactly like the fee-head sheet. A pristine form that
   * already shouts "Give the band a grade" reads as a failure before the
   * first tap.
   */
  const showProblems = submitted || bandsTouched;
  const problem = nameMissing
    ? copy.exams.grading.scales.nameRequired
    : bandsProblem;
  /**
   * The footer only repeats the reason after a save attempt. Live problems
   * already sit under the band that caused them; echoing the same sentence at
   * the bottom of a short form reads as two different errors.
   */
  const caption = submitted ? problem : null;
  const scoreValue = score.trim().length > 0 ? hundredthsOf(score) : null;
  const checkScore = scoreValue !== null ? resolveGrade(bands, score) : null;
  const edge = locked ? null : sharedEdge(bands);

  useUnsavedChanges(dirty && !saved, {
    title: copy.exams.grading.scales.unsavedTitle,
    body: copy.exams.grading.scales.unsavedBody,
    keepEditing: copy.exams.grading.scales.keepEditing,
    discard: copy.exams.grading.scales.leave,
  });

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const setBand = (index: number, patch: Partial<BandDraft>) => {
    setBands((current) =>
      current.map((band, position) =>
        position === index ? { ...band, ...patch } : band,
      ),
    );
  };

  const addBand = () => {
    const interval = largestUncoveredInterval(bands);
    if (!interval) return;
    setBands((current) =>
      [
        ...current,
        {
          ...interval,
          gradeLabel: "",
          gradePoint: "",
          descriptor: null,
        },
      ].sort(
        (a, b) =>
          (hundredthsOf(b.minMarks) ?? 0) - (hundredthsOf(a.minMarks) ?? 0),
      ),
    );
  };

  const removeBand = (index: number) => {
    setBands((current) => removeBandAndExtend(current, index));
  };

  const save = () => {
    setSubmitted(true);
    setError(null);
    setNotice(null);
    if (nameMissing || (!check.ok && !locked)) return;

    void (async () => {
      try {
        if (!scale) {
          await actions.create({
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            isDefault,
            bands: bandsPayload(bands),
          });
          setSaved(true);
          return;
        }

        const bandsChanged = bandsKey(bands) !== initialKey;
        if (bandsChanged && !scale.isLocked) {
          await actions.replaceBands(scale.id, bandsPayload(bands));
        }
        const data: { name?: string; description?: string } = {};
        if (name.trim() !== scale.name) data.name = name.trim();
        if (description.trim() !== initialDescription.trim()) {
          data.description = description.trim();
        }
        if (Object.keys(data).length > 0) {
          await actions.update(scale.id, data);
        }
        setSaved(true);
      } catch (cause) {
        setError(cause);
      }
    })();
  };

  const makeDefault = () => {
    if (!scale) return;
    Alert.alert(
      copy.exams.grading.scales.makeDefaultTitle,
      copy.exams.grading.scales.makeDefaultBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.exams.grading.scales.makeDefault,
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                await actions.makeDefault(scale.id);
                setNotice(copy.exams.grading.scales.madeDefault);
              } catch (cause) {
                setError(cause);
              }
            })();
          },
        },
      ],
    );
  };

  const retire = () => {
    if (!scale) return;
    Alert.alert(
      copy.exams.grading.scales.retireTitle(scale.name),
      copy.exams.grading.scales.retireBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.exams.grading.scales.retireConfirm,
          style: "destructive",
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                await actions.retire(scale.id);
                setSaved(true);
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
    <ScreenFrame
      title={scale?.name ?? copy.exams.grading.scales.createTitle}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="scale-editor-back"
      titleTestID="scale-editor-title"
      footer={
        <View style={styles.footer}>
          {/*
           * The result of the last action lives in the footer, not the top of
           * the body: Save, "Make school default" and Retire are all at the
           * bottom of a long form, and a confirmation at the top is off-screen
           * exactly when it is needed.
           */}
          {error ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
              testID="scale-editor-error-notice"
            >
              {errorMessage(error)}
            </ThemedText>
          ) : notice ? (
            <ThemedText
              variant="meta"
              color={colors.tone.positive.fg}
              accessibilityLiveRegion="polite"
              testID="scale-editor-notice"
            >
              {notice}
            </ThemedText>
          ) : caption && !locked ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
              testID="scale-editor-problem"
            >
              {caption}
            </ThemedText>
          ) : null}
          <CapsuleButton
            title={copy.exams.grading.scales.save}
            icon="check"
            loading={actions.pending}
            disabled={!canWrite || (scale != null && !dirty)}
            onPress={save}
            testID="scale-editor-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        {locked ? (
          <Notice
            tone="neutral"
            icon="lock"
            title={copy.exams.grading.scales.lockedTitle}
            message={copy.exams.grading.scales.lockedBody}
            testID="scale-editor-locked"
          />
        ) : null}

        <Card>
          <FormField
            label={copy.exams.grading.scales.nameLabel}
            value={name}
            onChangeText={setName}
            placeholder={copy.exams.grading.scales.namePlaceholder}
            maxLength={100}
            error={
              submitted && nameMissing
                ? copy.exams.grading.scales.nameRequired
                : undefined
            }
            testID="scale-name"
          />
          <FormField
            label={copy.exams.grading.scales.descriptionLabel}
            value={description}
            onChangeText={setDescription}
            placeholder={copy.exams.grading.scales.descriptionPlaceholder}
            maxLength={255}
            testID="scale-description"
          />
          {!scale ? (
            <SwitchRow
              label={copy.exams.grading.scales.defaultLabel}
              value={isDefault}
              onChange={setIsDefault}
              help={
                hasDefault
                  ? copy.exams.grading.scales.defaultHelp
                  : copy.exams.grading.scales.defaultFirstHelp
              }
              testID="scale-default"
            />
          ) : null}
        </Card>

        <View style={styles.bandsHead}>
          <SectionHead
            title={copy.exams.grading.scales.bandsTitle}
            hint={
              check.ok
                ? copy.exams.grading.scales.covers
                : showProblems
                  ? copy.exams.grading.scales.problemCount(
                      check.problems.length,
                    )
                  : undefined
            }
            tone={check.ok || !showProblems ? undefined : "critical"}
          />
          <CoverageBar drafts={bands} testID="scale-coverage" />
          {edge ? (
            <ThemedText variant="meta" testID="scale-edge-note">
              {copy.exams.grading.scales.edgeNote(edge.value, edge.label)}
            </ThemedText>
          ) : null}
        </View>

        {locked ? (
          <Card padless testID="scale-bands-readonly">
            {bands.map((band, index) => (
              <View
                key={`${index}-${band.gradeLabel}`}
                style={[styles.readonlyRow, index === 0 ? null : styles.divider]}
              >
                <QuietChip label={band.gradeLabel} tone="neutral" />
                <ThemedText variant="bodyStrong" style={styles.readonlyRange}>
                  {band.minMarks}–{band.maxMarks}%
                </ThemedText>
                {band.gradePoint ? (
                  <ThemedText variant="meta">{band.gradePoint} points</ThemedText>
                ) : null}
              </View>
            ))}
          </Card>
        ) : (
          <View style={styles.bandList}>
            {bands.map((band, index) => (
              <BandCard
                key={index}
                index={index}
                band={band}
                problem={
                  showProblems ? bandProblem(check, index) : null
                }
                canRemove={bands.length > 1}
                onChange={(patch) => setBand(index, patch)}
                onRemove={() => removeBand(index)}
              />
            ))}
            {/*
             * Always offered, disabled while the scale already covers every
             * percentage: a button that vanishes right after "Add band" looks
             * like a dead end, and the caption says what to do instead.
             */}
            <View style={styles.addBand}>
              <CapsuleButton
                title={copy.exams.grading.scales.addBand}
                icon="add"
                variant="secondary"
                size="compact"
                disabled={!largestUncoveredInterval(bands)}
                onPress={addBand}
                testID="scale-add-band"
              />
              {largestUncoveredInterval(bands) ? null : (
                <ThemedText variant="meta" style={styles.allCovered}>
                  {copy.exams.grading.scales.allCovered}
                </ThemedText>
              )}
            </View>
          </View>
        )}

        {!locked && check.ok ? (
          <Card testID="scale-score-check">
            <FormField
              label={copy.exams.grading.scales.checkLabel}
              value={score}
              onChangeText={setScore}
              placeholder={copy.exams.grading.scales.checkPlaceholder}
              keyboardType="decimal-pad"
              maxLength={6}
              help={copy.exams.grading.scales.checkHelp}
              testID="scale-check-score"
            />
            {score.trim().length > 0 ? (
              <ThemedText
                variant="bodyStrong"
                color={
                  checkScore ? colors.accentDeep : colors.tone.critical.fg
                }
                style={styles.checkResult}
                accessibilityLiveRegion="polite"
                testID="scale-check-result"
              >
                {checkScore
                  ? copy.exams.grading.scales.checkResult(
                      score.trim(),
                      checkScore.gradeLabel,
                      checkScore.gradePoint,
                    )
                  : scoreValue !== null
                    ? copy.exams.grading.scales.checkNoBand(score.trim())
                    : copy.exams.grading.scales.checkFormat}
              </ThemedText>
            ) : null}
          </Card>
        ) : null}

        {scale && canWrite ? (
          <View style={styles.actions}>
            {!scale.isDefault ? (
              <CapsuleButton
                title={copy.exams.grading.scales.makeDefault}
                variant="secondary"
                size="compact"
                onPress={makeDefault}
                disabled={actions.pending}
                testID="scale-make-default"
              />
            ) : null}
            {!scale.isDefault && !scale.isLocked ? (
              <CapsuleButton
                title={copy.exams.grading.scales.retireAction}
                variant="destructive"
                size="compact"
                onPress={retire}
                disabled={actions.pending}
                testID="scale-retire"
              />
            ) : null}
            {scale.isDefault ? (
              <ThemedText variant="meta">
                {copy.exams.grading.scales.defaultNoRetire}
              </ThemedText>
            ) : scale.isLocked ? (
              <ThemedText variant="meta">
                {copy.exams.grading.scales.lockedNoRetire}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>
    </ScreenFrame>
  );
}

function BandCard({
  index,
  band,
  problem,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  band: BandDraft;
  problem: string | null;
  canRemove: boolean;
  onChange: (patch: Partial<BandDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <Card testID={`scale-band-${index}`}>
      <View style={styles.bandHead}>
        <ThemedText variant="bodyStrong">
          {copy.exams.grading.scales.bandLabel(index)}
        </ThemedText>
        {canRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.exams.grading.scales.removeBand(index)}
            hitSlop={8}
            onPress={onRemove}
            style={({ pressed }) => [
              styles.remove,
              pressed ? styles.removePressed : null,
            ]}
            testID={`scale-band-remove-${index}`}
          >
            <AppIcon
              name="trash"
              size={18}
              color={colors.tone.critical.fg}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.half}>
          <FormField
            label={copy.exams.grading.scales.gradeLabel}
            value={band.gradeLabel}
            onChangeText={(next) => onChange({ gradeLabel: next.toUpperCase() })}
            placeholder={copy.exams.grading.scales.gradePlaceholder}
            autoCapitalize="characters"
            maxLength={10}
            testID={`scale-band-grade-${index}`}
          />
        </View>
        <View style={styles.half}>
          <FormField
            label={copy.exams.grading.scales.pointsLabel}
            value={band.gradePoint}
            onChangeText={(next) =>
              onChange({ gradePoint: next.replace(/[^0-9.]/g, "") })
            }
            placeholder={copy.exams.grading.scales.pointsPlaceholder}
            keyboardType="decimal-pad"
            maxLength={6}
            testID={`scale-band-points-${index}`}
          />
        </View>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.half}>
          <FormField
            label={copy.exams.grading.scales.fromLabel}
            value={band.minMarks}
            onChangeText={(next) =>
              onChange({ minMarks: next.replace(/[^0-9.]/g, "") })
            }
            keyboardType="decimal-pad"
            maxLength={6}
            suffix="%"
            testID={`scale-band-from-${index}`}
          />
        </View>
        <View style={styles.half}>
          <FormField
            label={copy.exams.grading.scales.toLabel}
            value={band.maxMarks}
            onChangeText={(next) =>
              onChange({ maxMarks: next.replace(/[^0-9.]/g, "") })
            }
            keyboardType="decimal-pad"
            maxLength={6}
            suffix="%"
            testID={`scale-band-to-${index}`}
          />
        </View>
      </View>

      {problem ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.bandProblem}
          accessibilityLiveRegion="polite"
          testID={`scale-band-problem-${index}`}
        >
          {problem}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  footer: {
    gap: spacing.sm,
  },
  bandsHead: {
    gap: spacing.sm,
  },
  bandList: {
    gap: spacing.md,
    alignItems: "stretch",
  },
  bandHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  remove: {
    width: 44,
    height: 44,
    marginRight: -spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  removePressed: {
    backgroundColor: colors.tone.critical.bg,
  },
  fieldRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  bandProblem: {
    marginTop: spacing.sm,
  },
  allCovered: {
    paddingHorizontal: spacing.xs,
  },
  addBand: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  checkResult: {
    marginTop: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  readonlyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  readonlyRange: {
    flex: 1,
  },
});
