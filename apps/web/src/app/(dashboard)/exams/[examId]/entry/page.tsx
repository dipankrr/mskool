"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Spinner } from "@/components/ui/spinner";
import { MarksEntryGrid, type MarkGridSaveInput } from "@/features/exams/marks-entry-grid";
import { useClasses } from "@/features/classes/use-classes";
import {
  useEligibility,
  useExamDetail,
} from "@/features/exams/use-exam-workflow";
import {
  useEntryGrid,
  useSaveCell,
  useVerifyEntries,
} from "@/features/exams/use-marks-entry";
import { useActiveContext } from "@/features/session/active-context";
import { useSections } from "@/features/sections/use-sections";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * MARKS ENTRY (S3) — one screen, two modes.
 *
 * Entry mode: the paper's grid, autosaving per cell; eligibility badges
 * ride on the rows (advisory — entry is never blocked by the bar).
 * Verification mode: the same data with the verify act (`marks:verify`,
 * a logged batch; verifier == enterer is allowed but recorded). Splitting
 * these into two screens would split the teacher's model for zero gain —
 * the states live on the cells, not on the page.
 */

const ENTRY_OPEN = new Set(["marks_entry", "under_verification"]);

export default function ExamEntryPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId;
  const { scopeArgs, has } = useActiveContext();

  const detail = useExamDetail(examId);
  const classes = useClasses();
  const subjects = trpc.subject.list.useQuery(scopeArgs(), { staleTime: 30_000 });
  const [pickedScheduleId, setPickedScheduleId] = useState<string | null>(null);

  const schedules = detail.data?.schedules ?? [];
  const scheduleId = pickedScheduleId ?? schedules[0]?.id ?? null;

  // A class-wide paper is entered section by section (the subject gate
  // checks the (section, subject) assignment fact) — the teacher names
  // her section before the roster loads.
  const [pickedSectionId, setPickedSectionId] = useState<string | null>(null);
  const grid = useEntryGrid(examId, scheduleId ?? undefined, pickedSectionId ?? undefined);
  const needsSection = Boolean(grid.data && !grid.data.sectionId && !pickedSectionId);
  const sections = useSections(grid.data?.classId ?? undefined, {
    enabled: Boolean(grid.data && !grid.data.sectionId),
  });

  // A new schedule may belong to a different class — the section choice
  // does not carry over.
  useEffect(() => {
    setPickedSectionId(null);
  }, [scheduleId]);
  const eligibility = useEligibility(examId);
  const saveCell = useSaveCell(examId, scheduleId ?? "");
  const verify = useVerifyEntries(examId, scheduleId ?? "");
  const [verifyOpen, setVerifyOpen] = useState(false);

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const klass of classes.data ?? []) map.set(klass.id, klass.name);
    return map;
  }, [classes.data]);

  const subjectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of subjects.data ?? []) map.set(subject.id, subject.name);
    return map;
  }, [subjects.data]);

  const paperLabel = (id: string) => {
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) return copy.common.none;
    const parts = [
      classNameById.get(schedule.classId) ?? copy.common.none,
      subjectNameById.get(schedule.subjectId) ?? copy.common.none,
    ];
    return parts.join(" — ");
  };

  const eligibilityMap = useMemo(() => {
    const map = new Map<string, { isEligible: boolean; isOverridden: boolean }>();
    for (const row of eligibility.data ?? []) {
      map.set(row.studentId, { isEligible: row.isEligible, isOverridden: row.isOverridden });
    }
    return map;
  }, [eligibility.data]);

  const examStatus = grid.data?.examStatus;
  const entryOpen = Boolean(examStatus && ENTRY_OPEN.has(examStatus));

  const onSave = async (input: MarkGridSaveInput) => {
    if (!scheduleId) return null;
    // The ADR-029 gate pairs (section, subject): the section is the paper's
    // own, or the one the entering teacher picked for a class-wide paper.
    const sectionId = grid.data?.sectionId ?? pickedSectionId;
    if (!sectionId) return null;
    return saveCell.mutateAsync({
      ...scopeArgs(),
      examId,
      scheduleId,
      sectionId,
      subjectId: grid.data?.subjectId ?? "",
      ...input,
      exemptionType: (input.exemptionType as "medical" | null) ?? null,
    });
  };

  const verifiableIds = useMemo(
    () =>
      (grid.data?.entries ?? [])
        .filter((e) => e.resultStatus === "entered")
        .map((e) => e.id),
    [grid.data],
  );

  if (detail.isLoading) {
    return <PageHeader title={copy.common.loading} description={undefined} />;
  }

  if (!detail.data || schedules.length === 0) {
    return (
      <EmptyState
        title={copy.exams.entry.title}
        description={copy.exams.entry.notOpen}
        action={
          <Link href={`/exams/${examId}`} className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={copy.exams.entry.title}
        description={copy.exams.entry.subtitle}
        actions={
          <Link href={`/exams/${examId}`} className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />

      {!entryOpen ? (
        <p className="bg-muted text-muted-foreground rounded-lg px-4 py-3 text-sm">
          {copy.exams.entry.notOpen} {copy.exams.entry.readOnly}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={scheduleId ?? ""}
          onValueChange={(v) => {
            if (v) setPickedScheduleId(v);
          }}
        >
          <SelectTrigger aria-label={copy.exams.entry.paper} className="w-72">
            <SelectValue>
              {(value: string | null) =>
                value ? paperLabel(value) : copy.common.none
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {schedules.map((schedule) => (
              <SelectItem key={schedule.id} value={schedule.id}>
                {paperLabel(schedule.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {needsSection ? (
          <Select
            value=""
            onValueChange={(v) => {
              if (v) setPickedSectionId(v);
            }}
          >
            <SelectTrigger aria-label={copy.exams.entry.section} className="w-56">
              <SelectValue>{copy.exams.entry.section}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(sections.data ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {entryOpen && has("marks:verify") ? (
          <Button
            variant="outline"
            disabled={verifiableIds.length === 0 || verify.isPending}
            onClick={() => setVerifyOpen(true)}
          >
            {copy.exams.entry.verify}
            {verifiableIds.length > 0 ? (
              <Badge variant="secondary" className="ml-2">
                {verifiableIds.length}
              </Badge>
            ) : null}
          </Button>
        ) : null}
      </div>

      {grid.isLoading ? (
        <Spinner className="mt-8" />
      ) : grid.data ? (
        <MarksEntryGrid
          grid={grid.data}
          editable={entryOpen}
          eligibility={eligibilityMap}
          onSave={onSave}
        />
      ) : null}

      <ConfirmDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        title={copy.exams.entry.verifyTitle}
        consequence={copy.exams.entry.verifyConsequence}
        confirmLabel={copy.exams.entry.verify}
        pending={verify.isPending}
        onConfirm={() => {
          if (verifiableIds.length === 0) return;
          verify.mutate({
            ...scopeArgs(),
            componentResultIds: verifiableIds,
            // The same gate pair as the save: the paper's own section (or
            // the picked one for class-wide papers) and its subject.
            sectionId: grid.data?.sectionId ?? pickedSectionId ?? "",
            subjectId: grid.data?.subjectId ?? "",
          });
          setVerifyOpen(false);
        }}
      />
    </>
  );
}
