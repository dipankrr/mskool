"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/copy";

/**
 * The login provisioning dialog (ADR-035), in its two modes. The password
 * typed here is a HAND-OFF secret: the consequence text says out loud that
 * the staff member must change it at first sign-in (create) and that every
 * live session dies (reset) — the same consequence-stating discipline as the
 * portal access dialog it is modelled on.
 */

const passwordForm = z.object({
  password: z.string().min(8, "At least 8 characters.").max(72),
});
type PasswordForm = z.infer<typeof passwordForm>;

export function StaffLoginDialog({
  open,
  onOpenChange,
  mode,
  staffName,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "reset";
  staffName: string;
  onSubmit: (password: string) => void;
  pending: boolean;
}) {
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordForm),
  });

  const isCreate = mode === "create";

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isCreate ? copy.staff.loginCreateTitle : copy.staff.loginResetTitle
      }
      description={`${staffName} — ${
        isCreate ? copy.staff.loginCreateHelp : copy.staff.loginResetHelp
      }`}
      submitLabel={isCreate ? copy.staff.loginCreate : copy.staff.loginReset}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data.password))}
    >
      <Field>
        <FieldLabel htmlFor="staff-login-password">
          {copy.staff.password}
        </FieldLabel>
        <Input
          id="staff-login-password"
          type="text"
          autoComplete="off"
          aria-invalid={form.formState.errors.password ? true : undefined}
          {...form.register("password")}
        />
        <FieldDescription>{copy.staff.passwordHelp}</FieldDescription>
        {form.formState.errors.password ? (
          <FieldError>{form.formState.errors.password.message}</FieldError>
        ) : null}
      </Field>
    </FormDialog>
  );
}
