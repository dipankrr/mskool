import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useActiveContext } from "../../hooks/use-active-context";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { useStudentPhotoUploader } from "./student-photo";
import { rosterInMarkingOrder, type RosterEntry } from "./photo-matching";

/**
 * Shared by the photo grid and photo day: one section's current students in
 * roll order, which of them already have a photo, and the section's label.
 * Reads the Students tab's roster (ADR-057), every page of it.
 */
export function useSectionRoster(sectionId: string | undefined, enabled: boolean) {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const on =
    enabled && ready && Boolean(organizationId) && Boolean(academicYear?.id) && Boolean(sectionId);

  const roster = trpc.student.roster.useInfiniteQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
      sectionId: sectionId ?? "",
      view: "current",
      sort: "class",
      limit: 100,
    },
    { enabled: on, getNextPageParam: (page) => page.nextCursor },
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = roster;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const rows = useMemo(
    () => (roster.data?.pages ?? []).flatMap((page) => page.rows),
    [roster.data],
  );
  const entries: RosterEntry[] = useMemo(
    () =>
      rosterInMarkingOrder(
        rows.map((row) => ({
          studentId: row.id,
          admissionNumber: row.admissionNumber,
          name: [row.firstName, row.lastName].filter(Boolean).join(" "),
          rollNumber: row.rollNumber,
        })),
      ),
    [rows],
  );
  const currentPhoto = useMemo(
    () =>
      new Map(
        rows.flatMap((row) => (row.photo ? [[row.id, row.photo.url] as const] : [])),
      ),
    [rows],
  );
  const first = rows[0];
  const label = first
    ? [first.className, first.sectionName].filter(Boolean).join(" · ")
    : null;

  return { query: roster, entries, currentPhoto, label };
}

export type UploadStatus =
  | { state: "waiting" }
  | { state: "uploading" }
  | { state: "done" }
  | { state: "failed"; reason: string };

export type UploadJob = {
  studentId: string;
  uri: string;
  width: number;
  height: number;
};

/** Uploads in flight at once: faster than one, gentle on a school's Wi-Fi. */
const PARALLEL_UPLOADS = 3;

/**
 * A small upload queue: jobs start as soon as they are added, at most three
 * at a time, each straight to the bucket and then `student.setPhoto`
 * (ADR-063). A newer job for the same student replaces a waiting one. Every
 * failure keeps its reason; `retryFailed` sends those again.
 */
export function useUploadQueue(onSaved?: () => void) {
  const { organizationId } = useActiveContext();
  const uploader = useStudentPhotoUploader();
  const [statuses, setStatuses] = useState<Record<string, UploadStatus>>({});
  const queue = useRef<UploadJob[]>([]);
  const jobs = useRef(new Map<string, UploadJob>());
  const running = useRef(0);
  const savedRef = useRef(onSaved);
  useEffect(() => {
    savedRef.current = onSaved;
  }, [onSaved]);

  const set = (studentId: string, status: UploadStatus) =>
    setStatuses((current) => ({ ...current, [studentId]: status }));

  // The pump calls itself as each upload ends, so it lives in a ref.
  const pumpRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    pumpRef.current = () => {
      if (!organizationId) return;
      while (running.current < PARALLEL_UPLOADS && queue.current.length > 0) {
        const job = queue.current.shift()!;
        running.current += 1;
        set(job.studentId, { state: "uploading" });
        uploader
          .upload(organizationId, job.studentId, {
            uri: job.uri,
            width: job.width,
            height: job.height,
          })
          .then(
            () => {
              // A newer photo queued meanwhile wins; this one is old news.
              if (jobs.current.get(job.studentId) === job) set(job.studentId, { state: "done" });
              savedRef.current?.();
            },
            (error: unknown) => {
              if (jobs.current.get(job.studentId) === job) {
                set(job.studentId, { state: "failed", reason: toFriendlyError(error).message });
              }
            },
          )
          .finally(() => {
            running.current -= 1;
            pumpRef.current();
          });
      }
    };
  });
  const pump = useCallback(() => pumpRef.current(), []);

  const add = useCallback(
    (list: UploadJob[]) => {
      for (const job of list) {
        queue.current = queue.current.filter((queued) => queued.studentId !== job.studentId);
        queue.current.push(job);
        jobs.current.set(job.studentId, job);
        set(job.studentId, { state: "waiting" });
      }
      pump();
    },
    [pump],
  );

  const retryFailed = useCallback(() => {
    const failed = Object.entries(statuses)
      .filter(([, status]) => status.state === "failed")
      .flatMap(([studentId]) => {
        const job = jobs.current.get(studentId);
        return job ? [job] : [];
      });
    add(failed);
  }, [statuses, add]);

  const reset = useCallback(() => {
    queue.current = [];
    jobs.current.clear();
    setStatuses({});
  }, []);

  const values = Object.values(statuses);
  const counts = {
    done: values.filter((status) => status.state === "done").length,
    failed: values.filter((status) => status.state === "failed").length,
    busy: values.filter(
      (status) => status.state === "uploading" || status.state === "waiting",
    ).length,
    total: values.length,
  };

  return { statuses, counts, add, retryFailed, reset };
}
