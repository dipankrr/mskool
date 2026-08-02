"use client";

import { trpc } from "@/lib/trpc/client";
import {Button} from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { ModeToggle } from "@/components/theme-toggle";
// Demo: a school_incharge's dashboard showing this exam cycle's
// registrations, using the same fully-typed tRPC hook a school_incharge
// session would get. Swap the hardcoded ids for ones from your seed
// output (`pnpm db:seed` prints them).
export default function HomePage() {
  const organizationId = "REPLACE_WITH_SEEDED_ORG_ID";
  const examCycleId = "REPLACE_WITH_SEEDED_EXAM_CYCLE_ID";

  // const exams = trpc.exam.list.useQuery({ organizationId });
  const health = trpc.health.health.useQuery();
  const session = authClient.useSession()
  console.log("client", process.env.NEXT_PUBLIC_API_URL);

  return (
    <main style={{ padding: 32,}}>
      <Button>Click me</Button>
      <ModeToggle />
      <h1>Designing with rhythm and hierarchy.</h1>
      <p>This page proves the tRPC client ↔ API ↔ DB chain is wired end to end.</p>

      <h2>Exams in this org</h2>

      <h2>Health check : {health.data}</h2>

      <h2>Registrations in this cycle</h2>

    </main>
  );
}
