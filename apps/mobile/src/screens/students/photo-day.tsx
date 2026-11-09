import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { FaceCard } from "./face-card";
import { photoDayQueue, type RosterEntry } from "./photo-matching";
import { useSectionRoster, useUploadQueue, type UploadStatus } from "./use-photo-workbench";

type Shot = { uri: string; width: number; height: number };

/**
 * Photo day (revamp 2026-11-09, prototype B). The screen walks the section
 * in roll order: it names who is next, the phone's camera takes the picture
 * (its own ✓ / retake is the review), and the screen moves to the next
 * student with the last shot kept small beside a Retake. Every photo belongs
 * to a student the moment it is taken, so nothing is matched afterwards;
 * each uploads in the background while the next is taken.
 *
 * Uses the system camera through expo-image-picker (no new native module).
 * `?studentId=` retakes one student and comes back.
 */
export function PhotoDayScreen() {
  const { sectionId, studentId } = useLocalSearchParams<{ sectionId?: string; studentId?: string }>();
  const { has } = usePermissions();
  const canWrite = has("student:update") && has("student:read");
  const utils = trpc.useUtils();
  const section = useSectionRoster(sectionId, canWrite);

  const [includeHas, setIncludeHas] = useState(false);
  const [queueIds, setQueueIds] = useState<string[] | null>(null);
  const [at, setAt] = useState(0);
  const [finished, setFinished] = useState(false);
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [lastId, setLastId] = useState<string | null>(null);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const uploads = useUploadQueue(() => {
    void utils.student.photoCoverage.invalidate();
    void utils.student.photo.invalidate();
  });

  const hasPhoto = useMemo(() => new Set(section.currentPhoto.keys()), [section.currentPhoto]);
  const byId = useMemo(
    () => new Map(section.entries.map((entry) => [entry.studentId, entry])),
    [section.entries],
  );
  const planned: RosterEntry[] = useMemo(() => {
    if (studentId) return section.entries.filter((entry) => entry.studentId === studentId);
    return photoDayQueue(section.entries, includeHas ? new Set() : hasPhoto);
  }, [studentId, section.entries, includeHas, hasPhoto]);

  // The queue is fixed when the walk starts: uploads landing mid-walk must
  // not reshuffle who is next.
  const queue = useMemo(
    () => (queueIds ?? []).flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
    [queueIds, byId],
  );
  const current = queue[at] ?? null;
  const after = useCallback(
    (list: RosterEntry[], index: number, skip: ReadonlySet<string>) => {
      let next = index + 1;
      while (list[next] && skip.has(list[next]!.studentId)) next += 1;
      return next;
    },
    [],
  );
  const upNext = current ? queue[after(queue, at, absent)] ?? null : null;

  /** Opens the camera for one student; on ✓ the photo uploads and, if asked, the walk moves on. */
  const shoot = useCallback(
    async (entry: RosterEntry, list: RosterEntry[], advance: boolean) => {
      setError(null);
      try {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError(copy.photoFlow.dayCameraDenied);
          return;
        }
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
        const asset = result.canceled ? null : result.assets[0];
        if (!asset) return;
        const shot = { uri: asset.uri, width: asset.width, height: asset.height };
        setShots((all) => ({ ...all, [entry.studentId]: shot }));
        setLastId(entry.studentId);
        uploads.add([{ studentId: entry.studentId, ...shot }]);
        if (advance) {
          const next = after(list, list.indexOf(entry), absent);
          if (list[next]) setAt(next);
          else setFinished(true);
        }
      } catch (cause) {
        setError(toFriendlyError(cause).message);
      }
    },
    [uploads, absent, after],
  );

  const markAbsent = (entry: RosterEntry) => {
    const nextAbsent = new Set(absent).add(entry.studentId);
    setAbsent(nextAbsent);
    const next = after(queue, queue.indexOf(entry), nextAbsent);
    if (queue[next]) setAt(next);
    else setFinished(true);
  };

  // ── Frame ────────────────────────────────────────────────────────────
  const frame = (body: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={copy.photoFlow.dayTitle}
      meta={[
        section.label,
        queue.length > 0 && !finished
          ? copy.photoFlow.dayProgress(Math.min(at + 1, queue.length), queue.length)
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      backAccessibilityLabel={copy.common.back}
      titleTestID="photo-day-title"
      footer={footer}
      footerVariant="floating"
    >
      {body}
    </ScreenFrame>
  );

  if (!canWrite) {
    return frame(
      <EmptyState icon="shield" title={copy.photos.deniedTitle} message={copy.photos.deniedBody} testID="photo-day-denied" />,
    );
  }
  if (section.query.isPending) return frame(<Skeleton height={320} />);
  if (section.query.isError) {
    return frame(
      <ErrorCard cause={section.query.error} onRetry={() => void section.query.refetch()} testID="photo-day-error" />,
    );
  }

  const errorNotice = error ? <Notice tone="critical" message={error} testID="photo-day-camera-error" /> : null;
  const firstName = (entry: RosterEntry) => entry.name.split(" ")[0] ?? entry.name;
  const includeSwitch =
    hasPhoto.size > 0 && !studentId ? (
      <SwitchRow
        label={copy.photoFlow.dayIncludeHas}
        value={includeHas}
        onChange={setIncludeHas}
        testID="photo-day-include-has"
      />
    ) : null;

  // ── Before the walk: who's first ─────────────────────────────────────
  if (queueIds === null) {
    const first = planned[0];
    if (!first) {
      return frame(
        <View style={styles.body}>
          <EmptyState
            icon="checkCircle"
            title={copy.photoFlow.dayEmptyTitle}
            message={copy.photoFlow.dayEmptyBody}
            testID="photo-day-empty"
          />
          {includeSwitch}
        </View>,
      );
    }
    return frame(
      <View style={styles.body}>
        <WhoCard entry={first} hasPhoto={hasPhoto.has(first.studentId)} />
        <ThemedText variant="meta">{copy.photoFlow.dayIntro}</ThemedText>
        {includeSwitch}
        {errorNotice}
      </View>,
      <CapsuleButton
        title={copy.photoFlow.dayStart(firstName(first))}
        icon="camera"
        onPress={() => {
          setQueueIds(planned.map((entry) => entry.studentId));
          setAt(0);
          void shoot(first, planned, true);
        }}
        style={styles.wide}
        testID="photo-day-start"
      />,
    );
  }

  // ── The walk: last shot small, who's next big ────────────────────────
  if (!finished && current) {
    const last = lastId ? byId.get(lastId) : undefined;
    const lastShot = lastId ? shots[lastId] : undefined;
    return frame(
      <View style={styles.body}>
        {last && lastShot ? (
          <LastShot
            entry={last}
            uri={lastShot.uri}
            status={uploads.statuses[last.studentId]}
            onRetake={() => void shoot(last, queue, false)}
          />
        ) : null}
        <WhoCard entry={current} hasPhoto={hasPhoto.has(current.studentId)} />
        {upNext ? (
          <ThemedText variant="meta" style={styles.upNext}>
            {`${copy.photoFlow.dayUpNext}: ${upNext.rollNumber ? `${upNext.rollNumber} · ` : ""}${upNext.name}`}
          </ThemedText>
        ) : null}
        {errorNotice}
        <View style={styles.row}>
          <CapsuleButton
            title={copy.photoFlow.dayAbsent}
            icon="calendarOff"
            variant="secondary"
            size="compact"
            onPress={() => markAbsent(current)}
            testID="photo-day-absent"
          />
          <CapsuleButton
            title={copy.photoFlow.dayFinish}
            variant="secondary"
            size="compact"
            onPress={() => setFinished(true)}
            testID="photo-day-finish"
          />
        </View>
      </View>,
      <CapsuleButton
        title={copy.photoFlow.dayTakeOf(firstName(current))}
        icon="camera"
        onPress={() => void shoot(current, queue, true)}
        style={styles.wide}
        testID="photo-day-take"
      />,
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const taken = queue.filter((entry) => shots[entry.studentId]);
  const absentList = queue.filter((entry) => absent.has(entry.studentId));
  const busy = uploads.counts.busy > 0;
  const firstAbsent = absentList[0];
  const left = queue.filter((entry) => !shots[entry.studentId] && !absent.has(entry.studentId));
  const firstLeft = left[0];
  return frame(
    <View style={styles.body}>
      <Notice
        tone={uploads.counts.failed > 0 ? "critical" : "positive"}
        title={firstLeft ? copy.photoFlow.dayPaused(left.length) : copy.photoFlow.dayAllDone}
        message={
          uploads.counts.failed > 0
            ? copy.photoFlow.failedBanner(uploads.counts.failed)
            : busy
              ? copy.photoFlow.uploading(uploads.counts.done, uploads.counts.total)
              : copy.photoFlow.daySummary(taken.length, absentList.length)
        }
        testID="photo-day-summary"
      />
      {firstLeft ? (
        <CapsuleButton
          title={copy.photoFlow.dayCarryOn(firstName(firstLeft))}
          icon="camera"
          onPress={() => {
            setAt(queue.indexOf(firstLeft));
            setFinished(false);
          }}
          style={styles.wide}
          testID="photo-day-carry-on"
        />
      ) : null}
      {uploads.counts.failed > 0 && !busy ? (
        <CapsuleButton title={copy.photoFlow.retry} icon="refresh" variant="secondary" onPress={uploads.retryFailed} testID="photo-day-retry" />
      ) : null}
      {firstAbsent ? (
        <CapsuleButton
          title={copy.photoFlow.dayTakeNow(firstName(firstAbsent))}
          icon="camera"
          variant="secondary"
          onPress={() => {
            const nextAbsent = new Set(absent);
            nextAbsent.delete(firstAbsent.studentId);
            setAbsent(nextAbsent);
            void shoot(firstAbsent, queue, false);
          }}
          testID="photo-day-take-absent"
        />
      ) : null}
      <View style={styles.grid}>
        {chunk(queue, 3).map((row, index) => (
          <View key={index} style={styles.gridRow}>
            {row.map((entry) => {
              const shot = shots[entry.studentId];
              const status = uploads.statuses[entry.studentId];
              return (
                <FaceCard
                  key={entry.studentId}
                  name={entry.name}
                  roll={entry.rollNumber}
                  sub={
                    status?.state === "failed"
                      ? status.reason
                      : status?.state === "done"
                        ? copy.photoFlow.subSaved
                        : status
                          ? copy.photoFlow.subUploading
                          : absent.has(entry.studentId)
                            ? copy.photoFlow.subAbsent
                            : copy.photoFlow.dayNotYet
                  }
                  uri={shot?.uri ?? null}
                  empty={!shot}
                  emptyIcon="camera"
                  status={status}
                  onPress={busy ? undefined : () => void shoot(entry, queue, false)}
                  accessibilityLabel={`${entry.name}, ${entry.rollNumber ? `roll ${entry.rollNumber}` : copy.photoFlow.noRoll}`}
                  testID={`photo-day-card-${entry.studentId}`}
                />
              );
            })}
            {row.length < 3
              ? Array.from({ length: 3 - row.length }, (_, pad) => <View key={`pad-${pad}`} style={styles.grow} />)
              : null}
          </View>
        ))}
      </View>
    </View>,
    <CapsuleButton
      title={copy.photoFlow.dayDone}
      variant={busy ? "secondary" : "primary"}
      disabled={busy}
      onPress={() => router.back()}
      style={styles.wide}
      testID="photo-day-done"
    />,
  );
}

function WhoCard({ entry, hasPhoto }: { entry: RosterEntry; hasPhoto: boolean }) {
  return (
    <View style={styles.who} testID="photo-day-who">
      <View style={styles.rollBox}>
        {entry.rollNumber ? (
          <>
            <ThemedText variant="meta" style={styles.rollLabel}>
              {copy.photoFlow.dayRoll}
            </ThemedText>
            <ThemedText variant="title" style={styles.rollNumber}>
              {entry.rollNumber}
            </ThemedText>
          </>
        ) : (
          <ThemedText
            variant="title"
            style={styles.rollNumber}
            accessibilityLabel={copy.photoFlow.noRoll}
          >
            {initials(entry.name)}
          </ThemedText>
        )}
      </View>
      <View style={styles.grow}>
        <ThemedText variant="subtitle" numberOfLines={2} style={styles.whoName}>
          {entry.name}
        </ThemedText>
        <ThemedText variant="meta" style={styles.whoMeta}>
          {`${entry.admissionNumber} · ${hasPhoto ? copy.photoFlow.dayHasPhoto : copy.photoFlow.dayNoPhotoYet}`}
        </ThemedText>
      </View>
    </View>
  );
}

function LastShot({
  entry,
  uri,
  status,
  onRetake,
}: {
  entry: RosterEntry;
  uri: string;
  status?: UploadStatus;
  onRetake: () => void;
}) {
  const label =
    status?.state === "failed"
      ? status.reason
      : status?.state === "done"
        ? copy.photoFlow.subSaved
        : copy.photoFlow.subUploading;
  return (
    <View style={styles.last} testID="photo-day-last">
      <Image source={{ uri }} recyclingKey={uri} style={styles.lastPhoto} contentFit="cover" />
      <View style={styles.grow}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {entry.name}
        </ThemedText>
        <View style={styles.lastState}>
          <AppIcon
            name={status?.state === "failed" ? "warning" : status?.state === "done" ? "checkCircle" : "clock"}
            size={14}
            color={status?.state === "failed" ? colors.tone.critical.fg : colors.accentDeep}
          />
          <ThemedText variant="meta" numberOfLines={1} style={styles.grow}>
            {label}
          </ThemedText>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.photoFlow.dayRetake}, ${entry.name}`}
        onPress={onRetake}
        hitSlop={8}
        style={({ pressed }) => [styles.retake, pressed ? styles.pressed : null]}
        testID="photo-day-retake"
      >
        <AppIcon name="refresh" size={16} color={colors.ink} />
        <ThemedText variant="bodyStrong">{copy.photoFlow.dayRetake}</ThemedText>
      </Pressable>
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(/s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  wide: { alignSelf: "stretch" },
  row: { flexDirection: "row", gap: spacing.sm },
  who: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
    minHeight: 140,
  },
  rollBox: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  rollLabel: { fontSize: 10, letterSpacing: 0.5 },
  rollNumber: { fontSize: 30, lineHeight: 34 },
  whoName: { color: "#fff", fontSize: 22, lineHeight: 28 },
  whoMeta: { color: "rgba(255,255,255,0.7)" },
  upNext: { paddingHorizontal: spacing.xs },
  last: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  lastPhoto: { width: 48, height: 64, borderRadius: radius.sm, backgroundColor: colors.field },
  lastState: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  retake: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.field,
  },
  pressed: { opacity: 0.7 },
  grid: { gap: spacing.md },
  gridRow: { flexDirection: "row", gap: spacing.sm + 2 },
});
