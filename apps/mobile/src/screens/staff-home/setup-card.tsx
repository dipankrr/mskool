import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { FormSheet } from "../../components/form-sheet";
import { IconTile } from "../../components/icon-tile";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { buildSetupSteps, nextSetupStep, setupFinished } from "../../lib/setup-status";
import type { SetupStep } from "../../lib/setup-status";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";

/**
 * Who the popup has been shown to since the app process started. Held in memory
 * on purpose: returning from another app keeps it, so the popup only ever shows
 * on a fresh launch. Keyed by user so a sign-in on the same run still gets it.
 */
let popupShownFor: string | null = null;

const go = (route: string) => router.push(route as Parameters<typeof router.push>[0]);

/**
 * THE SETUP CARD (and its launch popup). Shows only to someone who can set the
 * school up, gated on `academic_year:create` as a whole: a class teacher holds
 * `attendance:update`, and checking each step alone would pop up one step for
 * them. Everything keeps working without it, so a failed read just shows nothing.
 *
 * Compact by default: progress and the one next step. All steps expand in place.
 */
export function SetupCard() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();
  const { session } = useMe();
  const branchName = useActiveBranchName() ?? "";

  const enabled =
    ready && Boolean(organizationId) && Boolean(schoolId) && has("academic_year:create");

  const status = trpc.academic.setupStatus.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled, retry: false },
  );

  // Home stays mounted under the screens that do the work.
  const [focused, setFocused] = useState(false);
  const refetch = status.refetch;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (enabled) void refetch();
      return () => setFocused(false);
    }, [enabled, refetch]),
  );

  const [expanded, setExpanded] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [readyCard, setReadyCard] = useState(false);

  const steps = enabled && status.data ? buildSetupSteps(status.data, has) : null;
  const finished = steps ? setupFinished(steps) : true;
  const unfinished = Boolean(steps) && !finished;

  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!unfinished || !focused || !userId || popupShownFor === userId) return;
    popupShownFor = userId;
    setPopupOpen(true);
  }, [unfinished, focused, userId]);

  // "Ready" shows once, only when this run watched the last step finish.
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (!steps || !schoolId) return;
    if (!finished) {
      watching.current = schoolId;
      setReadyCard(false);
    } else if (watching.current === schoolId) {
      watching.current = null;
      setReadyCard(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [steps, finished, schoolId]);

  if (readyCard) {
    return (
      <View style={styles.ready} testID="setup-ready">
        <AppIcon name="checkCircle" size={24} color={colors.accentDeep} />
        <View style={styles.flex}>
          <ThemedText variant="name" color={colors.accentDeep}>
            {copy.setup.readyTitle(branchName)}
          </ThemedText>
          <ThemedText variant="meta" color={colors.accentDeep}>
            {copy.setup.readyBody}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.setup.dismiss}
          onPress={() => setReadyCard(false)}
          style={styles.dismiss}
          testID="setup-ready-dismiss"
        >
          <AppIcon name="close" size={18} color={colors.accentDeep} />
        </Pressable>
      </View>
    );
  }

  if (!steps || finished) return null;

  const doneCount = steps.filter((step) => step.state === "done").length;
  const next = nextSetupStep(steps);

  return (
    <>
      <Card padless style={styles.card} testID="setup-card">
        <View style={styles.head}>
          <View style={styles.headLine}>
            <ThemedText variant="name" numberOfLines={1} style={styles.flex}>
              {copy.setup.title(branchName)}
            </ThemedText>
            <ThemedText variant="meta">
              {copy.setup.progress(doneCount, steps.length)}
            </ThemedText>
          </View>
          <Meter steps={steps} />
        </View>

        {expanded ? (
          steps.map((step) => <StepRow key={step.key} step={step} />)
        ) : next ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${copy.setup.nextLabel}: ${next.action}. ${next.detail}`}
            onPress={() => go(next.route)}
            style={({ pressed }) => [styles.next, pressed ? styles.pressed : null]}
            testID="setup-next"
          >
            <IconTile name={next.icon} size={40} tone="accent" />
            <View style={styles.flex}>
              <ThemedText variant="meta">{copy.setup.nextLabel}</ThemedText>
              <ThemedText variant="bodyStrong">{next.action}</ThemedText>
              <ThemedText variant="meta" numberOfLines={1}>
                {next.detail}
              </ThemedText>
            </View>
            <AppIcon name="chevronRight" size={18} color={colors.chevron} />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => {
            void Haptics.selectionAsync();
            setExpanded((open) => !open);
          }}
          style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}
          testID="setup-toggle"
        >
          <ThemedText variant="chip" color={colors.muted}>
            {expanded ? copy.setup.fewer : copy.setup.allSteps}
          </ThemedText>
          <AppIcon
            name={expanded ? "chevronUp" : "chevronDown"}
            size={18}
            color={colors.muted}
          />
        </Pressable>
      </Card>

      {popupOpen ? (
        <FormSheet
          title={copy.setup.popupTitle}
          onClose={() => setPopupOpen(false)}
          testIDPrefix="setup-popup"
          footer={
            <>
              {next ? (
                <CapsuleButton
                  title={copy.setup.continueTo(next.action)}
                  onPress={() => {
                    setPopupOpen(false);
                    go(next.route);
                  }}
                  testID="setup-popup-continue"
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setPopupOpen(false)}
                style={styles.later}
                testID="setup-popup-later"
              >
                <ThemedText variant="bodyStrong" color={colors.muted}>
                  {copy.setup.later}
                </ThemedText>
              </Pressable>
            </>
          }
        >
          <ThemedText variant="meta">{copy.setup.popupBody(branchName)}</ThemedText>
          <View style={styles.popupMeter}>
            <Meter steps={steps} />
            <ThemedText variant="meta">
              {copy.setup.progress(doneCount, steps.length)}
            </ThemedText>
          </View>
          <View style={styles.popupSteps}>
            {steps
              .filter((step) => step.state !== "done")
              .map((step) => (
                <StepRow
                  key={step.key}
                  step={step}
                  onOpen={() => setPopupOpen(false)}
                />
              ))}
          </View>
        </FormSheet>
      ) : null}
    </>
  );
}

function Meter({ steps }: { steps: readonly SetupStep[] }) {
  return (
    <View
      style={styles.meter}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {steps.map((step) => (
        <View
          key={step.key}
          style={[styles.segment, step.state === "done" ? styles.segmentOn : null]}
        />
      ))}
    </View>
  );
}

function StepRow({ step, onOpen }: { step: SetupStep; onOpen?: () => void }) {
  const locked = step.state === "locked";
  const done = step.state === "done";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        step.title,
        done ? copy.setup.doneLabel : null,
        step.detail,
      ]
        .filter(Boolean)
        .join(". ")}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={() => {
        onOpen?.();
        go(step.route);
      }}
      style={({ pressed }) => [styles.step, pressed ? styles.pressed : null]}
      testID={`setup-step-${step.key}`}
    >
      <View style={styles.stepMark}>
        {done ? (
          <AppIcon name="checkCircle" size={20} color={colors.accentDeep} />
        ) : locked ? (
          <AppIcon name="lock" size={16} color={colors.chevron} />
        ) : (
          <View style={styles.ring} />
        )}
      </View>
      <View style={styles.flex}>
        <ThemedText
          variant={done || locked ? "body" : "bodyStrong"}
          color={done || locked ? colors.muted : undefined}
        >
          {step.title}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {step.detail}
        </ThemedText>
      </View>
      {locked ? null : (
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    marginTop: spacing.lg,
    overflow: "hidden",
  },
  head: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  meter: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  segmentOn: {
    backgroundColor: colors.accent,
  },
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  toggle: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  step: {
    minHeight: touch.comfortable,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  stepMark: {
    width: spacing.xl,
    alignItems: "center",
  },
  ring: {
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.chevron,
  },
  popupMeter: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  popupSteps: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.lg,
  },
  later: {
    minHeight: touch.min,
    alignItems: "center",
    justifyContent: "center",
  },
  ready: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.accentTint,
  },
  dismiss: {
    width: touch.min,
    height: touch.min,
    alignItems: "center",
    justifyContent: "center",
  },
});
