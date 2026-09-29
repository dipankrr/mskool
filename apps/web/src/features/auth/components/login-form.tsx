"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
import { trpc } from "@/lib/trpc/client";

import { toast } from "sonner";

/**
 * Two doors, one card (ADR-007): staff sign in by email; families by the
 * 10-digit phone the school registered. The phone is the CREDENTIAL, but
 * the stored username is `{org_slug}-{phone}` (globally unique), so the
 * family tab first resolves the org — the subdomain carries it in
 * production; on a bare host the parent picks the school from the list
 * the public org resolver returns.
 *
 * No "already signed in?" check here. That belongs to the route, not the
 * form: `(auth)/login/page.tsx` redirects on the server before this
 * renders.
 */

const FAMILY_SCHOOL_KEY = "mskool.family-school";

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
  const [schoolName, setSchoolName] = useState("");

  // The remembered school: a returning family should not re-pick every
  // time. localStorage (not a cookie) — it is a convenience, never a
  // security input, and the server resolves the slug again on every login.
  useEffect(() => {
    const saved = window.localStorage.getItem(FAMILY_SCHOOL_KEY);
    if (saved) setSchoolName(saved);
  }, []);

  const orgs = trpc.health.orgsByNamePrefix.useQuery(
    { prefix: schoolName.trim() },
    {
      enabled: mode === "family" && schoolName.trim().length >= 1,
      staleTime: 5 * 60 * 1000,
    },
  );

  // Resolution follows the QUERY, not the keystroke: the per-keystroke
  // onChange would read the previous response (the fetch for the shorter
  // prefix) and miss the exact-name match a paste never fires an event
  // for. The derived value also heals the localStorage-remembered case
  // (the name loads before the first keystroke).
  const schoolSlug = useMemo(() => {
    const match = (orgs.data ?? []).find((org) => org.name === schoolName.trim());
    return match?.slug ?? null;
  }, [orgs.data, schoolName]);

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
   * Global phone identity first (ADR-037): the 10-digit number IS the
   * username across schools and trusts, so no school choice is needed.
   * Legacy `{slug}-{phone}` logins (pre-migration) fall back second — the
   * school box stays only for them until the migration runbook runs.
   */
  const onFamilySubmit = familyForm.handleSubmit(async (data) => {
    const digits = data.phone.replace(/\D/g, "").slice(-10);
    const attempt = async (username: string) =>
      loginByPhone(username, data.password);

    let result = await attempt(digits);
    let usedSlug = false;
    if (result.error && schoolSlug) {
      const legacy = `${schoolSlug}-${digits}`.toLowerCase();
      result = await attempt(legacy);
      usedSlug = !result.error;
    }
    if (result.error) {
      toast.error(result.error.message || copy.errors.unknown);
      return;
    }
    if (schoolName.trim() && (usedSlug || !schoolSlug)) {
      window.localStorage.setItem(FAMILY_SCHOOL_KEY, schoolName);
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
                <Field>
                  <FieldLabel htmlFor="school">{copy.auth.school}</FieldLabel>
                  <Input
                    id="school"
                    autoComplete="organization"
                    placeholder="Springfield Public School"
                    list="family-schools"
                    value={schoolName}
                    onChange={(event) => setSchoolName(event.target.value)}
                  />
                  <datalist id="family-schools">
                    {(orgs.data ?? []).map((org) => (
                      <option key={org.slug} value={org.name} />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {schoolSlug ? `${schoolSlug} · ` : ""}
                    {copy.auth.schoolHelp}
                  </FieldDescription>
                </Field>
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
