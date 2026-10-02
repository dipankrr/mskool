"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/features/auth/hooks/use-auth";
import { useSessionBoundary } from "@/lib/session-boundary";

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
// Package entry point, not a path into node_modules. Reaching into the
// package's src/ resolved by accident and bypassed the type chain
// (db → contracts → services → trpc → web), so a schema change would not have
// surfaced here as an error.
import { LoginUserInput, type LoginUserInputT } from "@repo/contracts";

import { copy } from "@/lib/copy";

import { toast } from "sonner";

/**
 * Two doors, one card (ADR-007, global identity per ADR-037): staff sign in
 * by email; families by the 10-digit phone the school verified. The phone
 * IS the username across schools and trusts, so there is no school picker —
 * the digits alone route to the one login that owns them.
 *
 * No "already signed in?" check here. That belongs to the route, not the
 * form: `(auth)/login/page.tsx` redirects on the server before this
 * renders.
 */
export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();

  // The boundary BOTH flows cross. Sign-out clears its own caches, but an
  // expired-session redirect lands here without ever touching the button —
  // and on a shared computer the previous user's tab state is still in
  // memory. Clearing again on the way IN is what makes the pair airtight.
  const clearSessionState = useSessionBoundary();
  const { login, loginByPhone } = useAuth();

  const [mode, setMode] = useState<"staff" | "family">("staff");
  // The family's two steps (ADR-037 follow-up): digits first, then the
  // server says which second step — password for a claimed login,
  // admission-no + DOB + new password for a first claim.
  const [familyStep, setFamilyStep] = useState<"phone" | "password" | "setup">("phone");
  const [familyBusy, setFamilyBusy] = useState(false);

  const staffForm = useForm<LoginUserInputT>({
    resolver: zodResolver(LoginUserInput),
  });

  const familyForm = useForm<{
    phone: string;
    password: string;
    admissionNumber: string;
    dateOfBirth: string;
    newPassword: string;
  }>({
    defaultValues: { phone: "", password: "", admissionNumber: "", dateOfBirth: "", newPassword: "" },
  });

  const onStaffSubmit = staffForm.handleSubmit(async (data: LoginUserInputT) => {
    const result = await login(data.email, data.password);
    if (result.error) {
      // better-auth's own message, not a tRPC error, so `lib/errors.ts` does not
      // apply here — it already says "Invalid email or password" and deliberately
      // does not reveal which half was wrong.
      toast.error(result.error.message || copy.errors.unknown);
      return;
    }
    await clearSessionState();
    toast.success(copy.auth.signedIn);
    router.replace("/");
  });

  const digitsOf = (value: string) => value.replace(/\D/g, "").slice(-10);

  /** Step 1 → 2: digits only; the server says password or first-claim. */
  const onFamilyContinue = async () => {
    const digits = digitsOf(familyForm.getValues("phone"));
    if (!/^\d{10}$/.test(digits)) {
      familyForm.setError("phone", { message: copy.auth.phoneError });
      return;
    }
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/portal/account-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const body = (await res.json().catch(() => ({}))) as { state?: string };
      // Fail closed to the claim shape: it fails closed server-side too,
      // so an outage degrades to the same uniform refusal, not a leak.
      setFamilyStep(body.state === "password" ? "password" : "setup");
    } catch {
      toast.error(copy.errors.unknown);
    } finally {
      setFamilyBusy(false);
    }
  };

  const signedIn = async () => {
    await clearSessionState();
    toast.success(copy.auth.signedIn);
    router.replace("/portal/results");
  };

  /** Claimed login: digits + the password the family chose. */
  const onFamilyPassword = familyForm.handleSubmit(async (data) => {
    const result = await loginByPhone(digitsOf(data.phone), data.password);
    if (result.error) {
      toast.error(result.error.message || copy.errors.unknown);
      return;
    }
    await signedIn();
  });

  /** First claim: the trio sets the password, then signs straight in. */
  const onFamilySetup = familyForm.handleSubmit(async (data) => {
    const digits = digitsOf(data.phone);
    if (
      !data.admissionNumber.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) ||
      data.newPassword.length < 8
    ) {
      toast.error(copy.auth.claimIncomplete);
      return;
    }
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/portal/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: digits,
          admissionNumber: data.admissionNumber.trim(),
          dateOfBirth: data.dateOfBirth,
          password: data.newPassword,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || copy.errors.unknown);
        return;
      }
      const result = await loginByPhone(digits, data.newPassword);
      if (result.error) {
        toast.error(result.error.message || copy.errors.unknown);
        return;
      }
      await signedIn();
    } finally {
      setFamilyBusy(false);
    }
  });

  const backToPhone = () => {
    setFamilyStep("phone");
    familyForm.setValue("password", "");
    familyForm.setValue("newPassword", "");
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>{copy.auth.signInTitle}</CardTitle>
          <CardDescription>
            {mode === "staff" ? copy.auth.signInSubtitle : copy.auth.familySubtitle}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "staff" ? (
            <form onSubmit={onStaffSubmit}>
              <FieldGroup>
                <Field data-invalid={staffForm.formState.errors.email ? true : undefined}>
                  <FieldLabel htmlFor="email">{copy.auth.email}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="m@example.com"
                    required
                    aria-invalid={staffForm.formState.errors.email ? true : undefined}
                    {...staffForm.register("email")}
                  />
                  <FieldError>{staffForm.formState.errors.email?.message}</FieldError>
                </Field>
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">{copy.auth.password}</FieldLabel>
                    <a
                      href="#"
                      className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                    >
                      {copy.auth.forgotPassword}
                    </a>
                  </div>
                  <Input id="password" type="password" autoComplete="current-password" required {...staffForm.register("password")} />
                </Field>
                <Field>
                  <Button type="submit">
                    {staffForm.formState.isSubmitting ? copy.auth.signingIn : copy.auth.signIn}
                  </Button>
                  {/*
                    No "Register" link: accounts are created by the school, not by
                    the visitor (ADR-021).
                  */}
                  <FieldDescription className="text-center">
                    {copy.auth.noSelfSignUp}
                  </FieldDescription>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setFamilyStep("phone");
                      setMode("family");
                    }}
                  >
                    {copy.auth.familyTab}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          ) : familyStep === "phone" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onFamilyContinue();
              }}
            >
              <FieldGroup>
                <Field data-invalid={familyForm.formState.errors.phone ? true : undefined}>
                  <FieldLabel htmlFor="phone">{copy.auth.phone}</FieldLabel>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                    required
                    aria-invalid={familyForm.formState.errors.phone ? true : undefined}
                    {...familyForm.register("phone", {
                      pattern: { value: /^\d{10}$/, message: copy.auth.phoneError },
                    })}
                  />
                  <FieldDescription>{copy.auth.phoneHelp}</FieldDescription>
                  <FieldError>{familyForm.formState.errors.phone?.message}</FieldError>
                </Field>
                <Field>
                  <Button type="submit" disabled={familyBusy}>
                    {familyBusy ? copy.auth.signingIn : copy.auth.continue}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setMode("staff")}
                  >
                    {copy.auth.staffTab}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          ) : familyStep === "password" ? (
            <form onSubmit={onFamilyPassword}>
              <FieldGroup>
                <FieldDescription>
                  {digitsOf(familyForm.getValues("phone"))} ·{" "}
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={backToPhone}
                  >
                    {copy.auth.useDifferentNumber}
                  </button>
                </FieldDescription>
                <Field>
                  <FieldLabel htmlFor="family-password">{copy.auth.password}</FieldLabel>
                  <Input
                    id="family-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    {...familyForm.register("password")}
                  />
                </Field>
                <Field>
                  <Button type="submit">
                    {familyForm.formState.isSubmitting ? copy.auth.signingIn : copy.auth.signIn}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          ) : (
            <form onSubmit={onFamilySetup}>
              <FieldGroup>
                <FieldDescription>
                  {digitsOf(familyForm.getValues("phone"))} · {copy.auth.firstClaimHelp}{" "}
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={backToPhone}
                  >
                    {copy.auth.useDifferentNumber}
                  </button>
                </FieldDescription>
                <Field>
                  <FieldLabel htmlFor="family-admission">
                    {copy.auth.admissionNumber}
                  </FieldLabel>
                  <Input
                    id="family-admission"
                    autoComplete="off"
                    required
                    {...familyForm.register("admissionNumber")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="family-dob">{copy.auth.dateOfBirth}</FieldLabel>
                  <Input
                    id="family-dob"
                    type="date"
                    required
                    {...familyForm.register("dateOfBirth")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="family-new-password">
                    {copy.auth.choosePassword}
                  </FieldLabel>
                  <Input
                    id="family-new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    {...familyForm.register("newPassword")}
                  />
                  <FieldDescription>{copy.auth.choosePasswordHelp}</FieldDescription>
                </Field>
                <Field>
                  <Button type="submit" disabled={familyBusy}>
                    {familyBusy ? copy.auth.signingIn : copy.auth.claimAndSignIn}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
