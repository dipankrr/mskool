"use client";

import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  usePermissionDefaults,
  usePermissionMutations,
} from "@/features/staff/use-staff";
import { copy } from "@/lib/copy";
import type { RoleType } from "@repo/contracts";

/**
 * THE PERMISSION EDITOR (ADR-036) — one role's matrix as grouped checkboxes.
 *
 * The workflow, deliberately: open → scan resources grouped by category →
 * tick or untick actions → read the dirty bar ("2 to grant · 1 to
 * withdraw") → Save → ONE consequence-stating confirm → the diff applies in
 * a single batched mutation. No per-click writes on an authorization
 * surface: checkboxes are the DRAFT, chips on the card are the TRUTH, and
 * the server's answer — never an optimistic guess — moves the truth.
 *
 * The two ADR-036 locks render where they can and refuse where they must:
 * `org_admin` never opens this dialog (the card renders it locked), and a
 * role the caller personally holds opens but is refused server-side with
 * the honest wording — the client does not know the caller's roles.
 *
 * "Reset to defaults" is the safety hatch: diff-only on the server, its own
 * confirm with the change count, disabled when the role already matches.
 */

const prettify = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");

export function PermissionEditorDialog({
  open,
  onOpenChange,
  roleType,
  roleLabel,
  currentPermissions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleType: RoleType;
  roleLabel: string;
  /** The role's CURRENT matrix rows — the truth this editor drafts against. */
  currentPermissions: string[];
}) {
  const defaultsQuery = usePermissionDefaults(open);
  const { update, reset } = usePermissionMutations();

  const [draft, setDraft] = useState<Set<string>>(new Set(currentPermissions));
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const catalog = useMemo(() => defaultsQuery.data?.catalog ?? [], [defaultsQuery.data]);
  const defaultsForRole = useMemo(() => {
    const rows = defaultsQuery.data?.defaults ?? [];
    return new Set(
      rows.filter((r) => r.roleType === roleType).map((r) => r.permission),
    );
  }, [defaultsQuery.data, roleType]);

  const current = useMemo(() => new Set(currentPermissions), [currentPermissions]);

  const added = [...draft].filter((p) => !current.has(p));
  const removed = [...current].filter((p) => !draft.has(p));
  const dirty = added.length > 0 || removed.length > 0;

  const differsFromDefaults =
    defaultsForRole.size > 0 &&
    (addedOfDefaults(defaultsForRole, current).length > 0 ||
      [...current].some((p) => !defaultsForRole.has(p)));

  const filter = search.trim().toLowerCase();

  const visibleCatalog = useMemo(
    () =>
      catalog
        .map((category) => ({
          ...category,
          resources: category.resources
            .map((resource) => ({
              ...resource,
              actions: resource.actions.filter(
                (action) =>
                  !filter ||
                  resource.resource.includes(filter) ||
                  action.includes(filter),
              ),
            }))
            .filter((resource) => resource.actions.length > 0),
        }))
        .filter((category) => category.resources.length > 0),
    [catalog, filter],
  );

  const toggle = (permission: string, checked: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  };

  const save = async () => {
    try {
      await update.submit({ roleType, add: added, remove: removed });
      setConfirmOpen(false);
      onOpenChange(false);
    } catch {
      // The worded refusal is toasted by the hook; the editor stays open
      // with the draft intact.
      setConfirmOpen(false);
    }
  };

  const applyReset = async () => {
    try {
      await reset.submit(roleType);
      setResetOpen(false);
      onOpenChange(false);
    } catch {
      setResetOpen(false);
    }
  };

  const resetChangeCount =
    addedOfDefaults(defaultsForRole, current).length +
    [...current].filter((p) => !defaultsForRole.has(p)).length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {copy.staff.editorTitle} — {roleLabel}
            </DialogTitle>
            <DialogDescription>{copy.staff.editorHelp}</DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.staff.editorSearchPlaceholder}
              aria-label={copy.staff.editorSearch}
            />
          </div>

          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {defaultsQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
                <Spinner data-icon="inline-start" />
                {copy.common.loading}
              </div>
            ) : visibleCatalog.length === 0 ? (
              <p className="text-muted-foreground p-4 text-sm">
                {copy.staff.editorEmpty}
              </p>
            ) : (
              visibleCatalog.map((category) => (
                <section key={category.category} className="mb-5">
                  <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                    {copy.staff.categories[
                      category.category as keyof typeof copy.staff.categories
                    ] ?? category.category}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {category.resources.map((resource) => (
                      <div key={resource.resource} className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {prettify(resource.resource)}
                          </span>
                          <code className="text-muted-foreground text-xs">
                            {resource.resource}
                          </code>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {resource.actions.map((action) => {
                            const permission = `${resource.resource}:${action}`;
                            const checked = draft.has(permission);
                            const wasCurrent = current.has(permission);
                            return (
                              <label
                                key={permission}
                                className="flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(detail) =>
                                    toggle(permission, detail === true)
                                  }
                                />
                                <span className={diffLabelClass(checked, wasCurrent)}>
                                  {prettify(action)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Separator className="mt-5" />
                </section>
              ))
            )}
          </div>

          <DialogFooter className="items-center gap-2 border-t pt-3 sm:justify-between">
            <div className="flex items-center gap-2">
              {dirty ? (
                <Badge variant="secondary">
                  {copy.staff.editorDirty(added.length, removed.length)}
                </Badge>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {copy.staff.editorNoChanges}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {differsFromDefaults ? (
                <Button
                  variant="ghost"
                  onClick={() => setResetOpen(true)}
                  disabled={reset.isPending}
                >
                  {copy.staff.editorReset}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {copy.staff.editorDiscard}
              </Button>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!dirty || update.isPending}
              >
                {update.isPending ? <Spinner data-icon="inline-start" /> : null}
                {copy.staff.editorSave}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmOpen ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirmOpen}
          title={copy.staff.editorConfirmTitle}
          consequence={copy.staff.editorConfirmBody(added.length, removed.length)}
          confirmLabel={copy.staff.editorSave}
          destructive={removed.length > 0}
          onConfirm={() => void save()}
        />
      ) : null}

      {resetOpen ? (
        <ConfirmDialog
          open
          onOpenChange={setResetOpen}
          title={copy.staff.editorResetTitle}
          consequence={copy.staff.editorResetBody(resetChangeCount)}
          confirmLabel={copy.staff.editorReset}
          destructive
          onConfirm={() => void applyReset()}
        />
      ) : null}
    </>
  );
}

/** Permissions the shipped defaults grant that the role currently lacks. */
function addedOfDefaults(defaults: Set<string>, current: Set<string>): string[] {
  return [...defaults].filter((p) => !current.has(p));
}

/** Marks a checkbox label that differs from the role's CURRENT truth. */
function diffLabelClass(checked: boolean, wasCurrent: boolean): string {
  if (checked === wasCurrent) return "";
  return checked ? "font-medium" : "text-muted-foreground line-through";
}
