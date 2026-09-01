"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Link2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { UpsertPolicyInput } from "@repo/contracts";
import { upsertPolicySchema } from "@repo/contracts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  usePolicy,
  usePolicyMutations,
} from "@/features/attendance/use-attendance";
import { AttendanceTabs } from "@/features/attendance/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";

/**
 * THE MARKING POLICY — one form for the school's one row. The fields that
 * only matter to a period-wise school (the derivation rule and its
 * threshold) stay visible with a help line saying so, rather than
 * appearing and disappearing: a field that vanishes when you switch the
 * mode looks like it lost your input.
 *
 * Null policy = "the defaults are already in effect" — the form opens
 * pre-filled with them, and saving CREATES the row. There is no delete:
 * the defaults ARE the row with those values.
 */
export default function AttendancePolicyPage() {
  const { schoolId } = useActiveContext();
  const policy = usePolicy(schoolId ?? "");
  const { upsert } = usePolicyMutations();

  const form = useForm<UpsertPolicyInput>({
    resolver: zodResolver(upsertPolicySchema),
    defaultValues: {
      markingMode: "daily",
      dailyStatusRule: "homeroom_authoritative",
      thresholdPercentage: null,
      lateArrivalMinutes: 15,
    },
  });

  useEffect(() => {
    const row = policy.data;
    if (!row) return;
    form.reset({
      markingMode: row.markingMode,
      dailyStatusRule: row.dailyStatusRule,
      thresholdPercentage: row.thresholdPercentage,
      lateArrivalMinutes: row.lateArrivalMinutes,
    });
  }, [policy.data, form]);

  const errors = form.formState.errors;
  const rule = form.watch("dailyStatusRule");
  const mode = form.watch("markingMode");

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {copy.attendance.policy.title}
          </h1>
          <p className="text-muted-foreground text-sm">{copy.attendance.policy.subtitle}</p>
        </div>
        <Link href="/attendance/calendar" className={buttonVariants({ variant: "outline" })}>
          <Link2Icon data-icon="inline-start" />
          {copy.attendance.title}
        </Link>
      </div>

      <AttendanceTabs />

      {policy.data === null ? (
        <p className="text-muted-foreground mt-4 text-sm">{copy.attendance.policy.defaultsInEffect}</p>
      ) : null}

      <Card className="mt-4">
        <CardContent className="pt-6">
          <form
            onSubmit={form.handleSubmit(async (data) => {
              try {
                await upsert.submit(data);
              } catch {
                // The error toast is shown by the hook.
              }
            })}
          >
            <FieldGroup className="max-w-xl">
              <Field>
                <FieldLabel htmlFor="policy-mode">{copy.attendance.policy.markingMode}</FieldLabel>
                <Select
                  value={mode}
                  onValueChange={(value) =>
                    form.setValue("markingMode", value as UpsertPolicyInput["markingMode"])
                  }
                >
                  <SelectTrigger id="policy-mode">
                    <SelectValue>
                      {(value: string | null) =>
                        value
                          ? copy.attendance.policy.modes[value as "daily" | "period_wise"]
                          : copy.common.none
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(["daily", "period_wise"] as const).map((m) => (
                        <SelectItem key={m} value={m}>
                          {copy.attendance.policy.modes[m]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{copy.attendance.policy.markingModeHelp}</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="policy-rule">
                  {copy.attendance.policy.dailyStatusRule}
                </FieldLabel>
                <Select
                  value={rule}
                  onValueChange={(value) =>
                    form.setValue(
                      "dailyStatusRule",
                      value as UpsertPolicyInput["dailyStatusRule"],
                    )
                  }
                >
                  <SelectTrigger id="policy-rule">
                    <SelectValue>
                      {(value: string | null) =>
                        value
                          ? copy.attendance.policy.rules[
                              value as "homeroom_authoritative" | "threshold_percentage"
                            ]
                          : copy.common.none
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(["homeroom_authoritative", "threshold_percentage"] as const).map(
                        (r) => (
                          <SelectItem key={r} value={r}>
                            {copy.attendance.policy.rules[r]}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{copy.attendance.policy.dailyStatusRuleHelp}</FieldDescription>
              </Field>

              <Field data-invalid={errors.thresholdPercentage ? true : undefined}>
                <FieldLabel htmlFor="policy-threshold">
                  {copy.attendance.policy.thresholdPercentage}
                </FieldLabel>
                <Input
                  id="policy-threshold"
                  type="number"
                  min={1}
                  max={100}
                  aria-invalid={errors.thresholdPercentage ? true : undefined}
                  {...form.register("thresholdPercentage", {
                    setValueAs: (value: unknown) =>
                      value === "" || value === null ? null : Number(value),
                  })}
                />
                <FieldDescription>
                  {copy.attendance.policy.thresholdPercentageHelp}
                </FieldDescription>
                {errors.thresholdPercentage ? (
                  <FieldError>{errors.thresholdPercentage.message}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={errors.lateArrivalMinutes ? true : undefined}>
                <FieldLabel htmlFor="policy-late">
                  {copy.attendance.policy.lateArrivalMinutes}
                </FieldLabel>
                <Input
                  id="policy-late"
                  type="number"
                  min={0}
                  max={120}
                  aria-invalid={errors.lateArrivalMinutes ? true : undefined}
                  {...form.register("lateArrivalMinutes", {
                    setValueAs: (value: unknown) => Number(value),
                  })}
                />
                <FieldDescription>{copy.attendance.policy.lateArrivalMinutesHelp}</FieldDescription>
                {errors.lateArrivalMinutes ? (
                  <FieldError>{errors.lateArrivalMinutes.message}</FieldError>
                ) : null}
              </Field>

              <div>
                <Button type="submit" disabled={upsert.isPending}>
                  {upsert.isPending ? copy.common.saving : copy.common.save}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
