"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/features/auth/hooks/use-auth";

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
import { toast } from "sonner"


import { RegisterUserInputT, RegisterUserInput } from "@repo/contracts";

export function RegisterForm({ ...props }: React.ComponentProps<typeof Card>) {

  const router = useRouter();

  const { register: registerUser, login } = useAuth();

  const { register, handleSubmit, formState } = useForm<RegisterUserInputT>({
    resolver: zodResolver(RegisterUserInput),
  });


  // on sunmit handler for the form
  const onSubmit = handleSubmit(async (data) => {
    console.log("data", data);

    const result = await registerUser(data.name, data.email, data.password);

    if (result.error) {
      toast.error(result.error.message || "An error occurred while creating the account.");
      return;
    }

    toast.success("Account created successfully!");
    toast.success("Logging you in automatically!");

    const res = await login(data.email, data.password);

    if (res.error) {
      toast.error(res.error.message || "An error occurred while logging in.");
      router.push("/login");
      return;
    }

    setTimeout(() => {
      router.replace("/");
    }, 1000);

  });



  return (
    <Card {...props}>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Enter your information below to create your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Full Name</FieldLabel>
              <Input id="name" type="text" placeholder="John Doe" required {...register("name")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
                {...register("email")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input id="password" type="password" required {...register("password")} />
              <FieldDescription>
                Must be at least 8 characters long.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">
                Confirm Password
              </FieldLabel>
              <Input id="confirm-password" type="password" required {...register("confirmPassword")} />
              <FieldDescription>Please confirm your password.</FieldDescription>
            </Field>
            <FieldGroup>
              <Field>
                <Button type="submit" disabled={formState.isSubmitting}>
                  {formState.isSubmitting ? "Creating Account..." : "Create Account"}
                </Button>
                <FieldDescription className="px-6 text-center">
                  Already have an account?{" "}
                  <Link href="/login" className="underline">
                    Log in
                  </Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
