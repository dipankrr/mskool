"use client";

import { useEffect, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSections } from "@/features/sections/use-sections";
import { copy } from "@/lib/copy";

/**
 * The FIRST section assignment. The help text says what the server enforces:
 * a student who already has a section cannot be re-pointed here — that is a
 * transfer, and the transfer flow does not exist yet. The dialog is only
 * offered for enrollments without a section, so the refusal should never
 * fire; if it does (a race with a colleague), its wording is honest.
 */
export function AssignSectionDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { sectionId: string; rollNumber?: string }) => void;
  pending: boolean;
}) {
  const sections = useSections();
  const [sectionId, setSectionId] = useState<string>("");
  const [rollNumber, setRollNumber] = useState("");

  useEffect(() => {
    if (!open) return;
    setSectionId("");
    setRollNumber("");
  }, [open]);

  const canSubmit = Boolean(sectionId);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.students.enrollment.assignSectionTitle}
      description={copy.students.enrollment.assignSectionHelp}
      submitLabel={copy.students.enrollment.assignSection}
      pending={pending}
      disabled={!canSubmit}
      onSubmit={() => {
        if (!sectionId) return;
        onSubmit({ sectionId, ...(rollNumber.trim() ? { rollNumber: rollNumber.trim() } : {}) });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="assign-section">
            {copy.students.enrollment.section}
          </FieldLabel>
          <Select value={sectionId || undefined} onValueChange={(value) => setSectionId(value ?? "")}>
            <SelectTrigger id="assign-section">
              <SelectValue>
                {(value: string | null) => value ?? copy.common.required}
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
        </Field>

        <Field>
          <FieldLabel htmlFor="assign-roll">{copy.students.enrollment.rollNumber}</FieldLabel>
          <Input
            id="assign-roll"
            value={rollNumber}
            onChange={(event) => setRollNumber(event.target.value)}
            maxLength={20}
          />
          <FieldDescription>{copy.students.enrollment.rollNumberHelp}</FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
