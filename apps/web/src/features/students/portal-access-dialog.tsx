"use client";

import { KeyRoundIcon, Link2Icon, PhoneIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { PermissionGate } from "@/components/permission-gate";
import type { Student } from "@/lib/trpc/types";
import { copy } from "@/lib/copy";
import { usePortalAccessActions, usePortalAccessLinks } from "./use-portal-access";

/**
 * THE FAMILY LOGIN, ADMINISTERED (ADR-007) — one dialog, three acts, one
 * mode at a time. The phone IS the credential, so each act states its
 * consequence before commit (high-trust UX): activation hands the family
 * a temporary password they must change at first sign-in; a reset issues
 * a new temporary password and signs out every session; a phone change is
 * a credential change with a required, recorded reason.
 *
 * Passwords are one-time entries — never echoed, never stored. The
 * success toast carries the family's next step, because the staff member
 * is the messenger, not the password holder.
 */
type Mode = "links" | "activate" | "reset" | "change-phone";

export function PortalAccessDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
}) {
  const {
    activate,
    resetPassword,
    changePhone,
    ensureLink,
    revokeLink,
    scopeArgs,
  } = usePortalAccessActions(student.id);
  const links = usePortalAccessLinks(student.id);

  const [mode, setMode] = useState<Mode>("links");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [linkPhone, setLinkPhone] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<{
    userId: string;
    username: string;
  } | null>(null);

  const pending =
    activate.isPending ||
    resetPassword.isPending ||
    changePhone.isPending ||
    ensureLink.isPending ||
    revokeLink.isPending;

  const close = () => {
    onOpenChange(false);
    setPhone("");
    setPassword("");
    setNewPhone("");
    setReason("");
    setConfirmed(false);
    setLinkPhone("");
    setRevokeTarget(null);
  };

  const run = () => {
    setConfirmed(false);
    if (mode === "activate") {
      activate.mutate({ ...scopeArgs(), studentId: student.id, phone, password });
    } else if (mode === "reset") {
      resetPassword.mutate({ ...scopeArgs(), studentId: student.id, password });
    } else {
      changePhone.mutate({
        ...scopeArgs(),
        studentId: student.id,
        newPhone,
        reason: reason.trim(),
      });
    }
    close();
  };

  const phoneValid = /^\d{10}$/.test(phone);
  const passwordValid = password.length >= 8;
  const newPhoneValid = /^\d{10}$/.test(newPhone);
  const reasonValid = reason.trim().length >= 3;

  const canSubmit =
    mode === "activate"
      ? phoneValid && passwordValid
      : mode === "reset"
        ? passwordValid
        : newPhoneValid && reasonValid;

  const consequence =
    mode === "activate"
      ? copy.portalAccess.activated
      : mode === "reset"
        ? copy.portalAccess.resetDone
        : copy.portalAccess.phoneChanged;

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={copy.portalAccess.title}
        description={`${[student.firstName, student.lastName].filter(Boolean).join(" ")} — ${student.admissionNumber}`}
        submitLabel={
          mode === "activate"
            ? copy.portalAccess.activate
            : mode === "reset"
              ? copy.portalAccess.resetPassword
              : copy.portalAccess.changePhone
        }
        pending={pending}
        disabled={!canSubmit}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) setConfirmed(true);
        }}
      >
        <div className="flex flex-col gap-4">
          {/* Mode tabs — the three acts, one visible at a time. */}
          <div role="tablist" aria-label={copy.portalAccess.title} className="flex flex-wrap gap-1">
            {(
              [
                ["links", copy.portalAccess.links, Link2Icon],
                ["activate", copy.portalAccess.activate, KeyRoundIcon],
                ["reset", copy.portalAccess.resetPassword, RotateCcwIcon],
                ["change-phone", copy.portalAccess.changePhone, PhoneIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                variant={mode === value ? "default" : "ghost"}
                size="sm"
                onClick={() => setMode(value)}
              >
                <Icon data-icon="inline-start" />
                {label}
              </Button>
            ))}
          </div>

          {mode === "links" ? (
            <div className="flex flex-col gap-4">
              {links.isLoading ? (
                <p className="text-muted-foreground text-sm">{copy.common.loading}</p>
              ) : links.error || !links.data ? (
                <p className="text-muted-foreground text-sm">{copy.errors.unknown}</p>
              ) : links.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">{copy.portalAccess.linkEmpty}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {links.data.map((link) => (
                    <li
                      key={link.userId}
                      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="text-sm font-medium">{link.username}</span>
                      <Badge variant={link.isActive ? "default" : "outline"}>
                        {link.isActive
                          ? copy.portalAccess.linkActive
                          : copy.portalAccess.linkPending}
                      </Badge>
                      <Badge variant="outline">
                        {link.hasCredential
                          ? copy.portalAccess.linkCredentialSet
                          : copy.portalAccess.linkCredentialPending}
                      </Badge>
                      <PermissionGate permission="portal_access:change_phone">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          disabled={revokeLink.isPending}
                          onClick={() =>
                            setRevokeTarget({ userId: link.userId, username: link.username })
                          }
                        >
                          {copy.portalAccess.linkRevoke}
                        </Button>
                      </PermissionGate>
                    </li>
                  ))}
                </ul>
              )}
              <Separator />
              <Field
                data-invalid={
                  linkPhone.length > 0 && !/^\d{10}$/.test(linkPhone.replace(/\D/g, "").slice(-10))
                    ? true
                    : undefined
                }
              >
                <FieldLabel htmlFor="portal-link-phone">
                  {copy.portalAccess.linkPhone}
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="portal-link-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="9876543210"
                    value={linkPhone}
                    onChange={(event) => setLinkPhone(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={
                      ensureLink.isPending ||
                      !/^\d{10}$/.test(linkPhone.replace(/\D/g, "").slice(-10))
                    }
                    onClick={async () => {
                      try {
                        await ensureLink.mutateAsync({
                          ...scopeArgs(),
                          studentId: student.id,
                          phone: linkPhone.replace(/\D/g, "").slice(-10),
                        });
                        setLinkPhone("");
                      } catch {
                        // The error toast is shown by the hook; the form stays.
                      }
                    }}
                  >
                    {copy.portalAccess.linkPhone}
                  </Button>
                </div>
                <FieldDescription>{copy.portalAccess.linkPhoneHelp}</FieldDescription>
              </Field>
            </div>
          ) : mode === "activate" || mode === "reset" ? (
            <>
              {mode === "activate" ? (
                <Field data-invalid={phone.length > 0 && !phoneValid ? true : undefined}>
                  <FieldLabel htmlFor="portal-phone">{copy.portalAccess.phone}</FieldLabel>
                  <Input
                    id="portal-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="9876543210"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    aria-invalid={phone.length > 0 && !phoneValid ? true : undefined}
                  />
                  <FieldDescription>{copy.portalAccess.phoneHelp}</FieldDescription>
                  <FieldError>{phone.length > 0 && !phoneValid ? "10 digits." : null}</FieldError>
                </Field>
              ) : null}
              <Field data-invalid={password.length > 0 && !passwordValid ? true : undefined}>
                <FieldLabel htmlFor="portal-password">
                  {mode === "activate"
                    ? copy.portalAccess.initialPassword
                    : copy.portalAccess.newPasswordLabel}
                </FieldLabel>
                <Input
                  id="portal-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={password.length > 0 && !passwordValid ? true : undefined}
                />
                <FieldDescription>
                  {mode === "activate"
                    ? copy.portalAccess.initialPasswordHelp
                    : copy.portalAccess.resetHelp}
                </FieldDescription>
              </Field>
            </>
          ) : (
            <>
              <Field data-invalid={newPhone.length > 0 && !newPhoneValid ? true : undefined}>
                <FieldLabel htmlFor="portal-new-phone">{copy.portalAccess.newPhone}</FieldLabel>
                <Input
                  id="portal-new-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={newPhone}
                  onChange={(event) => setNewPhone(event.target.value)}
                  aria-invalid={newPhone.length > 0 && !newPhoneValid ? true : undefined}
                />
                <FieldDescription>{copy.portalAccess.changePhoneHelp}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="portal-reason">{copy.portalAccess.reason}</FieldLabel>
                <Input
                  id="portal-reason"
                  maxLength={500}
                  placeholder={copy.portalAccess.reasonPlaceholder}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                {reason.length > 0 && !reasonValid ? (
                  <FieldError>{copy.portalAccess.reasonRequired}</FieldError>
                ) : null}
              </Field>
            </>
          )}
          {mode !== "links" ? (
            <p className="text-muted-foreground text-xs">{copy.portalAccess.legacyNote}</p>
          ) : null}
        </div>
      </FormDialog>

      {/* Each act confirms with its consequence stated — credential UX. */}
      <ConfirmDialog
        open={confirmed}
        onOpenChange={(open) => {
          if (!open) setConfirmed(false);
        }}
        title={
          mode === "activate"
            ? copy.portalAccess.activate
            : mode === "reset"
              ? copy.portalAccess.resetPassword
              : copy.portalAccess.changePhone
        }
        consequence={consequence}
        confirmLabel={
          mode === "activate"
            ? copy.portalAccess.activate
            : mode === "reset"
              ? copy.portalAccess.resetPassword
              : copy.portalAccess.changePhone
        }
        pending={pending}
        onConfirm={run}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title={`${copy.portalAccess.linkRevoke} — ${revokeTarget?.username ?? ""}`}
        consequence={copy.portalAccess.linkRevokeConsequence}
        confirmLabel={copy.portalAccess.linkRevoke}
        pending={revokeLink.isPending}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await revokeLink.mutateAsync({
              ...scopeArgs(),
              studentId: student.id,
              userId: revokeTarget.userId,
            });
            setRevokeTarget(null);
          } catch {
            // The error toast is shown by the hook; the dialog stays.
          }
        }}
      />
    </>
  );
}

/** The row action — permission-gated, renders inside the students table. */
export function PortalAccessRowAction({
  student,
  onOpen,
}: {
  student: Student;
  onOpen: (student: Student) => void;
}) {
  return (
    <PermissionGate permission="portal_access:activate">
      <Button variant="ghost" size="sm" onClick={() => onOpen(student)}>
        <KeyRoundIcon data-icon="inline-start" />
        {copy.portalAccess.title}
      </Button>
    </PermissionGate>
  );
}
