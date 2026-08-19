import { redirect } from "next/navigation";

import { LoginForm } from "@/features/auth/components/login-form"
import { hasServerSession } from "@/lib/auth-server";

/** Same reason as the (dashboard) layout: the session read must not be cached. */
export const dynamic = "force-dynamic";

/**
 * An already-signed-in visitor is sent home before the form is ever rendered.
 *
 * This decision used to live in the form as a `router.push("/")` in the render
 * body — a side effect during render, which React is free to run twice or throw
 * away, and which flashed the sign-in card before navigating. Deciding it here
 * means the signed-in visitor never receives the form at all.
 *
 * It cannot ping-pong with the (dashboard) gate: both ask the same endpoint the
 * same question, and both treat an unreachable API as "no session", so an API
 * outage lands everyone on this form rather than in a redirect loop.
 */
export default async function LoginPage() {
  if (await hasServerSession()) {
    redirect("/");
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
