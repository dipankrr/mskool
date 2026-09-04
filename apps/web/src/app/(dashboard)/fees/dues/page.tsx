"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old Dues URL — kept as a redirect shim (bookmarks, nav history). */
export default function FeesDuesShim() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/fees/outstanding");
  }, [router]);
  return null;
}
