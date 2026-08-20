"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { copy } from "@/lib/copy";

/**
 * "Are you sure?" is not a question anyone can answer.
 *
 * So `consequence` is a **required** prop, and it must describe what happens rather
 * than restate the button. The actions this guards — closing a branch, promoting a
 * session — are ones a non-technical user cannot undo by guessing, and in this
 * product they are also routinely *misread as deletion*. Nothing here hard-deletes
 * (hard rule 2), and the consequence text is where that gets said out loud.
 *
 * The dialog stays open while `pending`, because closing it on submit would leave
 * the user unsure whether a slow request landed. `Button` has no loading prop by
 * design: a Spinner plus `disabled` is the composition.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  destructive = false,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will actually happen. Required — see above. */
  consequence: string;
  /** Repeats the verb from the button that opened this. Never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  pending?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
