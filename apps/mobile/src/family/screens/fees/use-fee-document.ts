import { useState } from "react";

import { printDocument, shareDocument } from "../../../lib/fee-print";
import { trpc } from "../../../lib/trpc";

type Request =
  | { kind: "statement"; studentId: string }
  | { kind: "receipt"; studentId: string; paymentId: string };

/**
 * Fetches a fee document (the school's own receipt or statement, ADR-059)
 * and shares or prints it as a PDF, the same way the staff app does.
 */
export function useFeeDocument() {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const fetchDocument = (request: Request) =>
    request.kind === "statement"
      ? utils.portalFees.statement.fetch({ studentId: request.studentId })
      : utils.portalFees.receipt.fetch({ studentId: request.studentId, paymentId: request.paymentId });

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await work();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    share: (request: Request, dialogTitle: string) =>
      run(async () => shareDocument(await fetchDocument(request), dialogTitle)),
    print: (request: Request) => run(async () => printDocument(await fetchDocument(request))),
  };
}
