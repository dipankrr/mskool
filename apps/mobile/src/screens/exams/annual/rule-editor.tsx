import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { FactRow } from "../../../components/fact-row";
import { FormField } from "../../../components/form-field";
import { FormSheet } from "../../../components/form-sheet";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { SelectField } from "../../../components/select-field";
import { Skeleton } from "../../../components/skeleton";
import { SwitchRow } from "../../../components/switch-row";
import { ThemedText } from "../../../components/themed-text";
import { useActiveBranchName } from "../../../hooks/use-active-context";
import { useUnsavedChanges } from "../../../hooks/use-unsaved-changes";
import {
  ANNUAL_PRESETS,
  annualDirty,
  annualDraft,
  annualErrors,
  annualPayload,
  annualSummary,
  firstAnnualError,
  formatWeightTotal,
  hasAnnualErrors,
  togglePick,
  uncoveredPolicyScopes,
  weightTotal,
  withPreset,
} from "../../../lib/annual";
import type { AnnualDraft, AnnualPolicyRowLike, TermLite } from "../../../lib/annual";
import { annualCopy } from "../../../lib/annual-copy";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import { criteriaMeta } from "../../../lib/pass-criteria";
import type { CriteriaRowLike } from "../../../lib/pass-criteria";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { SummaryCard } from "../grading/ui";
import {
  useCriteriaClasses,
  useCriteriaSubjects,
  usePassCriteriaAdmin,
} from "../grading/use-grading";
import { useAnnualPolicies, useAnnualPolicyActions, useYearTerms } from "./use-annual";

type SubjectRow = inferRouterOutputs<AppRouter>["subject"]["list"][number];

const c = annualCopy.rules;

/**
 * ANNUAL RULE EDITOR (chunk 7G) - one screen for "new" and "edit".
 *
 * The "In short" card is the point: three plain lines rewritten live from the
 * draft, so the rule can be read before a control is touched. The five method
 * labels are presets over the server's three engines (ADR-053 §2); the scope
 * is chosen once and then only printed, because the unique indexes name it.
 */
export function AnnualRuleEditorScreen() {
  const { policyId } = useLocalSearchParams<{ policyId?: string }>();
  const scope = useExamScope();
  const branchName = useActiveBranchName();
  const policies = useAnnualPolicies();
  const classes = useCriteriaClasses();
  const subjects = useCriteriaSubjects();
  const criteria = usePassCriteriaAdmin();
  const { query: termsQuery, terms } = useYearTerms();

  const year = scope.academicYear;
  const isNew = !policyId;
  const rows = policies.data ?? [];
  const row = policyId ? (rows.find((entry) => entry.id === policyId) ?? null) : null;
  const defaultRow = rows.find((entry) => entry.classId === null) ?? null;
  const classRows = [...(classes.data ?? [])].sort(
    (a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name),
  );
  const options = uncoveredPolicyScopes(
    classRows.map((entry) => ({ id: entry.id, name: entry.name })),
    rows,
  );
  const allowed = isNew ? scope.canCreate : scope.canUpdate || scope.canCreate;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={isNew ? c.createTitle : c.editTitle}
      meta={copy.exams.meta(year?.name ?? null, branchName)}
      backAccessibilityLabel={copy.common.back}
      backTestID="annual-editor-back"
      titleTestID="annual-editor-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead || !allowed) {
    return frame(
      <EmptyState icon="lock" title={copy.exams.deniedTitle} message={copy.exams.deniedBody} testID="annual-editor-denied" />,
    );
  }
  if (scope.ready && !year) {
    return frame(
      <EmptyState icon="calendarOff" title={c.noSessionTitle} message={c.noSessionBody} testID="annual-editor-no-session" />,
    );
  }
  if (!scope.ready || policies.isPending || classes.isPending || subjects.isPending || criteria.isPending || termsQuery.isPending) {
    return frame(
      <View style={styles.skeletons} testID="annual-editor-loading">
        <Skeleton height={120} />
        <Skeleton height={84} />
        <Skeleton height={84} />
      </View>,
    );
  }
  const failure =
    policies.error ?? classes.error ?? subjects.error ?? criteria.error ?? termsQuery.error;
  if (failure) {
    return frame(
      <ErrorCard
        cause={failure}
        onRetry={() => {
          void policies.refetch();
          void classes.refetch();
          void subjects.refetch();
          void criteria.refetch();
          void termsQuery.refetch();
        }}
        testID="annual-editor-error"
      />,
    );
  }
  if (!isNew && !row) {
    return frame(
      <EmptyState icon="exams" title={c.gone} message={c.goneBody} testID="annual-editor-gone" />,
    );
  }
  if (isNew && options.length === 0) {
    return frame(
      <EmptyState icon="checkCircle" title={c.allScopesTitle} message={c.allScopesBody} testID="annual-editor-no-scope" />,
    );
  }
  if (terms.length === 0) {
    return frame(
      <EmptyState icon="calendarOff" title={c.termsNeeded} message="" testID="annual-editor-no-terms" />,
    );
  }

  return (
    <RuleForm
      key={row?.id ?? "new"}
      row={row as AnnualPolicyRowLike | null}
      defaultRow={defaultRow as AnnualPolicyRowLike | null}
      options={options}
      classRows={classRows}
      subjects={[...(subjects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
      criteriaRows={(criteria.data ?? []) as unknown as CriteriaRowLike[]}
      terms={terms}
      yearId={year!.id}
      yearName={year!.name}
    />
  );
}

function RuleForm({
  row,
  defaultRow,
  options,
  classRows,
  subjects,
  criteriaRows,
  terms,
  yearId,
  yearName,
}: {
  row: AnnualPolicyRowLike | null;
  defaultRow: AnnualPolicyRowLike | null;
  options: { id: string; label: string; detail?: string }[];
  classRows: { id: string; name: string }[];
  subjects: SubjectRow[];
  criteriaRows: CriteriaRowLike[];
  terms: TermLite[];
  yearId: string;
  yearName: string;
}) {
  const actions = useAnnualPolicyActions();
  const [scopeId, setScopeId] = useState<string | null>(() => {
    if (row) return row.classId ?? "";
    if (options.length === 1) return options[0]!.id;
    return null;
  });
  const [draft, setDraft] = useState<AnnualDraft>(() => annualDraft(row, terms, defaultRow));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(false);
  const [mandatoryOpen, setMandatoryOpen] = useState(false);

  const dirty = row ? annualDirty(draft, row) : touched;
  const errors = annualErrors(draft);
  const scopeMissing = !row && scopeId === null;
  const problem = scopeMissing ? c.appliesRequired : firstAnnualError(errors);
  const caption = submitted ? problem : null;

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;
  const classId = row ? row.classId : scopeId === "" ? null : scopeId;
  const termRule =
    criteriaRows.find((r) => classId !== null && r.classId === classId) ??
    criteriaRows.find((r) => r.classId === null) ??
    null;
  const termRuleLine = termRule ? criteriaMeta(termRule, subjectName).line1 : null;

  const scopeLabel = (() => {
    if (row) {
      return row.classId === null
        ? c.defaultRule
        : (classRows.find((e) => e.id === row.classId)?.name ?? c.classFallback);
    }
    if (scopeId === null) return null;
    return options.find((o) => o.id === scopeId)?.label ?? null;
  })();

  useUnsavedChanges(dirty && !saved, {
    title: c.unsavedTitle,
    body: c.unsavedBody,
    keepEditing: c.keepEditing,
    discard: c.leave,
  });
  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const change = (next: AnnualDraft) => {
    setTouched(true);
    setDraft(next);
  };

  const save = () => {
    setSubmitted(true);
    setError(null);
    if (scopeMissing || hasAnnualErrors(annualErrors(draft))) return;
    if (row && !dirty) {
      setSaved(true);
      return;
    }
    void (async () => {
      try {
        await actions.save(
          annualPayload(draft, { id: row?.id, academicYearId: yearId, classId }),
        );
        setSaved(true);
      } catch (cause) {
        setError(cause);
      }
    })();
  };

  const termName = (id: string) => terms.find((t) => t.id === id)?.name ?? "Term";
  const total = weightTotal(draft);
  const totalOk = total === 10000;

  return (
    <ScreenFrame
      title={row ? c.editTitle : c.createTitle}
      meta={[yearName, scopeLabel].filter(Boolean).join(" · ")}
      backAccessibilityLabel={copy.common.back}
      backTestID="annual-editor-back"
      titleTestID="annual-editor-title"
      footer={
        <View style={styles.footer}>
          {error ? <Notice tone="critical" message={errorMessage(error)} testID="annual-editor-save-error" /> : null}
          {caption ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
              testID="annual-editor-caption"
            >
              {caption}
            </ThemedText>
          ) : null}
          <CapsuleButton
            title={c.save}
            icon="check"
            loading={actions.pending}
            disabled={Boolean(row) && !dirty}
            onPress={save}
            testID="annual-editor-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <SummaryCard
          title={c.summaryTitle}
          lines={annualSummary(draft, terms, termRuleLine)}
          testID="annual-summary"
        />

        {row ? (
          <View style={styles.scope}>
            <Card padless>
              <FactRow label={c.appliesLabel} value={scopeLabel ?? c.defaultRule} first testID="annual-scope-readonly" />
            </Card>
            <ThemedText variant="meta" style={styles.hint}>
              {c.scopeLocked}
            </ThemedText>
          </View>
        ) : (
          <SelectField
            label={c.appliesLabel}
            valueLabel={scopeLabel}
            placeholder={c.appliesPlaceholder}
            options={options.map((o) => ({ id: o.id, label: o.label, detail: o.detail }))}
            currentId={scopeId ?? ""}
            onSelect={(next) => {
              setScopeId(next);
              setTouched(true);
            }}
            help={c.appliesHelp}
            error={submitted && scopeMissing ? c.appliesRequired : undefined}
            testID="annual-scope"
          />
        )}

        <Heading title={c.howTitle} />
        <SelectField
          label={c.howLabel}
          valueLabel={c.presets[draft.preset].label}
          placeholder={c.howLabel}
          options={ANNUAL_PRESETS.map((p) => ({
            id: p,
            label: c.presets[p].label,
            detail: c.presets[p].detail,
          }))}
          currentId={draft.preset}
          onSelect={(next) => change(withPreset(draft, next as AnnualDraft["preset"], terms))}
          help={c.presets[draft.preset].detail}
          testID="annual-method"
        />

        <Heading title={c.termsTitle} />
        <Card padless testID="annual-terms">
          {terms.map((term, index) => {
            const on = draft.picked.includes(term.id);
            return (
              <View key={term.id} style={[styles.termBlock, index === 0 ? null : styles.divider]}>
                <Pressable
                  accessibilityRole={draft.preset === "single" ? "radio" : "checkbox"}
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={term.name}
                  onPress={() => change(togglePick(draft, term.id, terms))}
                  style={({ pressed }) => [styles.termRow, pressed ? styles.pressed : null]}
                  testID={`annual-term-${term.id}`}
                >
                  <View
                    style={[
                      draft.preset === "single" ? styles.radio : styles.checkBox,
                      on ? styles.on : null,
                    ]}
                  >
                    {on ? <AppIcon name="check" size={14} color={colors.onAccent} /> : null}
                  </View>
                  <ThemedText variant="bodyStrong" style={styles.termName} numberOfLines={2}>
                    {term.name}
                  </ThemedText>
                </Pressable>
                {draft.preset === "weighted" && on ? (
                  <View style={styles.weight}>
                    <FormField
                      label={`${termName(term.id)} ${c.weightLabel.toLowerCase()}`}
                      value={draft.weights[term.id] ?? ""}
                      onChangeText={(next) =>
                        change({
                          ...draft,
                          weights: { ...draft.weights, [term.id]: next.replace(/[^0-9.]/g, "") },
                        })
                      }
                      keyboardType="decimal-pad"
                      suffix="%"
                      maxLength={6}
                      testID={`annual-weight-${term.id}`}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
        {draft.preset === "weighted" && draft.picked.length > 0 ? (
          <ThemedText
            variant="meta"
            color={totalOk ? colors.accentDeep : colors.tone.critical.fg}
            accessibilityLiveRegion="polite"
            style={styles.hint}
            testID="annual-weight-total"
          >
            {totalOk ? `Total ${formatWeightTotal(total)}% ✓` : `Total ${formatWeightTotal(total)}% - must be 100%`}
          </ThemedText>
        ) : (
          <ThemedText variant="meta" style={styles.hint}>
            {c.termsHelp}
          </ThemedText>
        )}
        {submitted && errors.terms ? (
          <ThemedText variant="meta" color={colors.tone.critical.fg} style={styles.hint}>
            {errors.terms}
          </ThemedText>
        ) : null}

        {draft.preset === "best" ? (
          <FormField
            label={c.bestNLabel}
            value={draft.bestN}
            onChangeText={(next) => change({ ...draft, bestN: next.replace(/[^0-9]/g, "") })}
            help={c.bestNHelp}
            error={submitted ? errors.bestN : undefined}
            keyboardType="number-pad"
            maxLength={2}
            testID="annual-best-n"
          />
        ) : null}

        <Heading title={c.passTitle} />
        <FormField
          label={c.passLabel}
          value={draft.passPercent}
          onChangeText={(next) => change({ ...draft, passPercent: next.replace(/[^0-9.]/g, "") })}
          help={c.passHelp}
          error={submitted ? errors.pass : undefined}
          keyboardType="decimal-pad"
          suffix="%"
          maxLength={6}
          testID="annual-pass-percent"
        />

        <Heading title={c.promotionTitle} />
        <SwitchRow
          label={c.sameRules}
          value={!draft.useOwnRules}
          onChange={(next) => change({ ...draft, useOwnRules: !next })}
          help={c.sameRulesHelp}
          testID="annual-same-rules"
        />
        {!draft.useOwnRules ? (
          <ThemedText variant="meta" style={styles.hint} testID="annual-term-rule-line">
            {termRuleLine ? c.sameRulesNow(termRuleLine) : c.sameRulesNone}
          </ThemedText>
        ) : (
          <>
            <FormField
              label={c.minSubjectsLabel}
              value={draft.rules.minSubjectsToPass}
              onChangeText={(next) =>
                change({ ...draft, rules: { ...draft.rules, minSubjectsToPass: next.replace(/[^0-9]/g, "") } })
              }
              help={c.minSubjectsHelp}
              error={submitted ? errors.minSubjects : undefined}
              keyboardType="number-pad"
              maxLength={2}
              testID="annual-min-subjects"
            />
            {subjects.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${c.mandatoryLabel}, ${
                  draft.rules.mandatoryPassSubjectIds
                    .map((id) => subjectName(id))
                    .filter(Boolean)
                    .join(", ") || c.mandatoryNone
                }`}
                onPress={() => setMandatoryOpen(true)}
                style={({ pressed }) => [styles.picker, pressed ? styles.pressed : null]}
                testID="annual-mandatory"
              >
                <View style={styles.pickerText}>
                  <ThemedText variant="caption">{c.mandatoryLabel}</ThemedText>
                  <ThemedText variant="bodyStrong" numberOfLines={2}>
                    {draft.rules.mandatoryPassSubjectIds
                      .map((id) => subjectName(id))
                      .filter(Boolean)
                      .join(", ") || c.mandatoryNone}
                  </ThemedText>
                </View>
                <AppIcon name="chevronDown" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
            <SwitchRow
              label={c.compartmentLabel}
              value={draft.rules.compartmentAllowed}
              onChange={(next) =>
                change({ ...draft, rules: { ...draft.rules, compartmentAllowed: next } })
              }
              help={c.compartmentHelp}
              testID="annual-compartment"
            />
            {draft.rules.compartmentAllowed ? (
              <FormField
                label={c.compartmentCapLabel}
                value={draft.rules.maxSubjectsForCompartment}
                onChangeText={(next) =>
                  change({
                    ...draft,
                    rules: { ...draft.rules, maxSubjectsForCompartment: next.replace(/[^0-9]/g, "") },
                  })
                }
                error={submitted ? errors.compartmentCap : undefined}
                keyboardType="number-pad"
                maxLength={2}
                testID="annual-compartment-cap"
              />
            ) : null}
            <FormField
              label={c.attendanceLabel}
              value={draft.rules.minAttendancePct}
              onChangeText={(next) =>
                change({ ...draft, rules: { ...draft.rules, minAttendancePct: next.replace(/[^0-9.]/g, "") } })
              }
              help={c.attendanceHelp}
              error={submitted ? errors.attendance : undefined}
              keyboardType="decimal-pad"
              suffix="%"
              maxLength={6}
              testID="annual-attendance"
            />
          </>
        )}
      </View>

      {mandatoryOpen ? (
        <MustPassSheet
          subjects={subjects}
          initialIds={draft.rules.mandatoryPassSubjectIds}
          onClose={() => setMandatoryOpen(false)}
          onApply={(ids) => {
            change({ ...draft, rules: { ...draft.rules, mandatoryPassSubjectIds: ids } });
            setMandatoryOpen(false);
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

function Heading({ title }: { title: string }) {
  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">{title}</ThemedText>
    </View>
  );
}

function MustPassSheet({
  subjects,
  initialIds,
  onClose,
  onApply,
}: {
  subjects: SubjectRow[];
  initialIds: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(initialIds);
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
  return (
    <FormSheet
      title={c.mandatoryTitle}
      onClose={onClose}
      testIDPrefix="annual-mandatory-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={c.mandatoryDone}
            icon="check"
            size="compact"
            onPress={() => onApply(picked)}
            testID="annual-mandatory-done"
          />
        </View>
      }
    >
      <ThemedText variant="meta" style={styles.sheetBody}>
        {c.mandatoryBody}
      </ThemedText>
      {subjects.map((subject) => {
        const checked = picked.includes(subject.id);
        return (
          <Pressable
            key={subject.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={subject.name}
            onPress={() => toggle(subject.id)}
            style={({ pressed }) => [styles.checkRow, pressed ? styles.pressed : null]}
            testID={`annual-subject-${subject.id}`}
          >
            <View style={[styles.checkBox, checked ? styles.on : null]}>
              {checked ? <AppIcon name="check" size={14} color={colors.onAccent} /> : null}
            </View>
            <ThemedText variant="body" style={styles.termName} numberOfLines={2}>
              {subject.name}
            </ThemedText>
          </Pressable>
        );
      })}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm, paddingBottom: spacing.lg },
  skeletons: { gap: spacing.md },
  footer: { gap: spacing.sm },
  scope: { gap: spacing.xs },
  hint: { paddingHorizontal: spacing.xs },
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  termBlock: { paddingBottom: spacing.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  termRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  termName: { flex: 1 },
  weight: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  pressed: { backgroundColor: colors.field },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  on: { borderColor: colors.accent, backgroundColor: colors.accent },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: 56,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  pickerText: { flex: 1, gap: spacing.xxs },
  sheetFooter: { flexDirection: "row", justifyContent: "flex-end" },
  sheetBody: { marginTop: spacing.sm, marginBottom: spacing.md },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
});
