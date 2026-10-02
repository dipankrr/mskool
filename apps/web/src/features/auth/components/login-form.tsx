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

  const staffForm = useForm<LoginUserInputT>({
    resolver: zodResolver(LoginUserInput),
  });

  const familyForm = useForm<{ phone: string; password: string }>({
    defaultValues: { phone: "", password: "" },
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

  /**
   * One attempt, one username. Usernames are globally unique (ADR-037), so
   * the digits route to the one login that owns them — no school choice,
   * no fallback, nothing to resolve before submitting.
   */
  const onFamilySubmit = familyForm.handleSubmit(async (data) => {
    const digits = data.phone.replace(/\D/g, "").slice(-10);
    const result = await loginByPhone(digits, data.password);
    if (result.error) {
      toast.error(result.error.message || copy.errors.unknown);
      return;
    }
    await clearSessionState();
    toast.success(copy.auth.signedIn);
    router.replace("/portal/results");
  });

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
                    onClick={() => setMode("family")}
                  >
                    {copy.auth.familyTab}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          ) : (
            <form onSubmit={onFamilySubmit}>
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
                      pattern: { value: /^\d{10}$/, message: "10 digits." },
                    })}
                  />
                  <FieldDescription>{copy.auth.phoneHelp}</FieldDescription>
                  <FieldError>{familyForm.formState.errors.phone?.message}</FieldError>
                </Field>
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
