import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  branchFormFrom,
  branchFormHasErrors,
  branchPayload,
  isBranchFormDirty,
  normaliseBranchCode,
  validateBranchForm,
  type BranchBoard,
  type BranchForm,
  type BranchFormField,
} from "./branch-form";

type Branch = inferRouterOutputs<AppRouter>["school"]["byId"];

const BOARDS: BranchBoard[] = ["cbse", "icse", "state", "ib", "unaffiliated"];

/**
 * Create or edit a branch (Step 1 chunk B).
 *
 * The route decides between the two modes by `id`: create mounts the form
 * immediately with the contract's defaults, edit loads `school.byId` first so
 * a cold deep link is the row's truth rather than a list cache. The body only
 * mounts once the row exists, so its initial values are initialised once and a
 * refetch can never overwrite what the user is typing.
 *
 * Closing is on the edit screen because it needs the branch named and its
 * consequence read; it is one-way here (`school.list` is active-only), which
 * the notice says outright.
 */
export function BranchFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canCreate = has("school:create");
  const canUpdate = has("school:update");
  const canDelete = has("school:delete");
  const canRead = has("school:read");
  const allowed = editing
    ? canRead && (canUpdate || canDelete)
    : canRead && canCreate;

  const branchQuery = trpc.school.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    {
      enabled: ready && Boolean(organizationId) && editing && canRead,
      // A form is a snapshot, not a live view: the body initialises from this
      // row once. Keeping it cached across opens made a saved phone/address
      // reappear as the pre-edit value (stale-while-revalidate mounts the body
      // before the refetch lands). Dropping it on unmount makes every open a
      // fresh read.
      gcTime: 0,
    },
  );

  const title = editing ? copy.branches.editTitle : copy.branches.addTitle;

  if (!ready) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="branch-form-back"
      >
        <Skeleton height={220} />
      </ScreenFrame>
    );
  }

  if (!organizationId) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="branch-form-back"
      >
        <EmptyState
          icon="branches"
          title={copy.branches.noOrgTitle}
          message={copy.branches.noOrgBody}
        />
      </ScreenFrame>
    );
  }

  if (!allowed) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="branch-form-back"
      >
        <EmptyState
          icon="shield"
          title={copy.denied.branchesWriteTitle}
          message={copy.denied.branchesWriteBody}
          testID="branch-form-denied"
        />
      </ScreenFrame>
    );
  }

  if (editing && branchQuery.isPending) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="branch-form-back"
      >
        <View style={styles.skeleton} accessibilityLabel={copy.branches.loading}>
          <Skeleton height={28} width="56%" />
          <Skeleton height={180} />
          <Skeleton height={180} />
        </View>
      </ScreenFrame>
    );
  }

  if (editing && branchQuery.isError) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="branch-form-back"
      >
        <ErrorCard
          cause={branchQuery.error}
          onRetry={() => void branchQuery.refetch()}
          testID="branch-form-error"
        />
      </ScreenFrame>
    );
  }

  if (editing && !branchQuery.data) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="branch-form-back"
      >
        <ErrorCard
          cause={new Error(copy.errors.notFound)}
          onRetry={() => void branchQuery.refetch()}
          testID="branch-form-missing"
        />
      </ScreenFrame>
    );
  }

  return (
    <BranchFormBody
      organizationId={organizationId}
      branch={branchQuery.data ?? null}
      canUpdate={editing ? canUpdate : canCreate}
      canDelete={editing && canDelete}
    />
  );
}

function BranchFormBody({
  organizationId,
  branch,
  canUpdate,
  canDelete,
}: {
  organizationId: string;
  branch: Branch | null;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const editing = Boolean(branch);
  const [initial] = useState<BranchForm>(() => branchFormFrom(branch));
  const [form, setForm] = useState<BranchForm>(initial);
  const [touched, setTouched] = useState<Set<BranchFormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [closeError, setCloseError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [closing, setClosing] = useState(false);

  const errors = useMemo(() => validateBranchForm(form), [form]);
  const hasErrors = branchFormHasErrors(errors);
  const dirty = isBranchFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved);

  // The guard must see `saved` first; navigating in the same tick as the state
  // change would still meet `dirty` and prompt after a successful write.
  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const utils = trpc.useUtils();
  const create = trpc.school.create.useMutation();
  const update = trpc.school.update.useMutation();
  const deactivate = trpc.school.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivate.isPending;

  const set = (field: BranchFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: BranchFormField) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: BranchFormField) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;

    try {
      if (branch) {
        await update.mutateAsync({
          organizationId,
          id: branch.id,
          data: branchPayload(form),
        });
      } else {
        await create.mutateAsync({
          organizationId,
          data: branchPayload(form),
        });
      }
      // Await both so More cannot flash a closed branch or a stale list.
      await Promise.all([
        utils.school.list.invalidate(),
        utils.me.get.invalidate(),
      ]);
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmClose = () => {
    if (!branch) return;
    Alert.alert(copy.branches.closeConfirmTitle, copy.branches.closeConfirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.branches.closeConfirm,
        style: "destructive",
        onPress: () => void close(branch.id),
      },
    ]);
  };

  const close = async (id: string) => {
    setCloseError(null);
    setClosing(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await Promise.all([
        utils.school.list.invalidate(),
        utils.me.get.invalidate(),
      ]);
      setSaved(true);
    } catch (error) {
      setCloseError(error);
    } finally {
      setClosing(false);
    }
  };

  const frameTitle = editing ? copy.branches.editTitle : copy.branches.addTitle;

  return (
    <ScreenFrame
      title={frameTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="branch-form-back"
      footer={
        canUpdate ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="branch-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="branch-invalid"
              />
            ) : null}
            <CapsuleButton
              title={editing ? copy.branches.save : copy.branches.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="branch-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      {!canUpdate ? (
        <Notice
          tone="neutral"
          message={copy.forms.readOnly}
          testID="branch-read-only"
        />
      ) : null}

      <SectionLabel>{copy.branches.sections.basics}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.branches.fields.name}
          value={form.name}
          onChangeText={(name) => set("name", name)}
          onBlur={() => touch("name")}
          help={copy.branches.fields.nameHelp}
          error={fieldError("name")}
          autoCapitalize="words"
          editable={canUpdate}
          testID="branch-name"
        />
        <FormField
          label={copy.branches.fields.legalName}
          value={form.legalName}
          onChangeText={(legalName) => set("legalName", legalName)}
          onBlur={() => touch("legalName")}
          help={copy.branches.fields.legalNameHelp}
          error={fieldError("legalName")}
          autoCapitalize="words"
          editable={canUpdate}
          testID="branch-legal-name"
        />
        <FormField
          label={copy.branches.fields.code}
          value={form.code}
          onChangeText={(code) => set("code", normaliseBranchCode(code))}
          onBlur={() => touch("code")}
          help={copy.branches.fields.codeHelp}
          error={fieldError("code")}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={50}
          editable={canUpdate}
          testID="branch-code"
        />
        <SelectField
          label={copy.branches.fields.board}
          valueLabel={copy.branches.boards[form.board]}
          placeholder={copy.branches.boards.cbse}
          options={BOARDS.map((board) => ({
            id: board,
            label: copy.branches.boards[board],
          }))}
          currentId={form.board}
          onSelect={(board) => set("board", board)}
          help={copy.branches.fields.boardHelp}
          disabled={!canUpdate}
          testID="branch-board"
        />
      </Card>

      <SectionLabel>{copy.branches.sections.contact}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.branches.fields.phone}
          value={form.phone}
          onChangeText={(phone) => set("phone", phone)}
          onBlur={() => touch("phone")}
          error={fieldError("phone")}
          keyboardType="phone-pad"
          maxLength={20}
          editable={canUpdate}
          testID="branch-phone"
        />
        <FormField
          label={copy.branches.fields.email}
          value={form.email}
          onChangeText={(email) => set("email", email)}
          onBlur={() => touch("email")}
          error={fieldError("email")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={canUpdate}
          testID="branch-email"
        />
        <FormField
          label={copy.branches.fields.city}
          value={form.city}
          onChangeText={(city) => set("city", city)}
          autoCapitalize="words"
          editable={canUpdate}
          testID="branch-city"
        />
        <FormField
          label={copy.branches.fields.state}
          value={form.state}
          onChangeText={(state) => set("state", state)}
          autoCapitalize="words"
          editable={canUpdate}
          testID="branch-state"
        />
        <FormField
          label={copy.branches.fields.pincode}
          value={form.pincode}
          onChangeText={(pincode) => set("pincode", pincode)}
          onBlur={() => touch("pincode")}
          error={fieldError("pincode")}
          keyboardType="number-pad"
          maxLength={6}
          editable={canUpdate}
          testID="branch-pincode"
        />
      </Card>

      <SectionLabel>{copy.branches.sections.records}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.branches.fields.udiseCode}
          value={form.udiseCode}
          onChangeText={(udiseCode) => set("udiseCode", udiseCode)}
          onBlur={() => touch("udiseCode")}
          help={copy.branches.fields.udiseHelp}
          error={fieldError("udiseCode")}
          keyboardType="number-pad"
          maxLength={11}
          editable={canUpdate}
          testID="branch-udise"
        />
      </Card>

      {branch && canDelete ? (
        <View style={styles.close}>
          <Notice
            tone="caution"
            title={copy.branches.closeNoticeTitle}
            message={copy.branches.closeNoticeBody}
          >
            <CapsuleButton
              title={copy.branches.closeAction}
              variant="destructive"
              size="compact"
              onPress={confirmClose}
              loading={closing}
              disabled={pending}
              testID="branch-close"
            />
          </Notice>
          {closeError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(closeError).message}
              testID="branch-close-error"
              style={styles.closeError}
            />
          ) : null}
        </View>
      ) : null}
    </ScreenFrame>
  );
}

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
  close: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  closeError: {
    backgroundColor: colors.tone.critical.bg,
  },
});
