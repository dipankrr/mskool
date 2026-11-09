import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useNavigation } from "expo-router";
import { Image } from "expo-image";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import * as ImagePicker from "expo-image-picker";

import { AppIcon, type AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SegmentBar } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { FaceCard } from "./face-card";
import {
  admissionsToLookUp,
  captureTimeFromExif,
  matchByAdmission,
  matchByOrder,
  mergePhotos,
  sortPhotos,
  swapPhotos,
  type PhotoOrder,
  type PickedPhoto,
} from "./photo-matching";
import { useSectionRoster, useUploadQueue } from "./use-photo-workbench";

type RegisterRow = inferRouterOutputs<AppRouter>["student"]["byAdmissions"][number];
type Filter = "all" | "missing" | "has" | "extra";

/** A batch this size still renders as one grid on a cheap phone. */
const MAX_PHOTOS = 150;

type Card = {
  key: string;
  studentId: string | null;
  name: string;
  roll: string | null;
  photo: PickedPhoto | null;
  currentUri: string | null;
  skipped: boolean;
  absent: boolean;
};

/**
 * The photo grid (revamp 2026-11-09, prototype A2–A6). Faces are the main
 * thing: three across, roll number on the corner, the one next action in a
 * sticky bar. In a section, the batch's order is the assignment (as on the
 * web) — fix it by tapping two photos to swap them, or from a card's sheet
 * (absent, not a student's photo, retake now). Settings live in a sheet.
 * Photos named with admission numbers match across the whole school
 * (`student.byAdmissions`).
 *
 * Who already has a photo is read once per batch and then held, so uploads
 * landing mid-batch never shift the matches under the person checking them.
 */
export function PhotoWorkbenchScreen({
  sectionId,
  register,
}: {
  sectionId?: string;
  register: boolean;
}) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const navigation = useNavigation();

  const section = useSectionRoster(sectionId, !register);
  const [heldHasPhoto, setHeldHasPhoto] = useState<Set<string> | null>(null);
  if (!register && heldHasPhoto === null && section.query.isSuccess && !section.query.hasNextPage) {
    setHeldHasPhoto(new Set(section.currentPhoto.keys()));
  }
  const hasPhoto = useMemo(() => heldHasPhoto ?? new Set<string>(), [heldHasPhoto]);

  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [order, setOrder] = useState<PhotoOrder | "custom">("taken");
  const [skipHasPhoto, setSkipHasPhoto] = useState(true);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickError, setPickError] = useState<unknown>(null);

  const queue = useUploadQueue(() => {
    void utils.student.photoCoverage.invalidate();
  });
  const uploading = queue.counts.busy > 0;

  // REGISTER: the school's students for the batch's file names.
  const lookup = trpc.student.byAdmissions.useMutation();
  const [registerRows, setRegisterRows] = useState<RegisterRow[]>([]);
  const admissionsKey = useMemo(() => admissionsToLookUp(photos).join("|"), [photos]);
  useEffect(() => {
    if (!register || !organizationId || !academicYear?.id || !admissionsKey) return;
    let live = true;
    lookup
      .mutateAsync({
        organizationId,
        schoolId: schoolId ?? undefined,
        academicYearId: academicYear.id,
        admissions: admissionsKey.split("|"),
      })
      .then((rows) => live && setRegisterRows(rows))
      .catch(() => live && setRegisterRows([]));
    return () => {
      live = false;
    };
    // `lookup` is stable; re-run only when the names or the context change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, admissionsKey, organizationId, schoolId, academicYear?.id]);

  const skipped = useMemo(() => {
    const out = new Set(absent);
    if (skipHasPhoto) for (const id of hasPhoto) out.add(id);
    return out;
  }, [absent, skipHasPhoto, hasPhoto]);

  const { matches, unmatched } = useMemo(() => {
    if (photos.length === 0) return { matches: [], unmatched: [] };
    if (register) {
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
    return matchByOrder(photos, section.entries, skipped);
  }, [photos, register, registerRows, section.entries, skipped]);

  const byStudent = useMemo(
    () => new Map(matches.map((match) => [match.studentId, match.photo])),
    [matches],
  );

  // ── Cards ────────────────────────────────────────────────────────────
  const cards: Card[] = useMemo(() => {
    const students: Card[] = register
      ? matches.map((match) => {
          const row = registerRows.find((candidate) => candidate.student.id === match.studentId);
          return {
            key: match.studentId,
            studentId: match.studentId,
            name: row ? `${row.student.firstName} ${row.student.lastName}` : "",
            roll: row?.rollNumber ?? null,
            photo: match.photo,
            currentUri: null,
            skipped: false,
            absent: false,
          };
        })
      : section.entries.map((entry) => ({
          key: entry.studentId,
          studentId: entry.studentId,
          name: entry.name,
          roll: entry.rollNumber,
          photo: byStudent.get(entry.studentId) ?? null,
          currentUri: section.currentPhoto.get(entry.studentId) ?? null,
          skipped: skipped.has(entry.studentId),
          absent: absent.has(entry.studentId),
        }));
    const extras: Card[] = unmatched.map((photo) => ({
      key: `extra-${photo.id}`,
      studentId: null,
      name: photo.fileName ?? copy.photoFlow.subExtra,
      roll: null,
      photo,
      currentUri: null,
      skipped: false,
      absent: false,
    }));
    return [...students, ...extras];
  }, [register, matches, registerRows, section.entries, section.currentPhoto, byStudent, skipped, absent, unmatched]);

  const counts = {
    all: cards.length,
    missing: cards.filter((card) => card.studentId && !card.photo && !card.currentUri).length,
    has: cards.filter((card) => card.studentId && hasPhoto.has(card.studentId)).length,
    extra: unmatched.length,
  };
  const shown = cards.filter((card) =>
    filter === "all"
      ? true
      : filter === "missing"
        ? card.studentId && !card.photo && !card.currentUri
        : filter === "has"
          ? card.studentId && hasPhoto.has(card.studentId)
          : !card.studentId,
  );

  const toUpload = matches.filter(
    (match) => queue.statuses[match.studentId]?.state !== "done",
  );

  // ── Picking ──────────────────────────────────────────────────────────
  const pick = useCallback(async () => {
    setPickError(null);
    setNotice(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setNotice(copy.photoFlow.tooMany(MAX_PHOTOS));
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
      const merged = mergePhotos(
        photos,
        result.assets.map((asset) => ({
          id: asset.assetId ?? asset.uri,
          localUri: asset.uri,
          fileName: asset.fileName ?? null,
          creationTime: captureTimeFromExif(asset.exif),
          width: asset.width,
          height: asset.height,
        })),
      );
      if (merged.added === 0) setNotice(copy.photoFlow.alreadyIn);
      setPhotos(
        (order === "custom" || register
          ? merged.photos
          : sortPhotos(merged.photos, order)
        ).slice(0, MAX_PHOTOS),
      );
    } catch (error) {
      setPickError(error);
    }
  }, [photos, order, register]);

  const clearAll = () => {
    setPhotos([]);
    setAbsent(new Set());
    setSwapFrom(null);
    setOrder("taken");
    queue.reset();
    setHeldHasPhoto(null);
    setRegisterRows([]);
    void section.query.refetch();
  };

  // ── Leaving with unsaved photos asks first ───────────────────────────
  const unsaved = toUpload.length > 0 || uploading;
  useEffect(() => {
    if (!unsaved) return;
    return navigation.addListener("beforeRemove", (event) => {
      event.preventDefault();
      Alert.alert(copy.photoFlow.leaveTitle, copy.photoFlow.leaveBody, [
        { text: copy.photoFlow.stay, style: "cancel" },
        {
          text: copy.photoFlow.leaveConfirm,
          style: "destructive",
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
  }, [navigation, unsaved]);

  // ── Tapping ──────────────────────────────────────────────────────────
  const onCardPress = (card: Card) => {
    if (uploading) return;
    if (register || !card.photo) {
      setSheetKey(card.key);
      return;
    }
    if (!swapFrom) {
      setSwapFrom(card.photo.id);
      return;
    }
    if (swapFrom !== card.photo.id) {
      setPhotos((current) => swapPhotos(current, swapFrom, card.photo!.id));
      setOrder("custom");
    }
    setSwapFrom(null);
  };

  const firstFailure = Object.values(queue.statuses).flatMap((status) =>
    status.state === "failed" ? [status.reason] : [],
  )[0];

  const sheetCard = cards.find((card) => card.key === sheetKey) ?? null;
  const swapName = swapFrom
    ? cards.find((card) => card.photo?.id === swapFrom)?.name ?? ""
    : "";

  const sub = (card: Card) => {
    const status = card.studentId ? queue.statuses[card.studentId] : undefined;
    if (status?.state === "done") return copy.photoFlow.subSaved;
    if (status?.state === "failed") return status.reason;
    if (status?.state === "uploading") return copy.photoFlow.subUploading;
    if (status?.state === "waiting") return copy.photoFlow.subWaiting;
    if (!card.studentId) return copy.photoFlow.subExtra;
    if (swapFrom && card.photo?.id === swapFrom) return copy.photoFlow.swapWith;
    if (card.absent) return copy.photoFlow.subAbsent;
    if (card.skipped) return `${copy.photoFlow.subHas} · ${copy.photoFlow.subSkipped.toLowerCase()}`;
    if (card.photo) return card.currentUri ? copy.photoFlow.subReplaces : copy.photoFlow.subNew;
    if (card.currentUri) return copy.photoFlow.subHas;
    return copy.photoFlow.subNone;
  };

  // ── Frame ────────────────────────────────────────────────────────────
  const title = register ? copy.photoFlow.registerTitle : section.label ?? copy.photos.title;
  const footer =
    photos.length === 0 ? null : (
      <View style={styles.footer}>
        {queue.counts.total > 0 && uploading ? (
          <View style={styles.track} accessibilityRole="progressbar">
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.round(
                    (queue.counts.done / Math.max(1, queue.counts.total)) * 100,
                  )}%`,
                },
              ]}
            />
          </View>
        ) : swapFrom ? null : (
          <ThemedText variant="meta" style={styles.hint}>
            {register ? copy.photoFlow.gridMeta(photos.length, matches.length) : copy.photoFlow.hint}
          </ThemedText>
        )}
        <View style={styles.footerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.photoFlow.addMore}
            onPress={() => void pick()}
            disabled={uploading}
            style={[styles.addButton, uploading ? styles.disabled : null]}
            testID="photos-add-more"
          >
            <AppIcon name="add" size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.grow}>
            {uploading ? (
              <CapsuleButton
                title={copy.photoFlow.uploading(queue.counts.done, queue.counts.total)}
                variant="secondary"
                disabled
                onPress={() => undefined}
                testID="photos-uploading"
              />
            ) : (
              <CapsuleButton
                title={copy.photoFlow.upload(toUpload.length)}
                icon="check"
                disabled={toUpload.length === 0}
                onPress={() =>
                  queue.add(
                    toUpload.map((match) => ({
                      studentId: match.studentId,
                      uri: match.photo.localUri,
                      width: match.photo.width,
                      height: match.photo.height,
                    })),
                  )
                }
                testID="photos-upload"
              />
            )}
          </View>
        </View>
      </View>
    );

  const frame = (body: React.ReactNode) => (
    <ScreenFrame
      title={title}
      meta={register ? copy.photoFlow.byNameBody : copy.photoFlow.gridMeta(photos.length, matches.length)}
      backAccessibilityLabel={copy.common.back}
      titleTestID="photos-grid-title"
      secondaryAction={
        register
          ? undefined
          : {
              label: copy.photoFlow.settings,
              icon: "settings",
              iconOnly: true,
              accessibilityHint: copy.photoFlow.settingsHint,
              onPress: () => setSettingsOpen(true),
              testID: "photos-settings",
            }
      }
      stickyHeader={
        photos.length > 0 && !register ? (
          <View style={styles.filters}>
            <SegmentBar<Filter>
              label={copy.photoFlow.settings}
              value={filter}
              onChange={setFilter}
              options={(["all", "missing", "has", "extra"] as const)
                .filter((key) => key === "all" || counts[key] > 0)
                .map((key) => ({
                  value: key,
                  label: `${copy.photoFlow.filters[key]} ${counts[key]}`,
                  testID: `photos-filter-${key}`,
                }))}
            />
          </View>
        ) : undefined
      }
      footer={footer}
      footerVariant="bar"
    >
      {body}
    </ScreenFrame>
  );

  if (!register && (section.query.isPending || heldHasPhoto === null) && !section.query.isError) {
    return frame(
      <View style={styles.body}>
        <Skeleton height={180} />
        <Skeleton height={180} />
      </View>,
    );
  }
  if (!register && section.query.isError) {
    return frame(
      <ErrorCard cause={section.query.error} onRetry={() => void section.query.refetch()} testID="photos-error" />,
    );
  }
  if (!register && section.entries.length === 0) {
    return frame(
      <EmptyState
        icon="students"
        title={copy.photos.rosterEmptyTitle}
        message={copy.photos.rosterEmptyBody}
        testID="photos-empty"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      {swapFrom ? (
        <View style={styles.toast} testID="photos-swapping">
          <AppIcon name="sort" size={18} color="#8FE3B5" />
          <ThemedText variant="meta" style={styles.toastText}>
            {copy.photoFlow.swapping(swapName)}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={() => setSwapFrom(null)} hitSlop={12}>
            <ThemedText variant="bodyStrong" style={styles.toastAction}>
              {copy.photoFlow.cancel}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {queue.counts.failed > 0 && !uploading ? (
        <View style={styles.failedWrap}>
          <Notice
            tone="critical"
            title={copy.photoFlow.failedBanner(queue.counts.failed)}
            message={firstFailure}
            testID="photos-failed"
          />
          <CapsuleButton
            title={copy.photoFlow.retry}
            icon="refresh"
            variant="secondary"
            onPress={queue.retryFailed}
            testID="photos-retry"
          />
        </View>
      ) : queue.counts.done > 0 && !uploading && toUpload.length === 0 ? (
        <Notice tone="positive" message={copy.photoFlow.savedBanner(queue.counts.done)} testID="photos-done" />
      ) : null}
      {register && lookup.isError ? (
        <Notice tone="critical" message={toFriendlyError(lookup.error).message} testID="photos-lookup-error" />
      ) : null}
      {notice ? <Notice tone="caution" message={notice} testID="photos-notice" /> : null}
      {pickError ? (
        <Notice tone="critical" message={toFriendlyError(pickError).message} testID="photos-pick-error" />
      ) : null}

      {photos.length === 0 ? (
        <View style={styles.emptyCard}>
          <EmptyState
            icon="camera"
            title={register ? copy.photoFlow.registerEmptyTitle : copy.photoFlow.emptyTitle}
            message={register ? copy.photoFlow.registerEmptyBody : copy.photoFlow.emptyBody}
            testID="photos-start-empty"
          />
          <CapsuleButton title={copy.photoFlow.choosePhotos} icon="add" onPress={() => void pick()} testID="photos-pick" />
          {!register && sectionId ? (
            <CapsuleButton
              title={copy.photoFlow.takePhotos}
              icon="camera"
              variant="secondary"
              onPress={() => router.push({ pathname: "/students/photo-day", params: { sectionId } })}
              testID="photos-take"
            />
          ) : null}
        </View>
      ) : null}

      {photos.length > 0 || !register ? (
        <View style={styles.grid}>
          {chunk(photos.length > 0 ? shown : cards, 3).map((row, index) => (
            <View key={index} style={styles.gridRow}>
              {row.map((card) => {
                const status = card.studentId ? queue.statuses[card.studentId] : undefined;
                return (
                  <FaceCard
                    key={card.key}
                    name={card.name}
                    roll={card.roll}
                    sub={sub(card)}
                    uri={card.photo?.localUri ?? card.currentUri}
                    empty={!card.photo && !card.currentUri}
                    faded={(card.skipped && !card.photo) || Boolean(swapFrom && !card.photo)}
                    selected={Boolean(swapFrom && card.photo?.id === swapFrom)}
                    status={status}
                    onPress={() => onCardPress(card)}
                    onLongPress={uploading ? undefined : () => setSheetKey(card.key)}
                    accessibilityLabel={`${card.name}${card.roll ? `, roll ${card.roll}` : ""}, ${sub(card)}`}
                    testID={`photos-card-${card.key}`}
                  />
                );
              })}
              {row.length < 3
                ? Array.from({ length: 3 - row.length }, (_, pad) => <View key={`pad-${pad}`} style={styles.grow} />)
                : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* One card's sheet */}
      <FormSheet visible={sheetCard !== null} title={sheetCard?.name ?? ""} onClose={() => setSheetKey(null)} footer={null} testIDPrefix="photos-card-sheet">
        {sheetCard ? (
          <View style={styles.sheetBody}>
            <View style={styles.sheetHead}>
              <View style={styles.bigPhoto}>
                {sheetCard.photo || sheetCard.currentUri ? (
                  <Image
                    source={{ uri: sheetCard.photo?.localUri ?? sheetCard.currentUri ?? undefined }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <AppIcon name="person" size={30} color={colors.chevron} />
                )}
              </View>
              <View style={styles.grow}>
                {sheetCard.roll ? (
                  <ThemedText variant="meta">{`Roll ${sheetCard.roll}`}</ThemedText>
                ) : null}
                {sheetCard.photo ? (
                  <ThemedText variant="meta" numberOfLines={2}>
                    {copy.photoFlow.cardFile(sheetCard.photo.fileName)}
                  </ThemedText>
                ) : null}
                <ThemedText variant="meta">{sub(sheetCard)}</ThemedText>
              </View>
            </View>
            {!register && sheetCard.studentId ? (
              sheetCard.absent ? (
                <SheetOption
                  icon="add"
                  title={copy.photoFlow.actUnabsent}
                  detail={copy.photoFlow.actUnabsentDetail}
                  onPress={() => {
                    const id = sheetCard.studentId!;
                    setAbsent((current) => {
                      const next = new Set(current);
                      next.delete(id);
                      return next;
                    });
                    setSheetKey(null);
                  }}
                  testID="photos-act-unabsent"
                />
              ) : !sheetCard.skipped ? (
                <SheetOption
                  icon="calendarOff"
                  title={copy.photoFlow.actAbsent}
                  detail={copy.photoFlow.actAbsentDetail}
                  onPress={() => {
                    const id = sheetCard.studentId!;
                    setAbsent((current) => new Set(current).add(id));
                    setSheetKey(null);
                  }}
                  testID="photos-act-absent"
                />
              ) : null
            ) : null}
            {sheetCard.photo ? (
              <SheetOption
                icon="trash"
                title={register ? copy.photoFlow.actRemoveRegister : copy.photoFlow.actRemove}
                detail={register ? "" : copy.photoFlow.actRemoveDetail}
                onPress={() => {
                  const id = sheetCard.photo!.id;
                  setPhotos((current) => current.filter((photo) => photo.id !== id));
                  setSheetKey(null);
                }}
                testID="photos-act-remove"
              />
            ) : null}
            {!register && sheetCard.studentId && sectionId ? (
              <SheetOption
                icon="camera"
                title={copy.photoFlow.actRetake}
                detail={copy.photoFlow.actRetakeDetail(sheetCard.name)}
                onPress={() => {
                  const studentId = sheetCard.studentId!;
                  setSheetKey(null);
                  router.push({ pathname: "/students/photo-day", params: { sectionId, studentId } });
                }}
                testID="photos-act-retake"
              />
            ) : null}
          </View>
        ) : null}
      </FormSheet>

      {/* Settings */}
      <FormSheet visible={settingsOpen} title={copy.photoFlow.settings} onClose={() => setSettingsOpen(false)} footer={null} testIDPrefix="photos-settings-sheet">
        <View style={styles.sheetBody}>
          <ThemedText variant="bodyStrong">{copy.photoFlow.goesBy}</ThemedText>
          <SegmentBar<"roll" | "file">
            label={copy.photoFlow.goesBy}
            value="roll"
            onChange={(value) => {
              if (value === "file") {
                setSettingsOpen(false);
                router.replace({ pathname: "/students/photos", params: { mode: "register" } });
              }
            }}
            options={[
              { value: "roll", label: copy.photoFlow.byRoll, testID: "photos-goes-by-roll" },
              { value: "file", label: copy.photoFlow.byFile, testID: "photos-goes-by-file" },
            ]}
          />
          <ThemedText variant="bodyStrong">{copy.photoFlow.order}</ThemedText>
          <SegmentBar<PhotoOrder>
            label={copy.photoFlow.order}
            value={(order === "custom" ? "" : order) as PhotoOrder}
            onChange={(value) => {
              setOrder(value);
              setPhotos((current) => sortPhotos(current, value));
            }}
            options={[
              { value: "taken", label: copy.photoFlow.orderTaken, testID: "photos-order-taken" },
              { value: "name", label: copy.photoFlow.orderName, testID: "photos-order-name" },
            ]}
          />
          {order === "custom" ? <ThemedText variant="meta">{copy.photoFlow.orderCustom}</ThemedText> : null}
          {hasPhoto.size > 0 ? (
            <SwitchRow
              label={copy.photoFlow.skipHas}
              help={copy.photoFlow.skipHasDetail(hasPhoto.size)}
              value={skipHasPhoto}
              onChange={setSkipHasPhoto}
              disabled={uploading}
              testID="photos-skip-has"
            />
          ) : null}
          {photos.length > 0 ? (
            <SheetOption
              icon="trash"
              title={copy.photoFlow.clearAll}
              detail={copy.photoFlow.clearAllDetail}
              onPress={() => {
                setSettingsOpen(false);
                clearAll();
              }}
              testID="photos-clear"
            />
          ) : null}
        </View>
      </FormSheet>
    </View>,
  );
}

function SheetOption({
  icon,
  title,
  detail,
  onPress,
  testID,
}: {
  icon: AppIconName;
  title: string;
  detail: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail || undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <View style={styles.optionIcon}>
        <AppIcon name={icon} size={18} color={colors.ink} />
      </View>
      <View style={styles.grow}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        {detail ? <ThemedText variant="meta">{detail}</ThemedText> : null}
      </View>
    </Pressable>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  grid: { gap: spacing.md },
  gridRow: { flexDirection: "row", gap: spacing.sm + 2 },
  emptyCard: { gap: spacing.sm },
  failedWrap: { gap: spacing.xs },
  footer: { gap: spacing.sm },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  hint: { textAlign: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.field, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.accent, borderRadius: 3 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toastText: { color: "#fff", flex: 1 },
  toastAction: { color: "#8FE3B5" },
  sheetBody: { gap: spacing.md },
  sheetHead: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  bigPhoto: {
    width: 84,
    height: 112,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56 },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
