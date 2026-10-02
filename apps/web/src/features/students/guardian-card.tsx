"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { guardianRelation, type GuardianRelation } from "@repo/contracts";
import { PencilIcon, ShieldOffIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { copy } from "@/lib/copy";
import type { GuardianView } from "@/lib/trpc/types";
import { useGuardianMutations, useGuardians } from "./use-guardians";

/**
 * THE PARENTS (ADR-037's follow-up) — contact truth on the student record,
 * and the place the family login comes from.
 *
 * Why this card exists instead of a dialog opened from the register: a
 * guardian's phone IS the credential, so the number that gets typed is the
 * one the family will sign in with. Recording it here — once, verified at
 * the desk, next to the child's name — is the whole trust anchor. The
 * register's old family-login dialog asked for a phone AND a password per
 * student; that box is gone (see portal-access-dialog.tsx).
 *
 * Everything here is per-student, and each row states its own login state:
 * the phone, whether a family login is linked, whether that login has
 * claimed a password yet, and whether the family still has access. A
 * correction (wrong number, custody change) is an edit on this record, and
 * the server moves the login with it — no credential UI involved.
 */

const RELATIONS = guardianRelation.options;

const guardianForm = z.object({
  firstName: z.string().trim().min(1, "Name is required").max(100),
  lastName: z.string().trim().max(100).optional(),
  relation: z.enum(guardianRelation.options),
  phone: z.string().regex(/^\d{10}$/, "A phone number is 10 digits."),
  isPrimary: z.boolean(),
  isEmergencyContact: z.boolean(),
  canAccessPortal: z.boolean(),
});
type GuardianForm = z.infer<typeof guardianForm>;

const optionalText = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };

export function GuardianCard({ studentId }: { studentId: string }) {
  const guardians = useGuardians(studentId);
  const { add, update, detach } = useGuardianMutations(studentId);

  const [editing, setEditing] = useState<GuardianView | null>(null);
  const [adding, setAdding] = useState(false);
  const [detaching, setDetaching] = useState<GuardianView | null>(null);

  const rows = guardians.data ?? [];
  const live = rows.filter((row) => !row.endedOn);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="size-4" />
          {copy.guardians.title}
        </CardTitle>
        <CardDescription>{copy.guardians.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {guardians.isLoading ? (
          <p className="text-muted-foreground text-sm">{copy.common.loading}</p>
        ) : live.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={copy.guardians.emptyTitle}
            description={copy.guardians.emptyBody}
            action={
              <PermissionGate permission="student:update">
                <Button onClick={() => setAdding(true)}>
                  <UserPlusIcon data-icon="inline-start" />
                  {copy.guardians.add}
                </Button>
              </PermissionGate>
            }
          />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {live.map((guardian) => (
                <li
                  key={guardian.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
                >
                  <span className="text-sm font-medium">
                    {[guardian.firstName, guardian.lastName].filter(Boolean).join(" ")}
                  </span>
                  <Badge variant="outline">{copy.guardians.relations[guardian.relation]}</Badge>
                  {guardian.isPrimary ? (
                    <Badge variant="secondary">{copy.guardians.primary}</Badge>
                  ) : null}
                  <span className="text-muted-foreground text-sm">{guardian.phone}</span>

                  {guardian.canAccessPortal ? (
                    guardian.portal ? (
                      <>
                        <Badge variant={guardian.portal.isActive ? "default" : "outline"}>
                          {guardian.portal.isActive
                            ? copy.guardians.portalActive
                            : copy.guardians.portalPending}
                        </Badge>
                        <Badge variant="outline">
                          {guardian.portal.hasCredential
                            ? copy.guardians.portalClaimed
                            : copy.guardians.portalNoPassword}
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="outline">{copy.guardians.portalNone}</Badge>
                    )
                  ) : (
                    <Badge variant="outline">{copy.guardians.portalOff}</Badge>
                  )}

                  <div className="ml-auto flex gap-1">
                    <PermissionGate permission="student:update">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(guardian)}
                      >
                        <PencilIcon data-icon="inline-start" />
                        {copy.common.edit}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetaching(guardian)}
                      >
                        <ShieldOffIcon data-icon="inline-start" />
                        {copy.guardians.detach}
                      </Button>
                    </PermissionGate>
                  </div>
                </li>
              ))}
            </ul>

            <PermissionGate permission="student:update">
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => setAdding(true)}
              >
                <UserPlusIcon data-icon="inline-start" />
                {copy.guardians.addAnother}
              </Button>
            </PermissionGate>
          </>
        )}

        {/* Ended relations are history, not options (hard rule 2). */}
        {rows.some((row) => row.endedOn) ? (
          <>
            <Separator />
            <p className="text-muted-foreground text-xs">{copy.guardians.endedNote}</p>
          </>
        ) : null}
      </CardContent>

      {adding ? (
        <GuardianDialog
          key="add"
          title={copy.guardians.addTitle}
          description={copy.guardians.addHelp}
          submitLabel={copy.guardians.add}
          pending={add.isPending}
          onClose={() => setAdding(false)}
          onSubmit={async (data) => {
            try {
              await add.submit(data);
              setAdding(false);
            } catch {
              // The error toast is shown by the hook; the form stays.
            }
          }}
        />
      ) : null}

      {editing ? (
        <GuardianDialog
          key={editing.id}
          guardian={editing}
          title={copy.guardians.editTitle}
          description={copy.guardians.editHelp}
          submitLabel={copy.common.save}
          pending={update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            try {
              await update.submit(editing.id, data);
              setEditing(null);
            } catch {
              // The error toast is shown by the hook; the form stays.
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={detaching !== null}
        onOpenChange={(open) => {
          if (!open) setDetaching(null);
        }}
        title={copy.guardians.detachTitle}
        consequence={copy.guardians.detachBody}
        confirmLabel={copy.guardians.detach}
        destructive
        pending={detach.isPending}
        onConfirm={async () => {
          if (!detaching) return;
          try {
            await detach.submit(detaching.id, copy.guardians.detachReason);
            setDetaching(null);
          } catch {
            // The error toast is shown by the hook; the dialog stays.
          }
        }}
      />
    </Card>
  );
}

/**
 * One form for add and edit. Editing carries the row's values in, so the
 * correction the school makes (a wrong digit, a new number) is visible
 * against what is on file rather than retyped from memory.
 */
function GuardianDialog({
  guardian,
  title,
  description,
  submitLabel,
  pending,
  onClose,
  onSubmit,
}: {
  guardian?: GuardianView;
  title: string;
  description: string;
  submitLabel: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (data: GuardianForm) => void;
}) {
  const form = useForm<GuardianForm>({
    resolver: zodResolver(guardianForm),
    defaultValues: {
      firstName: guardian?.firstName ?? "",
      lastName: guardian?.lastName ?? "",
      relation: (guardian?.relation ?? "father") as GuardianRelation,
      phone: guardian?.phone ?? "",
      isPrimary: guardian?.isPrimary ?? false,
      isEmergencyContact: guardian?.isEmergencyContact ?? false,
      canAccessPortal: guardian?.canAccessPortal ?? true,
    },
  });

  useEffect(() => {
    form.reset({
      firstName: guardian?.firstName ?? "",
      lastName: guardian?.lastName ?? "",
      relation: (guardian?.relation ?? "father") as GuardianRelation,
      phone: guardian?.phone ?? "",
      isPrimary: guardian?.isPrimary ?? false,
      isEmergencyContact: guardian?.isEmergencyContact ?? false,
      canAccessPortal: guardian?.canAccessPortal ?? true,
    });
  }, [form, guardian]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      submitLabel={submitLabel}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={errors.firstName ? true : undefined}>
            <FieldLabel htmlFor="guardian-first-name">
              {copy.guardians.fields.firstName}
            </FieldLabel>
            <Input
              id="guardian-first-name"
              aria-invalid={errors.firstName ? true : undefined}
              {...form.register("firstName")}
            />
            {errors.firstName ? <FieldError>{errors.firstName.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.lastName ? true : undefined}>
            <FieldLabel htmlFor="guardian-last-name">
              {copy.guardians.fields.lastName}
            </FieldLabel>
            <Input id="guardian-last-name" {...form.register("lastName", optionalText)} />
          </Field>

          <Field data-invalid={errors.relation ? true : undefined}>
            <FieldLabel htmlFor="guardian-relation">
              {copy.guardians.fields.relation}
            </FieldLabel>
            <Select
              value={form.watch("relation")}
              onValueChange={(value) =>
                form.setValue("relation", value as GuardianForm["relation"])
              }
            >
              <SelectTrigger id="guardian-relation">
                <SelectValue>
                  {(value: string | null) =>
                    value
                      ? copy.guardians.relations[value as GuardianRelation]
                      : copy.common.none
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {RELATIONS.map((relation) => (
                    <SelectItem key={relation} value={relation}>
                      {copy.guardians.relations[relation]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="guardian-phone">{copy.guardians.fields.phone}</FieldLabel>
          <Input
            id="guardian-phone"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder="9876543210"
            aria-invalid={errors.phone ? true : undefined}
            {...form.register("phone")}
          />
          <FieldDescription>{copy.guardians.fields.phoneHelp}</FieldDescription>
          {errors.phone ? <FieldError>{errors.phone.message}</FieldError> : null}
        </Field>

        <Field orientation="horizontal">
          <input
            id="guardian-primary"
            type="checkbox"
            className="size-4"
            checked={form.watch("isPrimary")}
            onChange={(event) => form.setValue("isPrimary", event.target.checked)}
          />
          <FieldLabel htmlFor="guardian-primary">{copy.guardians.primaryHelp}</FieldLabel>
        </Field>

        <Field orientation="horizontal">
          <input
            id="guardian-emergency"
            type="checkbox"
            className="size-4"
            checked={form.watch("isEmergencyContact")}
            onChange={(event) =>
              form.setValue("isEmergencyContact", event.target.checked)
            }
          />
          <FieldLabel htmlFor="guardian-emergency">
            {copy.guardians.emergencyHelp}
          </FieldLabel>
        </Field>

        <Field orientation="horizontal">
          <input
            id="guardian-portal"
            type="checkbox"
            className="size-4"
            checked={form.watch("canAccessPortal")}
            onChange={(event) => form.setValue("canAccessPortal", event.target.checked)}
          />
          <FieldLabel htmlFor="guardian-portal">{copy.guardians.portalHelp}</FieldLabel>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}