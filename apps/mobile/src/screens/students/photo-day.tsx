import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
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
import { useSectionRoster, useUploadQueue } from "./use-photo-workbench";

type Shot = { uri: string; width: number; height: number };
type Stage = "intro" | "who" | "review" | "summary";

/** Seconds the review waits before the camera opens for the next student. */
const AUTO_NEXT = 2;

/**
 * Photo day (revamp 2026-11-09, prototype B). The camera walks the section
 * in roll order: the screen names who is next, the phone's camera takes the
 * picture, a short review offers Retake, then it moves on by itself. Every
 * photo belongs to a student the moment it is taken, so nothing is matched
 * afterwards; each uploads in the background while the next is taken.
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
  const [stage, setStage] = useState<Stage>("intro");
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [countdown, setCountdown] = useState(AUTO_NEXT);
  /** Bumps on every new shot, so a retake restarts the countdown. */
  const [shotCount, setShotCount] = useState(0);
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
  const next = queue.slice(at + 1).find((entry) => !absent.has(entry.studentId)) ?? null;

  const shoot = useCallback(async (entry: RosterEntry) => {
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError(copy.photoFlow.dayCameraDenied);
        setStage("who");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        cameraType: ImagePicker.CameraType.back,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) {
        setStage("who");
        return;
      }
      const shot = { uri: asset.uri, width: asset.width, height: asset.height };
      setShots((currentShots) => ({ ...currentShots, [entry.studentId]: shot }));
      uploads.add([{ studentId: entry.studentId, ...shot }]);
      setCountdown(AUTO_NEXT);
      setShotCount((count) => count + 1);
      setStage("review");
    } catch (cause) {
      setError(toFriendlyError(cause).message);
      setStage("who");
    }
  }, [uploads]);

  /** Opens the camera for the next student not absent; `alsoAbsent` is one just marked. */
  const moveOn = useCallback((alsoAbsent?: string) => {
    let index = at + 1;
    while (
      queue[index] &&
      (absent.has(queue[index]!.studentId) || queue[index]!.studentId === alsoAbsent)
    ) {
      index += 1;
    }
    if (!queue[index]) {
      setStage("summary");
      return;
    }
    setAt(index);
    void shoot(queue[index]!);
  }, [at, queue, absent, shoot]);

  // The review moves on by itself; Retake or leaving the stage stops it.
  const moveOnRef = useRef(moveOn);
  useEffect(() => {
    moveOnRef.current = moveOn;
  }, [moveOn]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (stage !== "review") return;
    let left = AUTO_NEXT;
    timer.current = setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        if (timer.current) clearInterval(timer.current);
        moveOnRef.current();
      }
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [stage, shotCount]);

  const markAbsent = (entry: RosterEntry) => {
    setAbsent((currentAbsent) => new Set(currentAbsent).add(entry.studentId));
  };

  const start = () => {
    const ids = planned.map((entry) => entry.studentId);
    setQueueIds(ids);
    setAt(0);
    if (planned[0]) void shoot(planned[0]);
  };

  // ── Frames ───────────────────────────────────────────────────────────
  const frame = (body: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={copy.photoFlow.dayTitle}
      meta={[section.label, queue.length > 0 && stage !== "summary" ? copy.photoFlow.dayProgress(Math.min(at + 1, queue.length), queue.length) : null]
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

  // ── Intro: who's first, and whether to include students with photos ──
  if (stage === "intro") {
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
          {hasPhoto.size > 0 && !studentId ? (
            <SwitchRow
              label={copy.photoFlow.dayIncludeHas}
              value={includeHas}
              onChange={setIncludeHas}
              testID="photo-day-include-has"
            />
          ) : null}
        </View>,
      );
    }
    return frame(
      <View style={styles.body}>
        <WhoCard entry={first} hasPhoto={hasPhoto.has(first.studentId)} />
        <ThemedText variant="meta">{copy.photoFlow.dayIntro}</ThemedText>
        {hasPhoto.size > 0 && !studentId ? (
          <SwitchRow
            label={copy.photoFlow.dayIncludeHas}
            value={includeHas}
            onChange={setIncludeHas}
            testID="photo-day-include-has"
          />
        ) : null}
        {errorNotice}
      </View>,
      <CapsuleButton
        title={copy.photoFlow.dayStart(first.name.split(" ")[0] ?? first.name)}
        icon="camera"
        onPress={start}
        testID="photo-day-start"
      />,
    );
  }

  // ── Who: the camera was closed or refused; pick up from here ─────────
  if (stage === "who" && current) {
    return frame(
      <View style={styles.body}>
        <WhoCard entry={current} hasPhoto={hasPhoto.has(current.studentId)} />
        {next ? <UpNext entry={next} /> : null}
        {errorNotice}
        <CapsuleButton
          title={copy.photoFlow.dayAbsent}
          icon="calendarOff"
          variant="secondary"
          onPress={() => {
            markAbsent(current);
            moveOn(current.studentId);
          }}
          testID="photo-day-absent"
        />
        <CapsuleButton
          title={copy.photoFlow.dayFinish}
          variant="secondary"
          onPress={() => setStage("summary")}
          testID="photo-day-finish"
        />
      </View>,
      <CapsuleButton title={copy.photoFlow.dayTake} icon="camera" onPress={() => void shoot(current)} testID="photo-day-take" />,
    );
  }

  // ── Review: a short look, then on to the next student ────────────────
  if (stage === "review" && current) {
    const shot = shots[current.studentId];
    return frame(
      <View style={styles.body}>
        <View style={styles.review}>
          {shot ? <Image source={{ uri: shot.uri }} style={styles.reviewPhoto} contentFit="cover" /> : null}
          <View style={styles.grow}>
            <ThemedText variant="meta">{`${copy.photoFlow.dayRoll} ${current.rollNumber ?? "—"}`}</ThemedText>
            <ThemedText variant="subtitle">{current.name}</ThemedText>
            {next ? (
              <ThemedText variant="meta" testID="photo-day-countdown">
                {copy.photoFlow.dayMovingOn(Math.max(countdown, 0))}
              </ThemedText>
            ) : null}
          </View>
        </View>
        {next ? <UpNext entry={next} /> : null}
        <CapsuleButton
          title={copy.photoFlow.dayRetake}
          icon="refresh"
          variant="secondary"
          onPress={() => {
            if (timer.current) clearInterval(timer.current);
            void shoot(current);
          }}
          testID="photo-day-retake"
        />
        {next ? (
          <CapsuleButton
            title={`${next.name.split(" ")[0]} — ${copy.photoFlow.dayAbsent.toLowerCase()}`}
            icon="calendarOff"
            variant="secondary"
            onPress={() => {
              if (timer.current) clearInterval(timer.current);
              markAbsent(next);
              moveOn(next.studentId);
            }}
            testID="photo-day-next-absent"
          />
        ) : null}
      </View>,
      <CapsuleButton
        title={next ? copy.photoFlow.dayNext(next.name.split(" ")[0] ?? next.name) : copy.photoFlow.dayFinish}
        icon={next ? "camera" : "check"}
        onPress={() => {
          if (timer.current) clearInterval(timer.current);
          moveOn();
        }}
        testID="photo-day-next"
      />,
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const taken = queue.filter((entry) => shots[entry.studentId]);
  const absentList = queue.filter((entry) => absent.has(entry.studentId));
  const busy = uploads.counts.busy > 0;
  const firstAbsent = absentList[0];
  return frame(
    <View style={styles.body}>
      <Notice
        tone={uploads.counts.failed > 0 ? "critical" : "positive"}
        title={stage === "summary" ? copy.photoFlow.dayAllDone : undefined}
        message={
          uploads.counts.failed > 0
            ? copy.photoFlow.failedBanner(uploads.counts.failed)
            : busy
              ? copy.photoFlow.uploading(uploads.counts.done, uploads.counts.total)
              : copy.photoFlow.daySummary(taken.length, absentList.length)
        }
        testID="photo-day-summary"
      />
      {uploads.counts.failed > 0 && !busy ? (
        <CapsuleButton title={copy.photoFlow.retry} icon="refresh" variant="secondary" onPress={uploads.retryFailed} testID="photo-day-retry" />
      ) : null}
      {firstAbsent ? (
        <CapsuleButton
          title={copy.photoFlow.dayTakeNow(firstAbsent.name.split(" ")[0] ?? firstAbsent.name)}
          icon="camera"
          variant="secondary"
          onPress={() => {
            setAbsent((currentAbsent) => {
              const nextAbsent = new Set(currentAbsent);
              nextAbsent.delete(firstAbsent.studentId);
              return nextAbsent;
            });
            setAt(queue.indexOf(firstAbsent));
            void shoot(firstAbsent);
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
                            : copy.photoFlow.subNone
                  }
                  uri={shot?.uri ?? null}
                  empty={!shot}
                  emptyIcon="camera"
                  status={status}
                  onPress={
                    busy
                      ? undefined
                      : () => {
                          setAt(queue.indexOf(entry));
                          void shoot(entry);
                        }
                  }
                  accessibilityLabel={`${entry.name}, roll ${entry.rollNumber ?? "—"}`}
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
      testID="photo-day-done"
    />,
  );
}

function WhoCard({ entry, hasPhoto }: { entry: RosterEntry; hasPhoto: boolean }) {
  return (
    <View style={styles.who} testID="photo-day-who">
      <View style={styles.rollBox}>
        <ThemedText variant="meta" style={styles.rollLabel}>
          {copy.photoFlow.dayRoll}
        </ThemedText>
        <ThemedText variant="title" style={styles.rollNumber}>
          {entry.rollNumber ?? "—"}
        </ThemedText>
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

function UpNext({ entry }: { entry: RosterEntry }) {
  return (
    <View style={styles.upNext}>
      <AppIcon name="chevronRight" size={16} color={colors.muted} />
      <ThemedText variant="meta">
        {`${copy.photoFlow.dayUpNext}: ${entry.rollNumber ? `${entry.rollNumber} · ` : ""}${entry.name}`}
      </ThemedText>
    </View>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  who: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
  },
  rollBox: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  rollLabel: { fontSize: 10, letterSpacing: 0.5 },
  rollNumber: { fontSize: 26, lineHeight: 30 },
  whoName: { color: "#fff" },
  whoMeta: { color: "rgba(255,255,255,0.7)" },
  upNext: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  review: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  reviewPhoto: { width: 120, height: 160, borderRadius: radius.lg, backgroundColor: colors.field },
  grid: { gap: spacing.md },
  gridRow: { flexDirection: "row", gap: spacing.sm + 2 },
});
