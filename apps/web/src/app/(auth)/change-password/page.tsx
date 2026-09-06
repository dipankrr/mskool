"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { copy } from "@/lib/copy";

/**
 * THE FORCED FIRST-LOGIN CHANGE (ADR-007). Staff set a temporary password
 * at activation/reset; `must_change_password` means the session is real
 * but the credential is not yet the family's own. This screen is the gate:
 * the dashboard layout redirects every family login here until the flag
 * clears, and the change itself goes through better-auth's
 * /change-password — which verifies the CURRENT password, so the act is a
 * proof of possession, not a takeover.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The temporary password is what the family just typed at sign-in —
  // pre-fill it (they know it; retyping is ceremony) and select it so a
  // paste-over just works.
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async () => {
    if (next.length < 8 || next !== confirm) return;
    setPending(true);
    setError(null);
    const result = await changePassword(current, next);
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? copy.errors.unknown);
      return;
    }
    router.replace("/portal/results");
    router.refresh();
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{copy.changePassword.title}</CardTitle>
            <CardDescription>{copy.changePassword.subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="current">{copy.auth.password}</FieldLabel>
                  <Input
                    id="current"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(event) => setCurrent(event.target.value)}
                    required
                  />
                </Field>
                <Field data-invalid={next.length > 0 && next.length < 8 ? true : undefined}>
                  <FieldLabel htmlFor="next">{copy.changePassword.newPassword}</FieldLabel>
                  <Input
                    id="next"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={next}
                    onChange={(event) => setNext(event.target.value)}
                    required
                    aria-invalid={next.length > 0 && next.length < 8 ? true : undefined}
                  />
                  <FieldDescription>At least 8 characters.</FieldDescription>
                </Field>
                <Field data-invalid={mismatch ? true : undefined}>
                  <FieldLabel htmlFor="confirm">{copy.changePassword.confirm}</FieldLabel>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    required
                    aria-invalid={mismatch ? true : undefined}
                  />
                  {mismatch ? <FieldError>{copy.changePassword.mismatch}</FieldError> : null}
                </Field>
                {error ? <FieldError>{error}</FieldError> : null}
                <Button type="submit" disabled={pending || next !== confirm || next.length < 8}>
                  {pending ? copy.common.saving : copy.changePassword.submit}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
