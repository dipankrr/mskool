"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import { useAuth } from "@/features/auth/hooks/use-auth";

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


export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {

  const router = useRouter();

  // No "already signed in?" check here. That belongs to the route, not the form:
  // `(auth)/login/page.tsx` redirects on the server before this renders.
  const { login } = useAuth();

  const form = useForm<LoginUserInputT>({
    resolver: zodResolver(LoginUserInput),
  });

  const onSubmit = form.handleSubmit(async (data : LoginUserInputT) => {

    const result = await login(data.email, data.password);

    if (result.error) {
      // better-auth's own message, not a tRPC error, so `lib/errors.ts` does not
      // apply here — it already says "Invalid email or password" and deliberately
      // does not reveal which half was wrong.
      toast.error(result.error.message || copy.errors.unknown);
      return;
    }
    toast.success(copy.auth.signedIn);
    router.replace("/");
  });

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>{copy.auth.signInTitle}</CardTitle>
          <CardDescription>{copy.auth.signInSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">{copy.auth.email}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  required
                  {...form.register("email")}
                />
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
                <Input id="password" type="password" autoComplete="current-password" required {...form.register("password")} />
              </Field>
              <Field>
                <Button type="submit">
                  {form.formState.isSubmitting ? copy.auth.signingIn : copy.auth.signIn}
                </Button>
                {/*
                  No "Register" link: accounts are created by the school, not by
                  the visitor (ADR-021).
                */}
                <FieldDescription className="text-center">
                  {copy.auth.noSelfSignUp}
                </FieldDescription>
              </Field>

            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
