"use client";

import { KeyRoundIcon, PhoneIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/permission-gate";
import type { Student } from "@/lib/trpc/types";
import { copy } from "@/lib/copy";
import { usePortalAccessActions } from "./use-portal-access";

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
type Mode = "activate" | "reset" | "change-phone";

export function PortalAccessDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
}) {
  const { activate, resetPassword, changePhone, scopeArgs } = usePortalAccessActions(
    student.id,
  );

  const [mode, setMode] = useState<Mode>("activate");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const pending = activate.isPending || resetPassword.isPending || changePhone.isPending;

  const close = () => {
    onOpenChange(false);
    setPhone("");
    setPassword("");
    setNewPhone("");
    setReason("");
    setConfirmed(false);
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
          <div role="tablist" aria-label={copy.portalAccess.title} className="flex gap-1">
            {(
              [
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

          {mode === "activate" || mode === "reset" ? (
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
