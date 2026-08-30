"use client";

import { useEffect, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { copy } from "@/lib/copy";

/**
 * Enroll a student into the ACTIVE session. The session comes from the
 * switcher, not a picker — the enrollment is anchored to whatever session
 * the user is working in, and the help text says so. (Enrolling into a
 * different session is "switch sessions first", which keeps one source of
 * truth for the year anchor.)
 *
 * The section is OPTIONAL on purpose: the status machine derives `admitted`
 * without one and `section_assigned` with one, which is exactly the two-step
 * admission the front desk already knows — enroll today, assign the section
 * when the lists settle.
 */
export function EnrollDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { classId: string; sectionId?: string }) => void;
  pending: boolean;
}) {
  const classes = useClasses();
  const [classId, setClassId] = useState<string>("");
  const [sectionId, setSectionId] = useState<string>("");

  const sections = useSections(classId || undefined, { enabled: open && Boolean(classId) });

  /** Reset the pickers on open — the dialog stays mounted between openings. */
  useEffect(() => {
    if (!open) return;
    setClassId("");
    setSectionId("");
  }, [open]);

  const canSubmit = Boolean(classId);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.students.enrollment.enrollTitle}
      description={copy.students.enrollment.enrollHelp}
      submitLabel={copy.students.enrollment.enroll}
      pending={pending}
      disabled={!canSubmit}
      onSubmit={() => {
        if (!classId) return;
        onSubmit({ classId, ...(sectionId ? { sectionId } : {}) });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="enroll-class">{copy.students.enrollment.class}</FieldLabel>
          <Select value={classId || undefined} onValueChange={(value) => setClassId(value ?? "")}>
            <SelectTrigger id="enroll-class">
              <SelectValue>{(value: string | null) => value ?? copy.common.required}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(classes.data ?? []).map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="enroll-section">{copy.students.enrollment.section}</FieldLabel>
          <Select
            value={sectionId || undefined}
            onValueChange={(value) => setSectionId(value ?? "")}
            disabled={!classId}
          >
            <SelectTrigger id="enroll-section" disabled={!classId}>
              <SelectValue>
                {(value: string | null) =>
                  value ?? (classId ? copy.common.none : copy.common.none)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(sections.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{copy.students.enrollment.sectionOptionalHelp}</FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
