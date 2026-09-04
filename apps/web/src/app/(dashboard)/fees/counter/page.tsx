"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old Counter URL — kept as a redirect shim (bookmarks, E2E history). */
export default function FeesCounterShim() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/fees/collect");
  }, [router]);
  return null;
}
