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
      console.log("error", result.error);
      toast.error(result.error.message || "An error occurred while logging in.");
      return;
    }
    toast.success("Logged in successfully!");
    router.replace("/");
  });

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Login to your account</CardTitle>
          <CardDescription>
            Enter your email below to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
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
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a
                    href="#"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </a>
                </div>
                <Input id="password" type="password" autoComplete="current-password" required {...form.register("password")} />
              </Field>
              <Field>
                <Button type="submit">{form.formState.isSubmitting ? "Logging in..." : "Login"}</Button>
                {/*
                  No "Register" link: accounts are created by the school, not by
                  the visitor (ADR-021).
                */}
                <FieldDescription className="text-center">
                  Accounts are issued by your school. Contact your administrator
                  if you cannot sign in.
                </FieldDescription>
              </Field>

            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
