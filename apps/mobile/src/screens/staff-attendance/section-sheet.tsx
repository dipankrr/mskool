import { ChoiceSheet } from "../../components/choice-sheet";
import { copy } from "../../lib/copy";

export type SectionOption = { id: string; label: string };

/**
 * The attendance tab's section picker (chunk 2) — now a thin wrapper over the
 * shared `ChoiceSheet`, so the sheet anatomy lives in exactly one file. The
 * section list arrives scope-clipped from above; selecting a row writes the
 * route param, which `useAttendanceSection` validates against the active
 * branch and session.
 */
export function SectionSheet({
  visible,
  options,
  currentId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  options: SectionOption[];
  currentId: string;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}) {
  return (
    <ChoiceSheet
      visible={visible}
      title={copy.attendance.section.sheetTitle}
      options={options}
      currentId={currentId}
      onSelect={onSelect}
      onDismiss={onDismiss}
      testIDPrefix="section-option"
    />
  );
}
