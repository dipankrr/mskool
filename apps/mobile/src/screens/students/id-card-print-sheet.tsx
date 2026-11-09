import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SegmentBar } from "../../components/segment-bar";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { printDocument, shareDocument } from "../../lib/fee-print";
import { setCardGaps, useCardGaps } from "../../lib/id-card-prefs";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import {
  a4Fit,
  cardSizeOf,
  GAP_MAX_MM,
  GAP_MIN_MM,
  MARGIN_MAX_MM,
  sheetCount,
} from "./id-card-print-logic";

const words = copy.students.printCards;

/** What the Students list is showing: its view, search, filters and sort, without paging. */
export type PrintList = inferRouterInputs<AppRouter>["idCard"]["print"]["summary"]["list"];

type Paper = "a4" | "card";
type Flip = "long" | "short";

/**
 * Prints ID cards for the students the list shows (owner, 2026-11-09). The API finds
 * every match, not only the loaded pages, prints those with a class this session, and
 * returns finished HTML this phone turns into a PDF (ADR-059's pattern). Designs are
 * made on the web; here you pick one, the paper and the gaps, then print or share.
 */
export function IdCardPrintSheet({
  organizationId,
  schoolId,
  list,
  onClose,
}: {
  organizationId: string;
  schoolId: string;
  list: PrintList;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const gaps = useCardGaps();
  const base = { organizationId, schoolId };

  const summary = trpc.idCard.print.summary.useQuery({ ...base, list }, { staleTime: 0 });
  const templates = trpc.idCard.template.list.useQuery(base);

  const designs = useMemo(
    () =>
      (templates.data ?? []).filter(
        (row) => row.schoolId === schoolId && row.status === "active",
      ),
    [templates.data, schoolId],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const design =
    designs.find((row) => row.id === pickedId) ??
    designs.find((row) => row.isDefault) ??
    designs[0] ??
    null;

  const [paper, setPaper] = useState<Paper>("a4");
  const [flip, setFlip] = useState<Flip>("long");
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const facts = summary.data;
  const printable = facts?.printable ?? 0;
  const overLimit = facts ? facts.printable > facts.limit : false;
  const twoSided = Boolean(design?.backCanvas && design?.backElements);
  const card = design ? cardSizeOf(design) : null;
  const fit = card ? a4Fit(card, gaps) : null;

  const loading = summary.isLoading || templates.isLoading;
  const loadError = summary.error ?? templates.error;
  const canMake = Boolean(design) && printable > 0 && !overLimit && busy === null;

  const run = async (kind: "print" | "share") => {
    if (!design) return;
    setError(null);
    setBusy(kind);
    try {
      const document = await utils.idCard.print.document.fetch(
        {
          ...base,
          list,
          templateId: design.id,
          paper:
            paper === "a4"
              ? { kind: "a4", ...gaps, flip }
              : { kind: "card" },
        },
        { staleTime: 0, gcTime: 0 },
      );
      if (kind === "print") await printDocument(document);
      else await shareDocument(document, words.shareTitle);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  };

  const body = (() => {
    if (loading) {
      return (
        <View style={styles.gap} accessibilityLabel={words.loading}>
          <Skeleton height={56} />
          <Skeleton height={120} />
        </View>
      );
    }
    if (loadError) {
      return (
        <View style={styles.gap}>
          <Notice tone="critical" message={toFriendlyError(loadError).message} testID="id-print-load-error" />
          <CapsuleButton
            title={copy.common.retry}
            variant="secondary"
            size="compact"
            onPress={() => {
              void summary.refetch();
              void templates.refetch();
            }}
            testID="id-print-retry"
          />
        </View>
      );
    }
    if (!design) {
      return (
        <Notice
          tone="caution"
          title={words.noDesignTitle}
          message={words.noDesignBody}
          testID="id-print-no-design"
        />
      );
    }

    const leftOut = facts ? facts.matched - facts.printable : 0;
    return (
      <View style={styles.gap}>
        <View style={styles.countBlock}>
          <ThemedText variant="title" testID="id-print-count">
            {words.count(printable)}
          </ThemedText>
          <ThemedText variant="meta" color={colors.muted}>
            {words.fromList}
          </ThemedText>
        </View>

        {printable === 0 ? (
          <Notice tone="caution" message={words.nobody} testID="id-print-nobody" />
        ) : null}
        {overLimit && facts ? (
          <Notice tone="caution" message={words.overLimit(facts.printable, facts.limit)} testID="id-print-over" />
        ) : null}
        {leftOut > 0 && printable > 0 ? (
          <ThemedText variant="meta" color={colors.muted} testID="id-print-left-out">
            {words.leftOut(leftOut)}
          </ThemedText>
        ) : null}
        {facts && facts.noPhoto > 0 && printable > 0 ? (
          <View style={styles.photoRow}>
            <ThemedText variant="meta" color={colors.muted} style={styles.flex}>
              {words.noPhoto(facts.noPhoto)}
            </ThemedText>
            <Pressable
              accessibilityRole="link"
              hitSlop={10}
              onPress={() => {
                onClose();
                router.push("/students/photos");
              }}
              testID="id-print-add-photos"
            >
              <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                {words.addPhotos}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <SelectField
          label={words.design}
          valueLabel={design.name}
          placeholder={words.designPlaceholder}
          options={designs.map((row) => ({
            id: row.id,
            label: row.name,
            detail: [
              row.isDefault ? words.defaultTag : null,
              row.orientation === "portrait" ? words.portrait : words.landscape,
              row.backCanvas && row.backElements ? words.twoSided : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          currentId={design.id}
          onSelect={setPickedId}
          testID="id-print-design"
        />

        <View style={styles.field}>
          <ThemedText variant="sectionLabel">{words.paper}</ThemedText>
          <SegmentBar<Paper>
            label={words.paper}
            value={paper}
            onChange={setPaper}
            options={[
              { value: "a4", label: words.paperA4, testID: "id-print-paper-a4" },
              { value: "card", label: words.paperCard, testID: "id-print-paper-card" },
            ]}
          />
        </View>

        {paper === "a4" ? (
          <View style={styles.gap}>
            <GapStepper
              label={words.columnGap}
              value={gaps.columnGapMm}
              onChange={(next) => setCardGaps({ ...gaps, columnGapMm: next })}
              testID="id-print-column-gap"
            />
            <GapStepper
              label={words.rowGap}
              value={gaps.rowGapMm}
              onChange={(next) => setCardGaps({ ...gaps, rowGapMm: next })}
              testID="id-print-row-gap"
            />
            <GapStepper
              label={words.marginX}
              value={gaps.marginXMm}
              max={MARGIN_MAX_MM}
              onChange={(next) => setCardGaps({ ...gaps, marginXMm: next })}
              testID="id-print-margin-x"
            />
            <GapStepper
              label={words.marginY}
              value={gaps.marginYMm}
              max={MARGIN_MAX_MM}
              onChange={(next) => setCardGaps({ ...gaps, marginYMm: next })}
              testID="id-print-margin-y"
            />
            {fit ? (
              <ThemedText variant="meta" color={colors.muted} testID="id-print-per-sheet">
                {words.perSheet(fit.perSheet, sheetCount(Math.min(printable, facts?.limit ?? printable), fit.perSheet))}
              </ThemedText>
            ) : null}
            {twoSided ? (
              <View style={styles.field}>
                <ThemedText variant="meta" color={colors.muted}>
                  {words.flip}
                </ThemedText>
                <SegmentBar<Flip>
                  label={words.flip}
                  value={flip}
                  onChange={setFlip}
                  options={[
                    { value: "long", label: words.flipLong, testID: "id-print-flip-long" },
                    { value: "short", label: words.flipShort, testID: "id-print-flip-short" },
                  ]}
                />
              </View>
            ) : null}
            <ThemedText variant="caption" color={colors.muted}>
              {words.actualSize}
            </ThemedText>
          </View>
        ) : (
          <ThemedText variant="meta" color={colors.muted} testID="id-print-card-note">
            {words.cardSizeNote}
          </ThemedText>
        )}

        {busy ? (
          <ThemedText variant="meta" color={colors.muted} accessibilityLiveRegion="polite">
            {words.making(printable)}
          </ThemedText>
        ) : null}
        {error ? (
          <Notice tone="critical" message={toFriendlyError(error).message} testID="id-print-error" />
        ) : null}
      </View>
    );
  })();

  return (
    <FormSheet
      title={words.title}
      onClose={busy ? () => undefined : onClose}
      testIDPrefix="id-print"
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title={words.share}
            icon="share"
            variant={paper === "a4" ? "secondary" : "primary"}
            size="compact"
            loading={busy === "share"}
            disabled={!canMake}
            onPress={() => void run("share")}
            style={styles.flex}
            testID="id-print-share"
          />
          {paper === "a4" ? (
            <CapsuleButton
              title={words.print}
              icon="print"
              size="compact"
              loading={busy === "print"}
              disabled={!canMake}
              onPress={() => void run("print")}
              style={styles.flex}
              testID="id-print-print"
            />
          ) : null}
        </View>
      }
    >
      {body}
    </FormSheet>
  );
}

/** A gap or margin in whole millimetres, with buttons big enough for a thumb. */
function GapStepper({
  label,
  value,
  max = GAP_MAX_MM,
  onChange,
  testID,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (next: number) => void;
  testID: string;
}) {
  const step = (delta: number) => onChange(Math.min(max, Math.max(GAP_MIN_MM, value + delta)));
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: GAP_MIN_MM, max, now: value, text: words.mm(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      testID={testID}
    >
      <ThemedText variant="body" style={styles.flex}>
        {label}
      </ThemedText>
      <StepButton icon="remove" label={words.less(label)} disabled={value <= GAP_MIN_MM} onPress={() => step(-1)} testID={`${testID}-less`} />
      <ThemedText variant="bodyStrong" style={styles.stepValue} testID={`${testID}-value`}>
        {words.mm(value)}
      </ThemedText>
      <StepButton icon="add" label={words.more(label)} disabled={value >= max} onPress={() => step(1)} testID={`${testID}-more`} />
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: "add" | "remove";
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <AppIcon name={icon} size={18} color={colors.accentDeep} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.md },
  field: { gap: spacing.sm },
  countBlock: { gap: 2 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  footer: { flexDirection: "row", gap: spacing.sm },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  stepValue: { minWidth: 52, textAlign: "center" },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});
