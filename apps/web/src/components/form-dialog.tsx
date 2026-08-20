"use client";

import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { copy } from "@/lib/copy";

/**
 * EVERY CREATE AND EDIT FORM IN THE CONSOLE.
 *
 * A centred dialog on a desktop; a sheet from the bottom edge on a phone, where a
 * centred box fights the on-screen keyboard for the same space and usually loses —
 * the submit button ends up under the keyboard with no way to scroll to it.
 *
 * **This one switch is allowed to use JavaScript**, and it is the exception that
 * proves the rule elsewhere. Dialog and Sheet are different components with
 * different portals and focus traps; rendering both and hiding one with CSS would
 * mount two modals, two focus traps and two copies of every field id. The usual
 * objection to a JS breakpoint is hydration mismatch, and it does not apply here:
 * a modal only exists after the user has opened it, which is necessarily after
 * hydration. `useIsMobile` also returns `undefined` until mounted, so even a
 * server-rendered open state would agree with the first client render. Layout-level
 * switching — `DataTable`'s cards versus table — stays pure CSS.
 *
 * The form element wraps the fields *and* the footer, so the submit button is a
 * real `type="submit"` and Enter works in a text field. Chunks 8-11 pass
 * `form.handleSubmit(...)` straight in as `onSubmit`.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = copy.common.save,
  pending = false,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** The fields. Wrap them in `FieldGroup`. */
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel?: string;
  pending?: boolean;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex max-h-[90svh] flex-col">
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
            <SheetHeader className="p-0">
              <SheetTitle>{title}</SheetTitle>
              {description ? <SheetDescription>{description}</SheetDescription> : null}
            </SheetHeader>
            <FormBody>{children}</FormBody>
            <SheetFooter className="flex-col gap-2 p-0">
              <Button type="submit" disabled={pending || disabled}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {pending ? copy.common.saving : submitLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {copy.common.cancel}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <FormBody>{children}</FormBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {copy.common.cancel}
            </Button>
            <Button type="submit" disabled={pending || disabled}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? copy.common.saving : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The scrolling region, and the reason the footer is always reachable.
 *
 * Found the hard way: a branch form has eleven fields, which on a 768px-tall screen
 * is taller than the dialog. Without this the whole popup grew past the viewport and
 * the submit button ended up somewhere below the bottom edge with nothing to scroll —
 * the form could be filled in and not saved. Only the fields scroll; the title and
 * the buttons stay put. `min-h-0` is what lets a flex child actually shrink instead
 * of forcing its parent to grow.
 */
function FormBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
      {children}
    </div>
  );
}
