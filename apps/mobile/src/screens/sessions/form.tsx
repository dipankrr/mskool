import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveContext,
  type AcademicYear,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  matchedStartYear,
  sessionFromStartYear,
  sessionStartYearOptions,
} from "../../lib/session-dates";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import {
  initialSessionForm,
  isSessionFormDirty,
  isStartYearTaken,
  sessionFormFrom,
  sessionFormHasErrors,
  sessionPayload,
  validateSessionForm,
  type ExistingSession,
  type SessionForm,
  type SessionFormField,
} from "./session-form";

/**
 * Create or edit an academic session (Step 1 chunk B).
 *
 * Create is a year choice first — the preset fills 1 April, 31 March and the
 * name — with the dates still editable beneath it for a school that runs
 * different months. Edit is always manual, because deriving dates from a year
 * would silently discard an amendment someone made deliberately.
 *
 * The form is the branch's writer: `academic.year.update` is the permission
 * behind both "save these dates" and "make this the running session". The
 * running transition is a separate confirm because it changes what every
 * colleague sees, and it is disabled while the form is dirty — you cannot
 * promote dates that are not saved yet.
 */
export function SessionFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, schoolId, branches, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("academic_year:read");
  const canCreate = has("academic_year:create");
  const canUpdate = has("academic_year:update");

  const yearQuery = trpc.academic.year.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    {
      enabled: ready && Boolean(organizationId) && editing && canRead,
      // See the branch form: a cached row would mount the body with values
      // from before the save. An edit opens on the server's current row.
      gcTime: 0,
    },
  );
  const list = trpc.academic.year.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: ready && Boolean(organizationId) && canRead,
      staleTime: 300_000,
    },
  );

  const title = editing ? copy.sessions.editTitle : copy.sessions.addTitle;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={title}
      backAccessibilityLabel={copy.common.back}
      backTestID="session-form-back"
      titleTestID="session-form-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!ready) {
    return frame(<Skeleton height={260} />);
  }

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.sessionsReadTitle}
        message={copy.denied.sessionsReadBody}
        testID="session-form-denied"
      />,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="sessions"
        title={copy.branches.noOrgTitle}
        message={copy.branches.noOrgBody}
        testID="session-form-no-org"
      />,
    );
  }

  // Create names its parent branch; without one the request cannot be formed.
  if (!editing && !schoolId) {
    return frame(
      <EmptyState
        icon="branches"
        title={copy.sessions.noBranchTitle}
        message={copy.sessions.noBranchBody}
        testID="session-form-no-branch"
      >
        <CapsuleButton
          title={copy.sessions.noBranchAction}
          variant="secondary"
          onPress={() => router.replace("/more")}
          testID="session-form-no-branch-action"
        />
      </EmptyState>,
    );
  }

  if (!(editing ? canUpdate : canCreate)) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.sessionsWriteTitle}
        message={copy.denied.sessionsWriteBody}
        testID="session-form-denied-write"
      />,
    );
  }

  if (editing && yearQuery.isPending) {
    return frame(
      <View style={styles.skeleton} accessibilityLabel={copy.sessions.loading}>
        <Skeleton height={96} />
        <Skeleton height={260} />
      </View>,
    );
  }

  if (editing && yearQuery.isError) {
    return frame(
      <ErrorCard
        cause={yearQuery.error}
        onRetry={() => void yearQuery.refetch()}
        testID="session-form-error"
      />,
    );
  }

  if (editing && !yearQuery.data) {
    return frame(
      <ErrorCard
        cause={new Error(copy.errors.notFound)}
        onRetry={() => void yearQuery.refetch()}
        testID="session-form-missing"
      />,
    );
  }

  // The overlap rules need the branch's other years. Creating without that
  // list would mean discovering an overlap only after the server refuses it.
  if (list.isPending) {
    return frame(
      <View style={styles.skeleton} accessibilityLabel={copy.sessions.loading}>
        <Skeleton height={96} />
        <Skeleton height={260} />
      </View>,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="session-form-list-error"
      />,
    );
  }

  const session = yearQuery.data ?? null;
  // An edit is owned by its own row's branch; a create by the active branch.
  // The active branch can change underneath a cold deep link, and checking
  // overlap against the wrong school would be worse than showing one error.
  const targetSchoolId = session?.schoolId ?? schoolId;
  const existing = (list.data ?? []).filter(
    (year) => year.schoolId === targetSchoolId,
  );
  const branchName =
    branches.length > 1
      ? (branches.find((branch) => branch.id === targetSchoolId)?.name ?? null)
      : null;

  return (
    <SessionFormBody
      organizationId={organizationId}
      schoolId={schoolId}
      branchName={branchName}
      session={session}
      existing={existing}
    />
  );
}

function SessionFormBody({
  organizationId,
  schoolId,
  branchName,
  session,
  existing,
}: {
  organizationId: string;
  schoolId: string | null;
  branchName: string | null;
  session: AcademicYear | null;
  existing: ExistingSession[];
}) {
  const editing = Boolean(session);
  const [initial] = useState<SessionForm>(() =>
    session ? sessionFormFrom(session) : initialSessionForm(existing),
  );
  const [form, setForm] = useState<SessionForm>(initial);
  const [touched, setTouched] = useState<Set<SessionFormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [runningError, setRunningError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const errors = useMemo(
    () => validateSessionForm(form, existing, session?.id),
    [form, existing, session?.id],
  );
  const hasErrors = sessionFormHasErrors(errors);
  const dirty = isSessionFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved);

  // The guard has to see `saved` before the screen leaves; navigating in the
  // same tick as the state change would prompt after a successful write.
  useEffect(() => {
    if (!saved) return;
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/sessions");
    }
  }, [saved]);

  const { academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const create = trpc.academic.year.create.useMutation();
  const update = trpc.academic.year.update.useMutation();
  const setCurrent = trpc.academic.year.setCurrent.useMutation();
  const pending = create.isPending || update.isPending || setCurrent.isPending;

  const startYears = sessionStartYearOptions();
  const selectedStartYear = matchedStartYear(form, startYears);

  const set = (field: SessionFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: SessionFormField) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: SessionFormField) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  /** Choosing a preset rewrites all three values: they are one decision. */
  const applyStartYear = (year: string) => {
    setForm(sessionFromStartYear(Number(year)));
    setSaveError(null);
  };

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;

    try {
      if (session) {
        await update.mutateAsync({
          organizationId,
          id: session.id,
          data: sessionPayload(form),
        });
      } else {
        if (!schoolId) return;
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: sessionPayload(form),
        });
      }
      // Await both so the list cannot show the old running session or stale
      // dates after returning; the context provider shares the list key.
      await Promise.all([
        utils.academic.year.list.invalidate(),
        utils.academic.year.byId.invalidate(),
      ]);
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const makeRunning = async (yearId: string) => {
    setRunningError(null);
    try {
      await setCurrent.mutateAsync({ organizationId, id: yearId });
      await Promise.all([
        utils.academic.year.list.invalidate(),
        utils.academic.year.byId.invalidate(),
      ]);
      setSaved(true);
    } catch (error) {
      setRunningError(error);
    }
  };

  const confirmMakeRunning = () => {
    if (!session) return;
    Alert.alert(
      copy.sessions.makeRunningConfirmTitle,
      copy.sessions.makeRunningConfirmBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.sessions.makeRunningConfirm,
          onPress: () => void makeRunning(session.id),
        },
      ],
    );
  };

  return (
    <ScreenFrame
      title={editing ? copy.sessions.editTitle : copy.sessions.addTitle}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="session-form-back"
      titleTestID="session-form-title"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="session-save-error"
            />
          ) : null}
          {runningError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(runningError).message}
              testID="session-running-error"
            />
          ) : null}
          {submitted && hasErrors ? (
            <Notice
              tone="critical"
              message={copy.forms.invalidSummary}
              testID="session-invalid"
            />
          ) : null}
          <CapsuleButton
            title={editing ? copy.sessions.save : copy.sessions.add}
            icon="check"
            onPress={() => void submit()}
            loading={create.isPending || update.isPending}
            disabled={pending || saved}
            testID="session-save"
            style={styles.save}
          />
        </>
      }
    >
      {!session && !academicYear ? (
        <Notice
          tone="neutral"
          icon="info"
          message={copy.sessions.firstRunsNote}
          testID="session-first-runs"
        />
      ) : null}
      {session?.isCurrent ? (
        <Notice
          tone="positive"
          title={copy.sessions.runningNoticeTitle}
          message={copy.sessions.runningNoticeBody}
          testID="session-running-notice"
        />
      ) : session ? (
        <Notice
          tone="neutral"
          title={copy.sessions.makeRunningTitle}
          message={copy.sessions.makeRunningBody}
          testID="session-make-running"
        >
          <CapsuleButton
            title={copy.sessions.makeRunningAction}
            icon="sessions"
            variant="secondary"
            size="compact"
            onPress={confirmMakeRunning}
            loading={setCurrent.isPending}
            disabled={dirty || pending}
            testID="session-make-running-action"
          />
          {dirty ? (
            <ThemedText variant="meta" style={styles.runningHint}>
              {copy.sessions.makeRunningDirty}
            </ThemedText>
          ) : null}
        </Notice>
      ) : null}

      {!session ? (
        <Card style={styles.card}>
          <ChoicePills
            label={copy.sessions.startYearLabel}
            value={
              selectedStartYear === null ? null : String(selectedStartYear)
            }
            options={startYears.map((year) => {
              const taken = isStartYearTaken(year, existing);
              return {
                value: String(year),
                label: sessionFromStartYear(year).name,
                ...(taken
                  ? {
                      note: copy.sessions.alreadyAdded,
                      disabled: true,
                    }
                  : {}),
              };
            })}
            onChange={applyStartYear}
            help={copy.sessions.startYearHelp}
            testIDPrefix="session-start-year"
          />
        </Card>
      ) : null}

      <SectionLabel>{copy.sessions.detailsGroup}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.sessions.fields.name}
          value={form.name}
          onChangeText={(name) => set("name", name)}
          onBlur={() => touch("name")}
          help={copy.sessions.fields.nameHelp}
          error={fieldError("name")}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          testID="session-name"
        />
        <DateField
          label={copy.sessions.fields.startDate}
          value={form.startDate || null}
          onChange={(startDate) => {
            set("startDate", startDate);
            touch("startDate");
            touch("endDate");
          }}
          error={fieldError("startDate")}
          testID="session-start-date"
        />
        <DateField
          label={copy.sessions.fields.endDate}
          value={form.endDate || null}
          onChange={(endDate) => {
            set("endDate", endDate);
            touch("endDate");
            touch("startDate");
          }}
          help={copy.sessions.fields.datesHelp}
          error={fieldError("endDate")}
          testID="session-end-date"
        />
      </Card>
    </ScreenFrame>
  );
}

/** A quiet line under the disabled make-running control is rendered inline. */

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  save: {
    alignSelf: "stretch",
  },
  skeleton: {
    gap: spacing.md,
  },
  runningHint: {
    marginTop: spacing.sm,
  },
});
