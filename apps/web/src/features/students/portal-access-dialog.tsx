"use client";

import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/permission-gate";
import type { Student } from "@/lib/trpc/types";
import { copy } from "@/lib/copy";
import { usePortalAccessActions, usePortalAccessLinks } from "./use-portal-access";

/**
 * THE FAMILY LOGINS (ADR-037) — a read view with one act.
 *
 * Family logins come from the parents recorded on this student: the phone
 * number there IS the sign-in, and the family sets its own password from
 * home. There is deliberately no credential control here — no password to
 * issue, no number to change. The single staff act is revocation (custody,
 * correction), behind a consequence confirm, and it is recorded.
 */
export function PortalAccessDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
}) {
  const { revokeLink, scopeArgs } = usePortalAccessActions(student.id);
  const links = usePortalAccessLinks(student.id);

  const [revokeTarget, setRevokeTarget] = useState<{
    userId: string;
    username: string;
  } | null>(null);

  const close = () => {
    onOpenChange(false);
    setRevokeTarget(null);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        <DialogContent className="flex max-h-[85svh] flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRoundIcon className="size-4" />
              {copy.portalAccess.title}
            </DialogTitle>
            <DialogDescription>
              {[student.firstName, student.lastName].filter(Boolean).join(" ")} —{" "}
              {student.admissionNumber}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            {links.isLoading ? (
              <p className="text-muted-foreground text-sm">{copy.common.loading}</p>
            ) : links.error || !links.data ? (
              <p className="text-muted-foreground text-sm">{copy.errors.unknown}</p>
            ) : links.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">{copy.portalAccess.linkEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {links.data.map((link) => (
                  <li
                    key={link.userId}
                    className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="text-sm font-medium">{link.username}</span>
                    <Badge variant={link.isActive ? "default" : "outline"}>
                      {link.isActive
                        ? copy.portalAccess.linkActive
                        : copy.portalAccess.linkPending}
                    </Badge>
                    <Badge variant="outline">
                      {link.hasCredential
                        ? copy.portalAccess.linkCredentialSet
                        : copy.portalAccess.linkCredentialPending}
                    </Badge>
                    <PermissionGate permission="portal_access:change_phone">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={revokeLink.isPending}
                        onClick={() =>
                          setRevokeTarget({ userId: link.userId, username: link.username })
                        }
                      >
                        {copy.portalAccess.linkRevoke}
                      </Button>
                    </PermissionGate>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground text-sm">{copy.portalAccess.linkFromGuardians}</p>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRevokeTarget(null);
        }}
        title={`${copy.portalAccess.linkRevoke} — ${revokeTarget?.username ?? ""}`}
        consequence={copy.portalAccess.linkRevokeConsequence}
        confirmLabel={copy.portalAccess.linkRevoke}
        pending={revokeLink.isPending}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await revokeLink.mutateAsync({
              ...scopeArgs(),
              studentId: student.id,
              userId: revokeTarget.userId,
            });
            setRevokeTarget(null);
          } catch {
            // The error toast is shown by the hook; the dialog stays.
          }
        }}
      />
    </>
  );
}

/** The row action — permission-gated, renders inside the students table. */
export function PortalAccessRowAction({
  student,
  onOpen,
}: {
  student: Student;
  onOpen: (student: Student) => void;
}) {
  return (
    <PermissionGate permission="portal_access:activate">
      <Button variant="ghost" size="sm" onClick={() => onOpen(student)}>
        <KeyRoundIcon data-icon="inline-start" />
        {copy.portalAccess.title}
      </Button>
    </PermissionGate>
  );
}
