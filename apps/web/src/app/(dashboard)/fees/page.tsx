"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useActiveContext } from "@/features/session/active-context";
import { firstPermittedFeeTab } from "@/features/fees/tabs";

/**
 * `/fees` has no screen of its own — it lands on the first tab the caller
 * may see. The caller's permission set decides which; someone with only
 * `fee_report:read` (a vice-principal) lands on the Ledger, a class
 * teacher on Dues, an accountant on Setup.
 *
 * A caller with NO fees permission cannot reach the nav item at all, so
 * the "no tab" case here is a bookmarked URL — the fallback renders the
 * friendly refusal rather than redirecting into a 403 screen.
 */
export default function FeesIndexPage() {
  const { has } = useActiveContext();
  const router = useRouter();
  const target = firstPermittedFeeTab(has);

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return null;
}
