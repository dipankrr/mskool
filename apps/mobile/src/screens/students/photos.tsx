import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  fitsWireLimit,
  matchByAdmission,
  matchByOrder,
  resizePlan,
  rosterInMarkingOrder,
  type PickedPhoto,
  type RosterEntry,
} from "./photo-matching";

type EnrollmentRow = inferRouterOutputs<AppRouter>["enrollment"]["list"][number];
type PhotoStatus = "uploading" | "done" | "failed";

/**
 * The photo workbench (Step 2 photo slice). One section's photos in one pass:
 * pick from the gallery, the app matches photos to the roster — by capture
 * order in roll order (SECTION, the photographer's folder walk) or by file
 * name → admission number (REGISTER) — the grid shows every match before
 * anything uploads, and the uploads go sequentially through the ordinary
 * `student.uploadPhoto` with per-student results and retry-failed-only.
 *
 * No zip on the phone: multi-select replaces the desktop's folder drop, which
 * is recorded in the slice plan. Clearing a row returns its photo to the
 * unmatched strip rather than letting a wrong match ride. Every gate is a
 * permission string; the server re-checks each upload.
 */
export function StudentPhotosScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canWrite = has("student:update");
  const canReadRoster = has("enrollment:read") && has("student:read");

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: ready && Boolean(organizationId) && canWrite },
  );
  const sections = trpc.academic.section.list.useQuery(
    { organizationId: organizationId ?? "", academicYearId: academicYear?.id ?? "" },
    {
      enabled:
        ready && Boolean(organizationId) && canWrite && Boolean(academicYear?.id),
    },
  );

  const roster = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      sectionId: sectionId ?? "",
    },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        canWrite &&
        canReadRoster &&
        Boolean(academicYear?.id) &&
        Boolean(sectionId),
    },
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<"section" | "register">("section");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, PhotoStatus>>({});
  const [pickError, setPickError] = useState<unknown>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [working, setWorking] = useState(false);

  const resetForSection = () => {
    setPhotos([]);
    setStatuses({});
    setCleared(new Set());
  };

  const rosterEntries: RosterEntry[] = useMemo(() => {
    const seen = new Set<string>();
    return (roster.data ?? [])
      .filter((row: EnrollmentRow) => {
        if (seen.has(row.student.id)) return false;
        seen.add(row.student.id);
        return true;
      })
      .map((row: EnrollmentRow) => ({
        studentId: row.student.id,
        admissionNumber: row.student.admissionNumber,
        name: [row.student.firstName, row.student.lastName]
          .filter(Boolean)
          .join(" "),
        rollNumber: row.enrollment.rollNumber ?? null,
      }));
  }, [roster.data]);

  const className = (id: string | null) =>
    id
      ? (classes.data ?? []).find((candidate) => candidate.id === id)?.name ?? null
      : null;
  const sectionLabel = (id: string | null) => {
    if (!id) return null;
    const section = (sections.data ?? []).find((row) => row.id === id);
    if (!section) return null;
    return `${className(section.classId) ?? ""} · ${section.name}`.replace(
      /^ · /,
      "",
    );
  };

  const baseMatches = useMemo(() => {
    if (photos.length === 0) return { matches: [], unmatched: [] };
    return mode === "register"
      ? matchByAdmission(photos, rosterEntries)
      : matchByOrder(photos, rosterEntries);
  }, [photos, mode, rosterEntries]);

  const matches = baseMatches.matches.filter(
    (match) => !cleared.has(match.studentId),
  );
  const clearedPhotos = baseMatches.matches
    .filter((match) => cleared.has(match.studentId))
    .map((match) => match.photo);
  const unmatched = [...baseMatches.unmatched, ...clearedPhotos];

  const rosterOrdered = rosterInMarkingOrder(rosterEntries);
  const byStudent = new Map(matches.map((match) => [match.studentId, match.photo]));

  const pick = useCallback(async () => {
    setPickError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 80,
        orderedSelection: true,
        quality: 1,
        exif: true,
      });
      if (result.canceled) return;
      setPhotos(
        result.assets.map((asset) => ({
          localUri: asset.uri,
          fileName: asset.fileName ?? null,
          // This SDK does not expose capture time on the asset: SECTION mode's
          // order is the picker's ordered selection (documented in the copy).
          creationTime: null,
          width: asset.width,
          height: asset.height,
        })),
      );
      setStatuses({});
      setCleared(new Set());
    } catch (error) {
      setPickError(error);
    }
  }, []);

  const utils = trpc.useUtils();
  const upload = trpc.student.uploadPhoto.useMutation();

  const toWireBase64 = async (photo: PickedPhoto): Promise<string | null> => {
    for (let attempt = 0; ; attempt += 1) {
      const plan = resizePlan(attempt);
      if (!plan) return null;
      const resize =
        photo.height >= photo.width
          ? { height: plan.maxEdge }
          : { width: plan.maxEdge };
      const rendered = await ImageManipulator.manipulate(photo.localUri)
        .resize(resize)
        .renderAsync();
      const saved = await rendered.saveAsync({
        compress: plan.quality,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (saved.base64 && fitsWireLimit(saved.base64)) return saved.base64;
    }
  };

  const uploadTargets = matches.filter(
    (match) => statuses[match.studentId] !== "done",
  );
  const failed = matches.filter(
    (match) => statuses[match.studentId] === "failed",
  );
  const doneCount = matches.filter(
    (match) => statuses[match.studentId] === "done",
  ).length;

  const uploadAll = useCallback(
    async (targets: typeof matches) => {
      if (!organizationId) return;
      setUploadError(null);
      setWorking(true);
      try {
        for (const target of targets) {
          setStatuses((current) => ({
            ...current,
            [target.studentId]: "uploading",
          }));
          try {
            const base64 = await toWireBase64(target.photo);
            if (!base64) {
              setStatuses((current) => ({
                ...current,
                [target.studentId]: "failed",
              }));
              continue;
            }
            await upload.mutateAsync({
              organizationId,
              id: target.studentId,
              data: { contentType: "image/jpeg", dataBase64: base64 },
            });
            await utils.student.byId.invalidate({ id: target.studentId });
            setStatuses((current) => ({
              ...current,
              [target.studentId]: "done",
            }));
          } catch {
            setStatuses((current) => ({
              ...current,
              [target.studentId]: "failed",
            }));
          }
        }
      } finally {
        setWorking(false);
      }
    },
    // toWireBase64 is a pure ladder over its argument; upload/utils are stable.
    [organizationId, upload, utils],
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

  if (!ready || !organizationId) {
    return frame(<Skeleton height={220} />);
  }

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
        <SectionLabel>{copy.photos.sectionLabel}</SectionLabel>
        <Card padless>
          {(sections.data ?? []).map((section, index) => (
            <Pressable
              key={section.id}
              accessibilityRole="button"
              accessibilityLabel={sectionLabel(section.id) ?? section.name}
              onPress={() => {
                resetForSection();
                router.setParams({ sectionId: section.id });
              }}
              style={({ pressed }) => [
                styles.sectionRow,
                pressed ? styles.sectionPressed : null,
              ]}
              testID={`photos-section-${section.id}`}
            >
              <ThemedText variant="bodyStrong" numberOfLines={1}>
                {sectionLabel(section.id) ?? section.name}
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
        <SectionPickerRow label={sectionLabel(sectionId)} onPress={() => setPickerOpen(true)} />
        <EmptyState
          icon="students"
          title={copy.photos.rosterEmptyTitle}
          message={copy.photos.rosterEmptyBody}
          testID="photos-empty"
        />
        <ChoiceSheet
          visible={pickerOpen}
          title={copy.photos.pickSection}
          options={(sections.data ?? []).map((section) => ({
            id: section.id,
            label: sectionLabel(section.id) ?? section.name,
          }))}
          currentId={sectionId ?? ""}
          onSelect={(id) => {
            setPickerOpen(false);
            if (id && id !== sectionId) {
              resetForSection();
              router.setParams({ sectionId: id });
            }
          }}
          onDismiss={() => setPickerOpen(false)}
          testIDPrefix="photos-section-option"
        />
      </View>,
    );
  }

  const anyUploads = Object.keys(statuses).length > 0;

  return frame(
    <View style={styles.body}>
      <SectionPickerRow label={sectionLabel(sectionId)} onPress={() => setPickerOpen(true)} />

      <SectionLabel>{copy.photos.matchedCount(matches.length)}</SectionLabel>
      <Card padless>
        <View style={styles.modeWrap}>
          <ChoicePills
            label={copy.photos.modeLabel}
            value={mode}
            options={[
              { value: "section" as const, label: copy.photos.modes.section },
              { value: "register" as const, label: copy.photos.modes.register },
            ]}
            onChange={setMode}
            help={
              mode === "section"
                ? copy.photos.modeSectionHelp
                : copy.photos.modeRegisterHelp
            }
            testIDPrefix="photos-mode"
          />
        </View>

        {rosterOrdered.map((entry) => {
          const photo = byStudent.get(entry.studentId);
          const status = statuses[entry.studentId];
          return (
            <Pressable
              key={entry.studentId}
              accessibilityRole={photo && !working ? "button" : undefined}
              accessibilityLabel={`${entry.name}${
                photo ? `, photo matched` : ", no photo"
              }${entry.rollNumber ? `, Roll ${entry.rollNumber}` : ""}`}
              accessibilityHint={photo && !working ? copy.photos.clearRow : undefined}
              onPress={
                photo && !working
                  ? () =>
                      setCleared((current) =>
                        new Set(current).add(entry.studentId),
                      )
                  : undefined
              }
              style={({ pressed }) => [
                styles.rosterRow,
                pressed && photo && !working ? styles.sectionPressed : null,
              ]}
              testID={`photos-row-${entry.studentId}`}
            >
              {photo ? (
                <Image
                  source={{ uri: photo.localUri }}
                  style={styles.thumb}
                  testID={`photos-thumb-${entry.studentId}`}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <AppIcon name="person" size={20} color={colors.muted} />
                </View>
              )}
              <View style={styles.rowText}>
                <ThemedText variant="name" numberOfLines={1}>
                  {entry.name}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={1}>
                  {`Adm ${entry.admissionNumber}${
                    entry.rollNumber ? ` · Roll ${entry.rollNumber}` : ""
                  }`}
                </ThemedText>
              </View>
              {photo && !working ? (
                <AppIcon name="closeCircle" size={20} color={colors.muted} />
              ) : null}
              {status ? (
                <StatusPill
                  label={
                    status === "done"
                      ? copy.photos.done
                      : status === "failed"
                        ? copy.photos.failed
                        : copy.photos.uploadingState
                  }
                  tone={status === "done" ? "positive" : "neutral"}
                  testID={`photos-status-${entry.studentId}`}
                />
              ) : null}
            </Pressable>
          );
        })}
      </Card>

      {unmatched.length > 0 ? (
        <>
          <SectionLabel>{copy.photos.unmatchedLabel(unmatched.length)}</SectionLabel>
          <Card>
            <ThemedText variant="meta">{copy.photos.unmatchedHelp}</ThemedText>
            <View style={styles.strip}>
              {unmatched.map((photo, index) => (
                <View key={`${photo.localUri}-${index}`} style={styles.stripItem}>
                  <Image source={{ uri: photo.localUri }} style={styles.thumb} />
                  <ThemedText
                    variant="meta"
                    numberOfLines={1}
                    style={styles.stripLabel}
                  >
                    {photo.fileName ?? copy.photos.noFileName}
                  </ThemedText>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {pickError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(pickError).message}
          testID="photos-pick-error"
        />
      ) : null}
      {uploadError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(uploadError).message}
          testID="photos-upload-error"
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
        {working ? (
          <ThemedText variant="meta" style={styles.progress}>
            {copy.photos.uploading(doneCount, matches.length)} —{" "}
            {copy.photos.uploadingState}
          </ThemedText>
        ) : null}
      </View>

      <ChoiceSheet
        visible={pickerOpen}
        title={copy.photos.pickSection}
        options={(sections.data ?? []).map((section) => ({
          id: section.id,
          label: sectionLabel(section.id) ?? section.name,
        }))}
        currentId={sectionId ?? ""}
        onSelect={(id) => {
          setPickerOpen(false);
          if (id && id !== sectionId) {
            resetForSection();
            router.setParams({ sectionId: id });
          }
        }}
        onDismiss={() => setPickerOpen(false)}
        testIDPrefix="photos-section-option"
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
        style={({ pressed }) => [
          styles.sectionRow,
          pressed ? styles.sectionPressed : null,
        ]}
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
  body: {
    gap: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
  },
  modeWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  sectionRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sectionPressed: {
    backgroundColor: colors.field,
  },
  rosterRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.field,
  },
  thumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stripItem: {
    width: 96,
    gap: spacing.xxs,
  },
  stripLabel: {
    fontSize: 10,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  progress: {
    textAlign: "center",
  },
});
