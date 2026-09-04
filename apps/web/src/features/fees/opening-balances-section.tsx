"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { createOpeningBalanceSchema, type CreateOpeningBalanceInput } from "@repo/contracts";

import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveContext } from "@/features/session/active-context";
import { openingBalanceStatusTint } from "./fee-styles";
import { useOpeningBalanceMutations, useOpeningBalances } from "./use-fee-ledger";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/money";
import type { OpeningBalance } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * OPENING BALANCES — last session's carry-forward. Record (the origin
 * session must differ from the one it lands in — the schema's own
 * refinement), list with status. NO payment path exists (the counter
 * collects instalments only) — the section is informational for the
 * desk, honestly labelled, with the ledger link as its read path.
 */
export function OpeningBalancesSection({
  studentId,
  activeSession,
}: {
  studentId: string;
  activeSession: { id: string; name: string } | undefined;
}) {
  const { sessions } = useActiveContext();
  const balances = useOpeningBalances(activeSession?.id, studentId);
  const { record } = useOpeningBalanceMutations();

  const [open, setOpen] = useState(false);

  // The origin options: every session EXCEPT the one it lands in (the
  // schema refuses same-year origins; hiding it is the affordance, the
  // schema's refinement is the gate).
  const originOptions = sessions.filter((s) => s.id !== activeSession?.id);

  const form = useForm<CreateOpeningBalanceInput>({
    resolver: zodResolver(createOpeningBalanceSchema),
    defaultValues: { studentId, academicYearId: activeSession?.id ?? "" },
  });

  const errors = form.formState.errors;
  const rows = balances.data ?? [];
  const isEmpty = !balances.isLoading && rows.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {isEmpty ? (
        // Nothing carried forward: one quiet line, not a titled section
        // with an empty dashed box.
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">{copy.fees.openingBalances.emptyTitle}</p>
          <PermissionGate permission="fee_structure:create">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                form.reset({ studentId, academicYearId: activeSession?.id ?? "", amount: "" });
                setOpen(true);
              }}
              disabled={!record.canSubmit || !activeSession}
            >
              <PlusIcon data-icon="inline-start" />
              {copy.fees.openingBalances.add}
            </Button>
          </PermissionGate>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{copy.fees.openingBalances.title}</h3>
            <PermissionGate permission="fee_structure:create">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  form.reset({ studentId, academicYearId: activeSession?.id ?? "", amount: "" });
                  setOpen(true);
                }}
                disabled={!record.canSubmit || !activeSession}
              >
                <PlusIcon data-icon="inline-start" />
                {copy.fees.openingBalances.add}
              </Button>
            </PermissionGate>
          </div>
          <p className="text-muted-foreground text-xs">{copy.fees.openingBalances.subtitle}</p>
        </>
      )}

      {balances.isLoading ? (
        <p className="text-muted-foreground py-2 text-sm">{copy.common.loading}</p>
      ) : rows.length === 0 ? null : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-3 py-2 font-medium">{copy.fees.amounts.balance}</th>
                <th className="px-3 py-2 font-medium">{copy.fees.amounts.paid}</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">{copy.fees.openingBalances.fields.description}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: OpeningBalance) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className={cn("px-3 py-2 font-medium")}>{formatMoney(row.balanceAmount)}</td>
                  <td className="px-3 py-2">{formatMoney(row.paidAmount)}</td>
                  <td className="px-3 py-2">
                    <span className={openingBalanceStatusTint(row.status)}>
                      {copy.fees.openingBalanceStatuses[row.status]}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-3 py-2">{row.description ?? copy.common.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={copy.fees.openingBalances.addTitle}
        submitLabel={copy.fees.openingBalances.add}
        pending={record.isPending}
        onSubmit={form.handleSubmit(async (data) => {
          try {
            await record.submit(data);
            setOpen(false);
          } catch {
            // Refused (same-year origin, …): toast carries the wording.
          }
        })}
      >
        <FieldGroup>
          <p className="text-muted-foreground text-sm">{copy.fees.openingBalances.addHelp}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={errors.originAcademicYearId ? true : undefined}>
              <FieldLabel htmlFor="ob-origin">{copy.fees.openingBalances.fields.origin}</FieldLabel>
              <Select
                value={form.watch("originAcademicYearId") || undefined}
                onValueChange={(v) =>
                  form.setValue("originAcademicYearId", v ?? "", { shouldValidate: true })
                }
              >
                <SelectTrigger id="ob-origin" aria-invalid={errors.originAcademicYearId ? true : undefined}>
                  <SelectValue>
                    {(value: string | null) =>
                      originOptions.find((s) => s.id === value)?.name ?? copy.common.none}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {originOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{copy.fees.openingBalances.fields.originHelp}</FieldDescription>
              <FieldError>{errors.originAcademicYearId?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.amount ? true : undefined}>
              <FieldLabel htmlFor="ob-amount">{copy.fees.openingBalances.fields.amount}</FieldLabel>
              <Input
                id="ob-amount"
                inputMode="decimal"
                placeholder="5000.00"
                aria-invalid={errors.amount ? true : undefined}
                {...form.register("amount")}
              />
              <FieldError>{errors.amount?.message}</FieldError>
            </Field>
          </div>

          <Field data-invalid={errors.description ? true : undefined}>
            <FieldLabel htmlFor="ob-desc">{copy.fees.openingBalances.fields.description}</FieldLabel>
            <Input
              id="ob-desc"
              maxLength={255}
              aria-invalid={errors.description ? true : undefined}
              {...form.register("description", { setValueAs: (v) => (v === "" ? undefined : v) })}
            />
            <FieldError>{errors.description?.message}</FieldError>
          </Field>
        </FieldGroup>
      </FormDialog>
    </div>
  );
}
