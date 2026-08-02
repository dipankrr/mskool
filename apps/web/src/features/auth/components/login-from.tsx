"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
import { LoginUserInput, LoginUserInputT, RegisterUserInput } from "node_modules/@repo/contracts/src/contracts/auth.contract";
import { toast } from "sonner";


export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {

  const router = useRouter();

  const {login, ...session} = useAuth();

  // i want to check if the user is already logged in, if so redirect to home page
  if (session.data?.session) {
    router.push("/");
  }

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
                <Input id="password" type="password" required {...form.register("password")} />
              </Field>
              <Field>
                <Button type="submit">{form.formState.isSubmitting ? "Logging in..." : "Login"}</Button>
                <FieldDescription className="text-center">
                  Don&apos;t have an account? <Link href="/register" className="underline">
                    Register
                  </Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
