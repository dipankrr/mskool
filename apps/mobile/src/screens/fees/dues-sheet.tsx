import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { toFriendlyError } from "../../lib/errors";
import { monthLabel } from "../../lib/fees";
import { feesCopy } from "../../lib/fees-copy";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";

const words = feesCopy.dues;

/** "2027-03-31" → "March 2027". */
function monthOf(iso: string): string {
  return `${monthLabel(Number(iso.slice(5, 7)))} ${iso.slice(0, 4)}`;
}

/**
 * How dues get added. Automatic is the normal case and needs nothing from anyone.
 * Pausing makes someone responsible for each month, so this sheet and a dashboard
 * card offer that action only while paused. Creating the rest of the session is a
 * separate one-time action, and automatic carries on after it: it only ever fills
 * what is missing.
 */
export function DuesSheet({
  organizationId,
  schoolId,
  academicYearId,
  sessionEnd,
  onClose,
}: {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  sessionEnd: string;
  onClose: () => void;
}) {
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();
  const canPause = has("fee_structure:update") && sessionOpen;
  const canCreate = has("student_fee_assignment:update") && sessionOpen;
  const utils = trpc.useUtils();

  const scope = { organizationId, schoolId, academicYearId };
  const settings = trpc.fees.settings.get.useQuery({ organizationId, schoolId });
  const setup = trpc.fees.dashboard.setup.useQuery(scope);
  const latest = trpc.fees.duesRun.latest.useQuery(scope, {
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });
  const setMode = trpc.fees.settings.setGenerationMode.useMutation();
  const start = trpc.fees.duesRun.start.useMutation();

  const [classId, setClassId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [startedHere, setStartedHere] = useState(false);

  const running = latest.data?.status === "running";
  const finished = latest.data?.status === "done" && latest.data.id;

  // New dues change every figure, so everything is read again once a run ends.
  useEffect(() => {
    if (!finished) return;
    void utils.fees.dashboard.invalidate();
    void utils.fees.installment.dues.invalidate();
    void utils.fees.matrix.list.invalidate();
  }, [finished, utils]);

  const paused = settings.data?.mode === "monthly_manual";
  const classes = setup.data?.classes ?? [];
  const chosen = classes.find((row) => row.id === classId);
  const students = chosen
    ? chosen.billedStudents
    : classes.reduce((sum, row) => sum + row.billedStudents, 0);
  const thisMonth = monthOf(todayIso());
  const lastMonth = monthOf(sessionEnd);

  const togglePause = async (next: boolean) => {
    setError(null);
    try {
      await setMode.mutateAsync({
        organizationId,
        schoolId,
        mode: next ? "monthly_manual" : "monthly_auto",
      });
      await Promise.all([
        utils.fees.settings.get.invalidate(),
        utils.fees.dashboard.invalidate(),
      ]);
    } catch (cause) {
      setError(cause);
    }
  };

  const run = async (upTo: "this_month" | "rest") => {
    setError(null);
    setConfirming(false);
    try {
      await start.mutateAsync({
        organizationId,
        schoolId,
        data: { academicYearId, upTo, classId: upTo === "rest" && classId ? classId : null },
      });
      setStartedHere(true);
      await utils.fees.duesRun.latest.invalidate();
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={words.title}
      onClose={onClose}
      testIDPrefix="fee-dues-sheet"
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title={words.done}
            variant="secondary"
            size="compact"
            onPress={onClose}
            testID="fee-dues-done"
          />
        </View>
      }
    >
      <SwitchRow
        label={words.pauseLabel}
        value={paused}
        onChange={(next) => void togglePause(next)}
        help={paused ? words.pausedHelp : words.automaticHelp}
        disabled={!canPause || setMode.isPending || !settings.data}
        testID="fee-dues-pause"
      />

      {paused && canCreate ? (
        <CapsuleButton
          title={words.createThisMonth(thisMonth)}
          size="compact"
          disabled={running}
          loading={start.isPending}
          onPress={() => void run("this_month")}
          testID="fee-dues-this-month"
        />
      ) : null}

      {canCreate ? (
        <View style={styles.block}>
          <ThemedText variant="bodyStrong">{words.restTitle}</ThemedText>
          <ThemedText variant="meta">{words.restBody}</ThemedText>
          {classes.length > 1 ? (
            <SelectField
              label={words.classLabel}
              valueLabel={chosen?.name ?? words.allClasses}
              placeholder={words.allClasses}
              options={[
                { id: "", label: words.allClasses },
                ...classes.map((row) => ({ id: row.id, label: row.name })),
              ]}
              currentId={classId}
              onSelect={setClassId}
              testID="fee-dues-class"
            />
          ) : null}
          {confirming ? (
            <>
              <Notice
                tone="caution"
                message={words.restWarning(students, lastMonth)}
                testID="fee-dues-warning"
              />
              <View style={styles.row}>
                <CapsuleButton
                  title={words.cancel}
                  variant="secondary"
                  size="compact"
                  onPress={() => setConfirming(false)}
                  testID="fee-dues-cancel"
                />
                <CapsuleButton
                  title={words.confirm}
                  size="compact"
                  onPress={() => void run("rest")}
                  testID="fee-dues-confirm"
                />
              </View>
            </>
          ) : (
            <CapsuleButton
              title={words.restAction}
              variant="secondary"
              size="compact"
              disabled={running || students === 0}
              loading={start.isPending}
              onPress={() => setConfirming(true)}
              testID="fee-dues-rest"
            />
          )}
        </View>
      ) : null}

      {running ? (
        <Notice tone="neutral" message={words.running} testID="fee-dues-running" />
      ) : startedHere && latest.data?.status === "done" ? (
        <Notice
          tone={latest.data.failedCount > 0 ? "caution" : "positive"}
          message={words.finished(
            latest.data.insertedCount,
            latest.data.studentsWithNewDues,
            latest.data.failedCount,
          )}
          testID="fee-dues-result"
        />
      ) : startedHere && latest.data?.status === "failed" ? (
        <Notice tone="critical" message={words.failed} testID="fee-dues-failed" />
      ) : null}

      {error ? (
        <Notice tone="critical" message={toFriendlyError(error).message} testID="fee-dues-error" />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
});
