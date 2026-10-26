import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { monthLabel } from "../../lib/fees";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { SectionHead } from "./status";

type Mode = "all_now" | "monthly_auto" | "monthly_manual";

const MODES: readonly Mode[] = ["all_now", "monthly_auto", "monthly_manual"];

/** "2026-11" → the last day of that month, ISO. */
function endOfMonth(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const last = new Date(year, month, 0).getDate();
  return `${key}-${String(last).padStart(2, "0")}`;
}

/** Month keys from `from` through `to`, inclusive ("2026-10" … "2027-03"). */
function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/**
 * When a school's dues are created (ADR-051) — on the setup hub. All at once
 * is the original behaviour; the monthly modes create dues up to the current
 * month and add each month as it arrives (automatically, or when someone
 * presses "Generate dues"). A month's price is the same either way, so the
 * choice changes timing, never amounts.
 */
export function GenerationCard() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();
  const sessionOpen = useSessionOpen();
  const canRead = has("fee_structure:read");
  const canChange = has("fee_structure:update") && sessionOpen;
  const canGenerate = has("student_fee_assignment:update") && sessionOpen;

  const enabled =
    ready && canRead && Boolean(organizationId) && Boolean(schoolId);
  const settings = trpc.fees.settings.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled, staleTime: 60_000 },
  );
  const setMode = trpc.fees.settings.setGenerationMode.useMutation();
  const generate = trpc.fees.assignment.generateThrough.useMutation();
  const utils = trpc.useUtils();

  const currentMonth = todayIso().slice(0, 7);
  const options = useMemo(() => {
    if (!academicYear) return [];
    const start =
      academicYear.startDate.slice(0, 7) > currentMonth
        ? academicYear.startDate.slice(0, 7)
        : currentMonth;
    return monthKeys(start, academicYear.endDate.slice(0, 7)).map((key) => ({
      id: key,
      label: `${monthLabel(Number(key.slice(5, 7)))} ${key.slice(0, 4)}`,
    }));
  }, [academicYear, currentMonth]);

  const [throughKey, setThroughKey] = useState<string | null>(null);
  const chosen = throughKey ?? options[0]?.id ?? null;
  const [result, setResult] = useState<{
    tone: "positive" | "caution" | "critical";
    message: string;
  } | null>(null);

  if (!enabled || !settings.data) return null;
  const mode = settings.data.mode as Mode;
  const monthly = mode !== "all_now";

  const change = async (next: Mode) => {
    if (next === mode) return;
    setResult(null);
    try {
      await setMode.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        mode: next,
      });
      await utils.fees.settings.get.invalidate();
    } catch (cause) {
      setResult({ tone: "critical", message: toFriendlyError(cause).message });
    }
  };

  const run = async () => {
    if (!chosen || !academicYear) return;
    setResult(null);
    try {
      const out = await generate.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        data: { academicYearId: academicYear.id, through: endOfMonth(chosen) },
      });
      await Promise.all([
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.installment.dues.invalidate(),
      ]);
      const label = options.find((o) => o.id === chosen)?.label ?? chosen;
      setResult({
        tone: out.failed.length > 0 ? "caution" : "positive",
        message: copy.fees.generation.done(
          out.inserted,
          out.studentsWithNewDues,
          label,
          out.failed.length,
        ),
      });
    } catch (cause) {
      setResult({ tone: "critical", message: toFriendlyError(cause).message });
    }
  };

  return (
    <View style={styles.section}>
      <SectionHead
        title={copy.fees.generation.title}
        hint={copy.fees.generation.hint}
      />
      <Card style={styles.card}>
        {canChange ? (
          <ChoicePills
            label={copy.fees.generation.modeLabel}
            value={mode}
            options={MODES.map((value) => ({
              value,
              label: copy.fees.generation.modes[value],
            }))}
            onChange={(next) => void change(next)}
            testIDPrefix="fee-generation-mode"
          />
        ) : (
          <ThemedText variant="bodyStrong">
            {copy.fees.generation.modes[mode]}
          </ThemedText>
        )}
        <ThemedText variant="meta">
          {copy.fees.generation.explain[mode]}
        </ThemedText>

        {monthly && canGenerate && options.length > 0 ? (
          <View style={styles.generate}>
            <SelectField
              label={copy.fees.generation.throughLabel}
              valueLabel={options.find((o) => o.id === chosen)?.label ?? null}
              placeholder={copy.fees.generation.throughLabel}
              options={options}
              currentId={chosen ?? ""}
              onSelect={setThroughKey}
              testID="fee-generation-through"
            />
            <CapsuleButton
              title={copy.fees.generation.action}
              icon="check"
              size="compact"
              loading={generate.isPending}
              onPress={() => void run()}
              testID="fee-generation-run"
            />
          </View>
        ) : null}

        {result ? (
          <Notice
            tone={result.tone}
            message={result.message}
            testID="fee-generation-result"
          />
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.md,
  },
  generate: {
    gap: spacing.sm,
  },
});
