"use client";

import type {
  CreateStaffInput,
  DeactivateStaffInput,
  RoleType,
  UpdateStaffInput,
} from "@repo/contracts";
import { toast } from "sonner";

import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";

/**
 * STAFF — the employment register and its roles.
 *
 * The list is permissive (`staff.list` clips to the caller's grants), so HR
 * at any scope searches the same register and sees exactly who they may see.
 * Create names the branch explicitly — the register attributes an employee
 * to their primary posting, and `writeScopeArgs()` returning null is the
 * "choose a branch first" state.
 *
 * Row-addressed calls (byId, update, deactivate, login acts) address the
 * ROW via its owner-resolved node. The login mutations are gated
 * `staff:update` server-side (ADR-035); `role.assign`/`role.revoke` are
 * SENSITIVE permissions — their gates re-read assignments fresh, and every
 * grant/revoke also invalidates the TARGET's cache snapshot server-side.
 *
 * The role-assignment queries are deliberately decoupled from the register
 * read: a principal holds `role_assignment:read` but the matrix read is its
 * own permission, and each card degrades per permission, not per page.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useStaffList(q?: string, includeInactive?: boolean) {
  const { scopeArgs } = useActiveContext();

  return trpc.staff.list.useQuery(
    {
      ...scopeArgs(),
      q: q || undefined,
      includeInactive: includeInactive || undefined,
    },
    { staleTime: THIRTY_SECONDS },
  );
}

/** One staff member, owner-resolved (the B6 overlap read). */
export function useStaff(staffId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.staff.byId.useQuery(
    { ...scopeArgs(), id: staffId },
    {
      enabled: Boolean(staffId),
      staleTime: THIRTY_SECONDS,
      // A stale id after a deactivation is a NOT_FOUND; re-asking cannot
      // change it.
      retry: false,
    },
  );
}

/** The staff member's ACTIVE role assignments, labeled for display. */
export function useStaffRoles(userId?: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.role.assignments.useQuery(
    { ...scopeArgs(), userId: userId ?? "" },
    { enabled: Boolean(userId), staleTime: THIRTY_SECONDS },
  );
}

/** The org's role → permission matrix, read-only (ADR-035 defers editing). */
export function useRolePermissions(enabled: boolean) {
  const { scopeArgs } = useActiveContext();

  return trpc.role.permissions.useQuery(scopeArgs(), {
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useStaffMutations() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await Promise.all([
      utils.staff.list.invalidate(),
      utils.staff.byId.invalidate(),
      utils.role.assignments.invalidate(),
    ]);
  };

  const create = trpc.staff.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.created);
      await refresh();
    },
    // A duplicate employee code arrives already worded (ADR-026 maps the
    // unique index); errorMessage only guards anything that is not.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.staff.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deactivate = trpc.staff.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.deactivated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createLogin = trpc.staff.createLogin.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.loginCreated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resetLogin = trpc.staff.resetLogin.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.loginResetDone);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      submit: (data: CreateStaffInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to add a staff member.");
        return create.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
    update: {
      ...update,
      submit: (id: string, data: UpdateStaffInput) =>
        update.mutateAsync({ ...scopeArgs(), id, data }),
    },
    deactivate: {
      ...deactivate,
      submit: (id: string, data: DeactivateStaffInput) =>
        deactivate.mutateAsync({ ...scopeArgs(), id, data }),
    },
    createLogin: {
      ...createLogin,
      submit: (id: string, password: string) =>
        createLogin.mutateAsync({ ...scopeArgs(), id, password }),
    },
    resetLogin: {
      ...resetLogin,
      submit: (id: string, password: string) =>
        resetLogin.mutateAsync({ ...scopeArgs(), id, password }),
    },
  };
}

export function useRoleMutations() {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await utils.role.assignments.invalidate();
  };

  const assign = trpc.role.assign.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.roleGranted);
      await refresh();
    },
    // The grant's own refusals (no staff record, foreign scope, duplicate)
    // arrive worded; errorMessage guards anything that is not.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revoke = trpc.role.revoke.useMutation({
    onSuccess: async () => {
      toast.success(copy.staff.roleRevoked);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    assign: {
      ...assign,
      submit: (input: {
        id: string;
        userId: string;
        roleType: RoleType;
        scopeType: "org" | "school";
        expiresAt?: string;
      }) => assign.mutateAsync({ ...scopeArgs(), ...input }),
    },
    revoke: {
      ...revoke,
      submit: (id: string, reason: string) =>
        revoke.mutateAsync({ ...scopeArgs(), id, reason }),
    },
  };
}
