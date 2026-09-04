"use client";

import { CircleOffIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { useActiveContext } from "@/features/session/active-context";
import { SubscribeDialog } from "./subscribe-dialog";
import { subscriptionStatusClass, moneyCellClass } from "./fee-styles";
import {
  useFeeSubscriptions,
  useSubscriptionMutations,
} from "./use-fee-setup";
import { useFeeHeads } from "./use-fee-setup";
import type { FeeSubscription } from "@/lib/trpc/types";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * OPTIONAL SERVICES — the fee profile card's subscriptions section.
 * Subscribe (optional heads only), cancel (future instalments stop
 * generating; billed ones stay — the confirm says so). After subscribing,
 * the card's Generate picks the new months (the generator's
 * subscription arm); the section's copy points at it.
 *
 * List permission is `fee_structure:read` (the ledger-family mapping),
 * so the section itself sits inside the card's read gate and the
 * create/cancel actions degrade per their own permissions.
 */
export function SubscriptionsSection({
  studentId,
  activeSession,
}: {
  studentId: string;
  activeSession: { id: string; name: string } | undefined;
}) {
  const { schoolId } = useActiveContext();
  const subscriptions = useFeeSubscriptions(activeSession?.id, studentId);
  const heads = useFeeHeads();
  const { create, cancel } = useSubscriptionMutations();

  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [cancelling, setCancelling] = useState<FeeSubscription | undefined>();

  const headNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const head of heads.data ?? []) map.set(head.id, head.name);
    return map;
  }, [heads.data]);

  const optionalHeads = useMemo(
    () => (heads.data ?? []).filter((head) => head.category === "optional"),
    [heads.data],
  );

  const rows = subscriptions.data ?? [];
  const isEmpty = !subscriptions.isLoading && rows.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {isEmpty ? (
        // Nothing subscribed: one quiet line, not a titled section with
        // an empty dashed box shouting about nothing.
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">{copy.fees.subscriptions.emptyTitle}</p>
          <PermissionGate permission="fee_structure:create">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSubscribeOpen(true)}
              disabled={!create.canSubmit}
            >
              <PlusIcon data-icon="inline-start" />
              {copy.fees.subscriptions.add}
            </Button>
          </PermissionGate>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{copy.fees.subscriptions.title}</h3>
            <PermissionGate permission="fee_structure:create">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSubscribeOpen(true)}
                disabled={!create.canSubmit}
              >
                <PlusIcon data-icon="inline-start" />
                {copy.fees.subscriptions.add}
              </Button>
            </PermissionGate>
          </div>
          <p className="text-muted-foreground text-xs">{copy.fees.subscriptions.subtitle}</p>
        </>
      )}

      {subscriptions.isLoading ? (
        <p className="text-muted-foreground py-2 text-sm">{copy.common.loading}</p>
      ) : rows.length === 0 ? null : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-3 py-2 font-medium">{copy.fees.subscriptions.fields.head}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {copy.fees.subscriptions.fields.monthly}
                </th>
                <th className="px-3 py-2 font-medium">{copy.fees.subscriptions.fields.from}</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">{copy.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sub) => (
                <tr key={sub.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{headNameById.get(sub.feeHeadId) ?? copy.common.none}</span>
                    {sub.serviceDetail ? (
                      <span className="text-muted-foreground block text-xs">{sub.serviceDetail}</span>
                    ) : null}
                  </td>
                  <td className={cn("px-3 py-2", moneyCellClass)}>{formatMoney(sub.monthlyAmount)}</td>
                  <td className="px-3 py-2">
                    {formatIsoDate(sub.subscribedFrom)}
                    {sub.subscribedTo ? ` – ${formatIsoDate(sub.subscribedTo)}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <span className={subscriptionStatusClass(sub.status)}>
                      {copy.fees.subscriptionStatuses[sub.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {sub.status === "active" ? (
                      <PermissionGate permission="fee_structure:update">
                        <Button variant="ghost" size="sm" onClick={() => setCancelling(sub)}>
                          <CircleOffIcon data-icon="inline-start" />
                          {copy.fees.subscriptions.cancelAction}
                        </Button>
                      </PermissionGate>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SubscribeDialog
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        optionalHeads={optionalHeads}
        studentId={studentId}
        academicYearId={activeSession?.id ?? ""}
        pending={create.isPending}
        onSubmit={async (data) => {
          try {
            // studentId/academicYearId arrive IN the form values (the schema
            // requires them; the card's context fills them).
            await create.submit(data);
            setSubscribeOpen(false);
          } catch {
            // Refused: the toast carries the wording; the form stays.
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => !open && setCancelling(undefined)}
        title={copy.fees.subscriptions.cancelTitle}
        consequence={copy.fees.subscriptions.cancelBody}
        confirmLabel={copy.fees.subscriptions.cancelConfirm}
        destructive
        pending={cancel.isPending}
        onConfirm={async () => {
          if (!cancelling || !schoolId) return;
          try {
            await cancel.submit(cancelling.schoolId, cancelling.id);
          } finally {
            setCancelling(undefined);
          }
        }}
      />
    </div>
  );
}
