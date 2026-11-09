import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { ChoiceSheet, type ChoiceOption } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { useStudentPhotoUploader } from "./student-photo";
import {
  admissionsToLookUp,
  captureTimeFromExif,
  matchByAdmission,
  matchByOrder,
  mergePhotos,
  movePhoto,
  rosterInMarkingOrder,
  sortPhotos,
  runPool,
  type PickedPhoto,
  type PhotoOrder,
  type RosterEntry,
} from "./photo-matching";

type RegisterRow =
  inferRouterOutputs<AppRouter>["student"]["byAdmissions"][number];
type Status =
  | { state: "uploading" }
  | { state: "done" }
  | { state: "failed"; reason: string };

/** A batch this size still renders as one list on a cheap phone. */
const MAX_PHOTOS = 150;
/** Uploads in flight at once: faster than one, gentle on a school's Wi-Fi. */
const PARALLEL_UPLOADS = 3;

/**
 * The photo workbench. A batch of photos matches to students — by roll order
 * in one section (SECTION) or by file name → admission number across the
 * whole school (REGISTER, `student.byAdmissions`, as on the web) — and every
 * match shows before anything uploads. Uploads go a few at a time, each
 * straight to the bucket and then `student.setPhoto` (ADR-063), with a reason
 * on every failure and retry-failed-only.
 *
 * SECTION mode keeps the web's model: the batch's order is the assignment.
 * Choosing more photos adds to the batch; the order can be re-sorted (time
 * taken from EXIF, or file name) or fixed by hand from a row's sheet (move up
 * or down, remove the photo, or skip a student so the next one takes the
 * turn). Students who already have a photo are marked, and can all be skipped
 * so only the missing ones are filled.
 */
export function StudentPhotosScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useBranchMeta();
  const { has } = usePermissions();

  const canWrite = has("student:update");
  const canReadRoster = has("student:read");

  const [mode, setMode] = useState<"section" | "register">("section");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [order, setOrder] = useState<PhotoOrder | "custom">("taken");
  const [manualSkips, setManualSkips] = useState<Set<string>>(new Set());
  const [skipHasPhoto, setSkipHasPhoto] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const [pickError, setPickError] = useState<unknown>(null);
  const [working, setWorking] = useState(false);
  const [rowSheet, setRowSheet] = useState<string | null>(null);
  const [photoSheet, setPhotoSheet] = useState<string | null>(null);

  const contextReady =
    ready && Boolean(organizationId) && canWrite && Boolean(academicYear?.id);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: contextReady },
  );
  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: contextReady },
  );

  // The section's current students, with roll numbers and their photos: the
  // Students tab's own read, so "has a photo" comes for free.
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
    {
      enabled:
        contextReady && canReadRoster && mode === "section" && Boolean(sectionId),
      getNextPageParam: (page) => page.nextCursor,
    },
  );
  // A section over 100 reads its remaining pages straight away.
  useEffect(() => {
    if (roster.hasNextPage && !roster.isFetchingNextPage) {
      void roster.fetchNextPage();
    }
  }, [roster.hasNextPage, roster.isFetchingNextPage, roster]);

  const rosterRows = useMemo(
    () => (roster.data?.pages ?? []).flatMap((page) => page.rows),
    [roster.data],
  );
  const rosterEntries: RosterEntry[] = useMemo(
    () =>
      rosterRows.map((row) => ({
        studentId: row.id,
        admissionNumber: row.admissionNumber,
        name: [row.firstName, row.lastName].filter(Boolean).join(" "),
        rollNumber: row.rollNumber,
      })),
    [rosterRows],
  );
  const hasPhoto = useMemo(
    () => new Set(rosterRows.filter((row) => row.photo).map((row) => row.id)),
    [rosterRows],
  );
  const rosterOrdered = useMemo(
    () => rosterInMarkingOrder(rosterEntries),
    [rosterEntries],
  );

  // REGISTER: the whole school's students for the batch's file names.
  const lookup = trpc.student.byAdmissions.useMutation();
  const [registerRows, setRegisterRows] = useState<RegisterRow[]>([]);
  const admissionsKey = useMemo(
    () => admissionsToLookUp(photos).join("|"),
    [photos],
  );
  useEffect(() => {
    if (mode !== "register" || !organizationId || !academicYear?.id) return;
    const admissions = admissionsKey ? admissionsKey.split("|") : [];
    // With no names to look up, old rows match nothing: leave them.
    if (admissions.length === 0) return;
    let live = true;
    lookup
      .mutateAsync({
        organizationId,
        schoolId: schoolId ?? undefined,
        academicYearId: academicYear.id,
        admissions,
      })
      .then((rows) => {
        if (live) setRegisterRows(rows);
      })
      .catch(() => {
        if (live) setRegisterRows([]);
      });
    return () => {
      live = false;
    };
    // `lookup` is stable; re-run only when the names or the context change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, admissionsKey, organizationId, schoolId, academicYear?.id]);

  const registerById = useMemo(
    () => new Map(registerRows.map((row) => [row.student.id, row])),
    [registerRows],
  );

  const skipped = useMemo(() => {
    const out = new Set(manualSkips);
    if (skipHasPhoto) for (const id of hasPhoto) out.add(id);
    return out;
  }, [manualSkips, skipHasPhoto, hasPhoto]);

  const { matches, unmatched } = useMemo(() => {
    if (photos.length === 0) return { matches: [], unmatched: [] };
    if (mode === "register") {
      return matchByAdmission(
        photos,
        registerRows.map((row) => ({
          studentId: row.student.id,
          admissionNumber: row.student.admissionNumber,
          name: `${row.student.firstName} ${row.student.lastName}`,
          rollNumber: row.rollNumber,
        })),
      );
    }
    return matchByOrder(photos, rosterEntries, skipped);
  }, [photos, mode, registerRows, rosterEntries, skipped]);

  const byStudent = useMemo(
    () => new Map(matches.map((match) => [match.studentId, match.photo])),
    [matches],
  );

  const resetBatch = () => {
    setPhotos([]);
    setStatuses({});
    setManualSkips(new Set());
    setPickNotice(null);
    setOrder("taken");
  };

  const pick = useCallback(async () => {
    setPickError(null);
    setPickNotice(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setPickNotice(copy.photos.tooMany(MAX_PHOTOS));
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: room,
        orderedSelection: true,
        quality: 1,
        exif: true,
      });
      if (result.canceled) return;
      const incoming: PickedPhoto[] = result.assets.map((asset) => ({
        id: asset.assetId ?? asset.uri,
        localUri: asset.uri,
        fileName: asset.fileName ?? null,
        creationTime: captureTimeFromExif(asset.exif),
        width: asset.width,
        height: asset.height,
      }));
      const merged = mergePhotos(photos, incoming);
      if (merged.added === 0) setPickNotice(copy.photos.added(0));
      // A sort stays a sort as photos arrive; a hand-made order keeps new
      // photos at the end.
      setPhotos(
        (order === "custom" ? merged.photos : sortPhotos(merged.photos, order)).slice(
          0,
          MAX_PHOTOS,
        ),
      );
    } catch (error) {
      setPickError(error);
    }
  }, [order, photos]);

  const applyOrder = (next: PhotoOrder | "custom") => {
    if (next === "custom") return;
    setOrder(next);
    setPhotos((current) => sortPhotos(current, next));
  };

  const removePhoto = (photoId: string) =>
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));

  const photoUploader = useStudentPhotoUploader();

  const doneCount = matches.filter(
    (match) => statuses[match.studentId]?.state === "done",
  ).length;
  const uploadTargets = matches.filter(
    (match) => statuses[match.studentId]?.state !== "done",
  );
  const failed = matches.filter(
    (match) => statuses[match.studentId]?.state === "failed",
  );
  const anyUploads = Object.keys(statuses).length > 0;

  const uploadAll = useCallback(
    async (targets: typeof matches) => {
      if (!organizationId) return;
      setWorking(true);
      try {
        await runPool(targets, PARALLEL_UPLOADS, async (target) => {
          setStatuses((current) => ({
            ...current,
            [target.studentId]: { state: "uploading" },
          }));
          try {
            await photoUploader.upload(organizationId, target.studentId, {
              uri: target.photo.localUri,
              width: target.photo.width,
              height: target.photo.height,
            });
            setStatuses((current) => ({
              ...current,
              [target.studentId]: { state: "done" },
            }));
          } catch (error) {
            setStatuses((current) => ({
              ...current,
              [target.studentId]: {
                state: "failed",
                reason: toFriendlyError(error).message,
              },
            }));
          }
        });
      } finally {
        setWorking(false);
        void roster.refetch();
      }
    },
    [organizationId, photoUploader, roster],
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.photos.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      titleTestID="photos-title"
    >
      {children}
    </ScreenFrame>
  );

  const className = (id: string | null) =>
    id
      ? (classes.data ?? []).find((candidate) => candidate.id === id)?.name ?? null
      : null;
  const sectionLabel = (id: string | null) => {
    if (!id) return null;
    const section = (sections.data ?? []).find((row) => row.id === id);
    if (!section) return null;
    return `${className(section.classId) ?? ""} · ${section.name}`.replace(/^ · /, "");
  };
  const sectionOptions: ChoiceOption[] = (sections.data ?? []).map((section) => ({
    id: section.id,
    label: sectionLabel(section.id) ?? section.name,
  }));
  const chooseSection = (id: string) => {
    setPickerOpen(false);
    if (id && id !== sectionId) {
      resetBatch();
      router.setParams({ sectionId: id });
    }
  };

  if (!canWrite) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.photos.deniedTitle}
        message={copy.photos.deniedBody}
        testID="photos-denied"
      />,
    );
  }
  if (!ready || !organizationId) return frame(<Skeleton height={220} />);
  if (!academicYear) {
    return frame(
      <EmptyState
        icon="sessions"
        title={copy.photos.noSessionTitle}
        message={copy.photos.noSessionBody}
        testID="photos-no-session"
      />,
    );
  }

  const modePills = (
    <Card>
      <ChoicePills
        label={copy.photos.modeLabel}
        value={mode}
        options={[
          { value: "section" as const, label: copy.photos.modes.section },
          { value: "register" as const, label: copy.photos.modes.register },
        ]}
        onChange={(next) => {
          if (working) return;
          setMode(next);
          setStatuses({});
        }}
        help={
          mode === "section" ? copy.photos.modeSectionHelp : copy.photos.modeRegisterHelp
        }
        testIDPrefix="photos-mode"
      />
    </Card>
  );

  const sectionSheet = (
    <ChoiceSheet
      visible={pickerOpen}
      title={copy.photos.pickSection}
      options={sectionOptions}
      currentId={sectionId ?? ""}
      onSelect={chooseSection}
      onDismiss={() => setPickerOpen(false)}
      testIDPrefix="photos-section-option"
    />
  );

  // ── SECTION mode needs a section and its roster first ──────────────────
  if (mode === "section") {
    if (sections.isPending || (Boolean(sectionId) && roster.isPending)) {
      return frame(
        <View style={styles.skeleton} accessibilityLabel={copy.photos.rosterLoading}>
          <Skeleton height={48} />
          <Skeleton height={180} />
        </View>,
      );
    }
    if (sections.isError || roster.isError) {
      return frame(
        <ErrorCard
          cause={sections.error ?? roster.error}
          onRetry={() => {
            void sections.refetch();
            void roster.refetch();
          }}
          testID="photos-error"
        />,
      );
    }
    if (!sectionId) {
      return frame(
        <View style={styles.body}>
          {modePills}
          <SectionLabel>{copy.photos.sectionLabel}</SectionLabel>
          <Card padless>
            {sectionOptions.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                onPress={() => chooseSection(option.id)}
                style={({ pressed }) => [
                  styles.sectionRow,
                  pressed ? styles.pressed : null,
                ]}
                testID={`photos-section-${option.id}`}
              >
                <ThemedText variant="bodyStrong" numberOfLines={1}>
                  {option.label}
                </ThemedText>
                <AppIcon name="chevronRight" size={18} color={colors.chevron} />
              </Pressable>
            ))}
          </Card>
        </View>,
      );
    }
    if (rosterOrdered.length === 0) {
      return frame(
        <View style={styles.body}>
          {modePills}
          <SectionPickerRow label={sectionLabel(sectionId)} onPress={() => setPickerOpen(true)} />
          <EmptyState
            icon="students"
            title={copy.photos.rosterEmptyTitle}
            message={copy.photos.rosterEmptyBody}
            testID="photos-empty"
          />
          {sectionSheet}
        </View>,
      );
    }
  }

  // ── The sheets ─────────────────────────────────────────────────────────
  const sheetStudent = rowSheet;
  const sheetPhoto = sheetStudent ? byStudent.get(sheetStudent) : undefined;
  const rowOptions: ChoiceOption[] = [];
  if (sheetStudent) {
    if (sheetPhoto) {
      if (mode === "section") {
        const index = photos.findIndex((photo) => photo.id === sheetPhoto.id);
        if (index > 0) rowOptions.push({ id: "up", label: copy.photos.moveUp });
        if (index < photos.length - 1) {
          rowOptions.push({ id: "down", label: copy.photos.moveDown });
        }
      }
      rowOptions.push({ id: "remove", label: copy.photos.removePhoto });
    }
    if (mode === "section") {
      rowOptions.push(
        skipped.has(sheetStudent)
          ? { id: "unskip", label: copy.photos.unskipStudent }
          : { id: "skip", label: copy.photos.skipStudent },
      );
    }
  }
  const onRowAction = (action: string) => {
    const studentId = rowSheet;
    setRowSheet(null);
    if (!studentId) return;
    if ((action === "up" || action === "down") && sheetPhoto) {
      setOrder("custom");
      setPhotos((current) => movePhoto(current, sheetPhoto.id, action === "up" ? -1 : 1));
    } else if (action === "remove" && sheetPhoto) {
      removePhoto(sheetPhoto.id);
    } else if (action === "skip") {
      setManualSkips((current) => new Set(current).add(studentId));
    } else if (action === "unskip") {
      setManualSkips((current) => {
        const next = new Set(current);
        next.delete(studentId);
        return next;
      });
      if (hasPhoto.has(studentId)) setSkipHasPhoto(false);
    }
  };

  // ── The rows ───────────────────────────────────────────────────────────
  const rows =
    mode === "section"
      ? rosterOrdered.map((entry) => ({
          studentId: entry.studentId,
          name: entry.name,
          meta: `Adm ${entry.admissionNumber}${
            entry.rollNumber ? ` · Roll ${entry.rollNumber}` : ""
          }`,
        }))
      : matches.map((match) => {
          const row = registerById.get(match.studentId);
          const where = [row?.className, row?.sectionName].filter(Boolean).join(" · ");
          return {
            studentId: match.studentId,
            name: row ? `${row.student.firstName} ${row.student.lastName}` : "",
            meta: [
              `Adm ${row?.student.admissionNumber ?? ""}`,
              where || null,
              row?.rollNumber ? `Roll ${row.rollNumber}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          };
        });

  const progress = matches.length > 0 ? doneCount / Math.max(1, uploadTargets.length + doneCount) : 0;
  const hasPhotoCount = hasPhoto.size;

  return frame(
    <View style={styles.body}>
      {modePills}
      {mode === "section" ? (
        <SectionPickerRow label={sectionLabel(sectionId ?? null)} onPress={() => setPickerOpen(true)} />
      ) : null}

      {mode === "section" && (photos.length > 0 || hasPhotoCount > 0) ? (
        <Card>
          {photos.length > 1 ? (
            <ChoicePills
              label={copy.photos.orderLabel}
              value={order}
              options={[
                { value: "taken" as const, label: copy.photos.orders.taken },
                { value: "name" as const, label: copy.photos.orders.name },
                ...(order === "custom"
                  ? [{ value: "custom" as const, label: copy.photos.orders.custom }]
                  : []),
              ]}
              onChange={applyOrder}
              help={
                order === "taken"
                  ? copy.photos.orderTakenHelp
                  : order === "name"
                    ? copy.photos.orderNameHelp
                    : copy.photos.orderCustomHelp
              }
              testIDPrefix="photos-order"
            />
          ) : null}
          {hasPhotoCount > 0 ? (
            <SwitchRow
              label={copy.photos.skipHasPhoto(hasPhotoCount)}
              help={copy.photos.skipHasPhotoHelp}
              value={skipHasPhoto}
              onChange={setSkipHasPhoto}
              disabled={working}
              testID="photos-skip-has-photo"
            />
          ) : null}
        </Card>
      ) : null}

      {photos.length > 0 ? (
        <SectionLabel>{copy.photos.summary(matches.length, photos.length)}</SectionLabel>
      ) : null}

      {mode === "register" && lookup.isPending ? (
        <Notice message={copy.photos.lookingUp} testID="photos-looking-up" />
      ) : null}
      {mode === "register" && lookup.isError ? (
        <Notice
          tone="critical"
          title={copy.photos.lookupFailed}
          message={toFriendlyError(lookup.error).message}
          testID="photos-lookup-error"
        />
      ) : null}
      {mode === "register" && photos.length === 0 ? (
        <Card>
          <ThemedText variant="meta">{copy.photos.registerEmpty}</ThemedText>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <Card padless>
          {rows.map((row) => {
            const photo = byStudent.get(row.studentId);
            const status = statuses[row.studentId];
            const isSkipped = mode === "section" && skipped.has(row.studentId);
            const already = hasPhoto.has(row.studentId);
            const tappable = !working;
            return (
              <Pressable
                key={row.studentId}
                accessibilityRole={tappable ? "button" : undefined}
                accessibilityLabel={`${row.name}, ${
                  photo ? "photo matched" : isSkipped ? copy.photos.skipped : "no photo"
                }${already ? `, ${copy.photos.hasPhoto}` : ""}`}
                accessibilityHint={tappable ? copy.photos.rowActions : undefined}
                onPress={tappable ? () => setRowSheet(row.studentId) : undefined}
                style={({ pressed }) => [
                  styles.rosterRow,
                  isSkipped ? styles.skippedRow : null,
                  pressed && tappable ? styles.pressed : null,
                ]}
                testID={`photos-row-${row.studentId}`}
              >
                {photo ? (
                  <Image
                    source={{ uri: photo.localUri }}
                    style={styles.thumb}
                    testID={`photos-thumb-${row.studentId}`}
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <AppIcon name="person" size={20} color={colors.muted} />
                  </View>
                )}
                <View style={styles.rowText}>
                  <ThemedText variant="name" numberOfLines={1}>
                    {row.name}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {row.meta}
                  </ThemedText>
                  {status?.state === "failed" ? (
                    <ThemedText
                      variant="meta"
                      numberOfLines={2}
                      style={styles.failReason}
                      testID={`photos-reason-${row.studentId}`}
                    >
                      {status.reason}
                    </ThemedText>
                  ) : null}
                </View>
                {status ? (
                  <StatusPill
                    label={
                      status.state === "done"
                        ? copy.photos.done
                        : status.state === "failed"
                          ? copy.photos.failed
                          : copy.photos.uploadingState
                    }
                    tone={
                      status.state === "done"
                        ? "positive"
                        : status.state === "failed"
                          ? "critical"
                          : "neutral"
                    }
                    testID={`photos-status-${row.studentId}`}
                  />
                ) : isSkipped ? (
                  <StatusPill label={copy.photos.skipped} tone="neutral" />
                ) : already ? (
                  <StatusPill
                    label={photo ? copy.photos.replacesPhoto : copy.photos.hasPhoto}
                    tone={photo ? "caution" : "neutral"}
                    testID={`photos-has-${row.studentId}`}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {unmatched.length > 0 ? (
        <>
          <SectionLabel>{copy.photos.unmatchedLabel(unmatched.length)}</SectionLabel>
          <Card>
            <ThemedText variant="meta">{copy.photos.unmatchedHelp}</ThemedText>
            <View style={styles.strip}>
              {unmatched.map((photo) => (
                <Pressable
                  key={photo.id}
                  accessibilityRole="button"
                  accessibilityLabel={photo.fileName ?? copy.photos.noFileName}
                  accessibilityHint={copy.photos.photoActions}
                  onPress={working ? undefined : () => setPhotoSheet(photo.id)}
                  style={styles.stripItem}
                >
                  <Image source={{ uri: photo.localUri }} style={styles.thumb} />
                  <ThemedText variant="meta" numberOfLines={1} style={styles.stripLabel}>
                    {photo.fileName ?? copy.photos.noFileName}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {pickNotice ? <Notice tone="caution" message={pickNotice} testID="photos-pick-notice" /> : null}
      {pickError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(pickError).message}
          testID="photos-pick-error"
        />
      ) : null}
      {anyUploads && failed.length === 0 && !working ? (
        <Notice
          tone="positive"
          title={copy.photos.doneBannerTitle}
          message={copy.photos.matchedCount(doneCount)}
          testID="photos-done"
        />
      ) : null}

      {working ? (
        <View style={styles.progressWrap} accessibilityRole="progressbar">
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <ThemedText variant="meta" style={styles.progressText}>
            {copy.photos.uploading(doneCount, doneCount + uploadTargets.length)}
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <CapsuleButton
          title={copy.photos.add}
          icon="add"
          variant="secondary"
          onPress={() => void pick()}
          disabled={working}
          testID="photos-pick"
        />
        {failed.length > 0 && !working ? (
          <CapsuleButton
            title={copy.photos.retryFailedCount(failed.length)}
            icon="history"
            onPress={() => void uploadAll(failed)}
            testID="photos-retry"
          />
        ) : null}
        {matches.length > 0 && !working && failed.length === 0 ? (
          <CapsuleButton
            title={copy.photos.uploadCount(uploadTargets.length)}
            icon="check"
            onPress={() => void uploadAll(uploadTargets)}
            disabled={uploadTargets.length === 0}
            testID="photos-upload"
          />
        ) : null}
        {photos.length > 0 && !working ? (
          <CapsuleButton
            title={copy.photos.clearAll}
            icon="trash"
            variant="secondary"
            onPress={resetBatch}
            testID="photos-clear"
          />
        ) : null}
      </View>

      {sectionSheet}
      <ChoiceSheet
        visible={rowSheet !== null}
        title={copy.photos.rowActions}
        options={rowOptions}
        currentId=""
        onSelect={onRowAction}
        onDismiss={() => setRowSheet(null)}
        testIDPrefix="photos-row-action"
      />
      <ChoiceSheet
        visible={photoSheet !== null}
        title={copy.photos.photoActions}
        options={[{ id: "remove", label: copy.photos.removePhoto }]}
        currentId=""
        onSelect={() => {
          if (photoSheet) removePhoto(photoSheet);
          setPhotoSheet(null);
        }}
        onDismiss={() => setPhotoSheet(null)}
        testIDPrefix="photos-photo-action"
      />
    </View>,
  );
}

function SectionPickerRow({
  label,
  onPress,
}: {
  label: string | null;
  onPress: () => void;
}) {
  return (
    <Card padless>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.photos.sectionLabel}, ${label ?? ""}`}
        accessibilityHint={copy.photos.pickSection}
        onPress={onPress}
        style={({ pressed }) => [styles.sectionRow, pressed ? styles.pressed : null]}
        testID="photos-section-picker"
      >
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {`${copy.photos.sectionLabel}: ${label ?? copy.photos.pickSection}`}
        </ThemedText>
        <AppIcon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  skeleton: { gap: spacing.md },
  sectionRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.field },
  rosterRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  skippedRow: { opacity: 0.55 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: colors.field },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: spacing.xxs },
  failReason: { color: colors.tone.critical.fg },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stripItem: { width: 96, gap: spacing.xxs },
  stripLabel: { fontSize: 10 },
  progressWrap: { gap: spacing.xs },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.tone.positive.fg },
  progressText: { textAlign: "center" },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
});
