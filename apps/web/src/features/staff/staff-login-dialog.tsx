"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";

/**
 * Invite a staff member (ADR-068). Staff sign in with their phone; the first
 * time (and whenever they forget the password) they need a 6-digit code from
 * the office. Opening this dialog issues a fresh code (the server revokes any
 * older one) and shows it once, with a WhatsApp message ready to send.
 */
export function StaffInviteDialog({
  open,
  onOpenChange,
  staffId,
  staffName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
}) {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();
  const invite = trpc.staff.invite.useMutation({
    onSuccess: () => void utils.staff.invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) invite.mutate({ ...scopeArgs(), id: staffId });
    // One code per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const data = invite.data;
  const until = data
    ? new Date(data.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
    : "";
  const phone = data ? `${data.phone.slice(0, 5)} ${data.phone.slice(5)}` : "";
  const message = data
    ? data.resetsPassword
      ? `Hi ${data.firstName}, here is your code to set a new password on the ${data.organizationName} app. Open the app, tap I'm staff, enter ${phone}, then "I have a code from the office". Code: ${data.code} (works once, till ${until}).`
      : `Hi ${data.firstName}, you've been added to ${data.organizationName} on the school app. Install it, tap I'm staff, enter your phone ${phone}, then the code ${data.code}. The code works once, till ${until}.`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {data?.resetsPassword ? `New code for ${staffName}` : `Invite ${staffName}`}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `They sign in with ${phone} and this code. It works once, till ${until}.`
              : "Making a joining code…"}
          </DialogDescription>
        </DialogHeader>
        {data ? (
          <div className="flex flex-col gap-4">
            <div className="flex justify-center gap-2" aria-label={`Code ${data.code.split("").join(" ")}`}>
              {data.code.split("").map((digit, i) => (
                <span
                  key={i}
                  className="flex h-14 w-11 items-center justify-center rounded-lg bg-primary/10 text-2xl font-semibold tabular-nums text-primary"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-line">{message}</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => {
              void navigator.clipboard.writeText(message).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy message"}
          </Button>
          <Button
            disabled={!data}
            onClick={() =>
              window.open(
                `https://wa.me/91${data?.phone}?text=${encodeURIComponent(message)}`,
                "_blank",
                "noopener",
              )
            }
          >
            Share on WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
