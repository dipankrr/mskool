import type { ComesBack, GradingMode } from "@repo/contracts";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { SegmentBar } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { localDateToIso } from "../../lib/format";
import {
  KIND_COMES_BACK,
  dueInstant,
  gradingOptions,
  timeLeft,
  sectionLabel,
  type GiveKind,
  type GivePairs,
} from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { Chip, DueChips, MarksStepper, MinutesChips } from "./pickers";
import type { PhotoUpload } from "./use-photo-uploads";
import { MAX_PHOTOS } from "./use-photo-uploads";

const text = copy.homework.give;

// ── Shared bits ─────────────────────────────────────────────────────────────

/** A question heading inside a step (frame 5's "What are you giving?"). */
export function StepQuestion({ children, meta }: { children: string; meta?: string }) {
  return (
    <View style={styles.question}>
      <ThemedText variant="title" accessibilityRole="header">
        {children}
      </ThemedText>
      {meta ? <ThemedText variant="meta">{meta}</ThemedText> : null}
    </View>
  );
}

/** One answered step as a chip at the top of later steps; tapping goes back to it. */
export function Crumbs({ items }: { items: { label: string; onPress?: () => void; icon?: AppIconName }[] }) {
  return (
    <View style={styles.crumbs}>
      {items.map((item, i) => (
        <Pressable
          key={`${i}-${item.label}`}
          accessibilityRole="button"
          onPress={item.onPress}
          disabled={!item.onPress}
          style={styles.crumb}
        >
          {item.icon ? <AppIcon name={item.icon} size={14} color={colors.muted} /> : null}
          <ThemedText variant="chip" numberOfLines={1}>
            {item.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <ThemedText variant="sectionLabel" style={styles.fieldLabel}>
      {children}
    </ThemedText>
  );
}

// ── Step 1: what ────────────────────────────────────────────────────────────

export const KIND_ICON: Record<GiveKind | "quiz", AppIconName> = {
  homework: "homework",
  practice: "practice",
  project: "project",
  reading: "reading",
  quiz: "quiz",
};

export function KindStep({
  value,
  onPick,
  sameAsLast,
}: {
  value: GiveKind | "quiz" | null;
  onPick: (kind: GiveKind | "quiz") => void;
  sameAsLast: { label: string; onPress: () => void } | null;
}) {
  const kinds: (GiveKind | "quiz")[] = ["homework", "practice", "project", "reading", "quiz"];
  return (
    <View>
      <StepQuestion>{text.whatTitle}</StepQuestion>
      <View style={styles.tiles}>
        {kinds.map((kind) => {
          const soon = false;
          const on = value === kind;
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: soon }}
              accessibilityLabel={`${text.kinds[kind]}. ${soon ? text.quizSoon : text.kindNotes[kind]}`}
              disabled={soon}
              onPress={() => onPick(kind)}
              style={({ pressed }) => [
                styles.tile,
                on ? styles.tileOn : null,
                soon ? styles.tileSoon : null,
                pressed ? styles.pressed : null,
              ]}
              testID={`give-kind-${kind}`}
            >
              <View style={[styles.tileIcon, on ? styles.tileIconOn : null]}>
                <AppIcon name={KIND_ICON[kind]} size={22} color={on ? colors.onAccent : colors.accentDeep} />
              </View>
              <ThemedText variant="bodyStrong">{text.kinds[kind]}</ThemedText>
              <ThemedText variant="meta" numberOfLines={2}>
                {soon ? text.quizSoon : text.kindNotes[kind]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {sameAsLast ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint={text.sameAsLastHint}
          onPress={sameAsLast.onPress}
          style={({ pressed }) => [styles.sameRow, pressed ? styles.pressed : null]}
          testID="give-same-as-last"
        >
          <AppIcon name="history" size={20} color={colors.accentDeep} />
          <View style={styles.grow}>
            <ThemedText variant="bodyStrong">{text.sameAsLast}</ThemedText>
            <ThemedText variant="meta" numberOfLines={1}>
              {sameAsLast.label}
            </ThemedText>
          </View>
          <AppIcon name="chevronRight" size={18} color={colors.chevron} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Step 2: classes ─────────────────────────────────────────────────────────

export function ClassesStep({
  pairs,
  loading,
  error,
  subjectId,
  sectionIds,
  onToggle,
  onSelectAll,
}: {
  pairs: GivePairs;
  loading: boolean;
  error: React.ReactNode;
  subjectId: string | null;
  sectionIds: readonly string[];
  onToggle: (subjectId: string, sectionId: string) => void;
  onSelectAll: (subjectId: string) => void;
}) {
  const anyDue = pairs.some((p) => p.sections.some((s) => s.dueTomorrow > 0));
  return (
    <View>
      <StepQuestion meta={text.classesMeta}>{text.classesTitle}</StepQuestion>
      {loading ? (
        <View style={styles.stack}>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      ) : error ? (
        error
      ) : pairs.length === 0 ? (
        <Notice tone="neutral" title={text.noClassesTitle} message={text.noClassesBody} />
      ) : (
        <View style={styles.stack}>
          {pairs.map((subject) => {
            const active = subjectId === null || subjectId === subject.subjectId;
            return (
              <View
                key={subject.subjectId}
                style={[styles.subj, subjectId === subject.subjectId ? styles.subjOn : null, active ? null : styles.subjOff]}
                testID={`give-subject-${subject.subjectId}`}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSelectAll(subject.subjectId)}
                  style={styles.subjHead}
                  testID={`give-select-all-${subject.subjectId}`}
                >
                  <ThemedText variant="bodyStrong" style={styles.grow}>
                    {subject.subjectName}
                  </ThemedText>
                  <ThemedText variant="meta" color={active ? colors.accentDeep : colors.muted}>
                    {subjectId === subject.subjectId && subject.sections.every((s) => sectionIds.includes(s.sectionId))
                      ? text.clearAll
                      : active
                        ? text.selectAll
                        : text.switchSubject}
                  </ThemedText>
                </Pressable>
                <View style={styles.secs}>
                  {subject.sections.map((sec) => {
                    const on = subjectId === subject.subjectId && sectionIds.includes(sec.sectionId);
                    const label = sectionLabel(sec.className, sec.sectionName);
                    return (
                      <Pressable
                        key={sec.sectionId}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${label}, ${sec.studentCount}${sec.dueTomorrow ? `, ${text.dueTomorrowNote}` : ""}`}
                        onPress={() => onToggle(subject.subjectId, sec.sectionId)}
                        style={({ pressed }) => [styles.sec, on ? styles.secOn : null, pressed ? styles.pressed : null]}
                        testID={`give-section-${subject.subjectId}-${sec.sectionId}`}
                      >
                        <View style={[styles.box, on ? styles.boxOn : null]}>
                          {on ? <AppIcon name="check" size={12} color={colors.onAccent} /> : null}
                        </View>
                        <ThemedText variant="bodyStrong">{label}</ThemedText>
                        <ThemedText variant="caption">{sec.studentCount}</ThemedText>
                        {sec.dueTomorrow > 0 ? <View style={styles.dot} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
          {anyDue ? (
            <View style={styles.dotNote}>
              <View style={[styles.dot, styles.dotInline]} />
              <ThemedText variant="meta">{text.dueTomorrowNote}</ThemedText>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

// ── Step 3: the work ────────────────────────────────────────────────────────

export function WorkStep({
  kind,
  title,
  details,
  book,
  pages,
  errors,
  onChange,
  photos,
  onAddPhoto,
  onRemovePhoto,
  onRetryPhoto,
  photoMessage,
}: {
  kind: GiveKind;
  title: string;
  details: string;
  book: string;
  pages: string;
  errors: { title?: string; book?: string; pages?: string };
  onChange: (patch: Partial<{ title: string; details: string; book: string; pages: string }>) => void;
  photos: PhotoUpload[];
  onAddPhoto: () => void;
  onRemovePhoto: (key: string) => void;
  onRetryPhoto: (key: string) => void;
  photoMessage: string | null;
}) {
  if (kind === "reading") {
    return (
      <View style={styles.stack}>
        <FormField
          label={text.bookLabel}
          value={book}
          onChangeText={(v) => onChange({ book: v })}
          placeholder={text.bookPlaceholder}
          error={errors.book}
          maxLength={250}
          testID="give-book"
        />
        <FormField
          label={text.pagesLabel}
          value={pages}
          onChangeText={(v) => onChange({ pages: v })}
          placeholder={text.pagesPlaceholder}
          error={errors.pages}
          maxLength={250}
          testID="give-pages"
        />
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <FormField
        label={text.titleLabel}
        value={title}
        onChangeText={(v) => onChange({ title: v })}
        placeholder={text.titlePlaceholder}
        error={errors.title}
        maxLength={250}
        testID="give-title"
      />
      <FormField
        label={text.detailsLabel}
        value={details}
        onChangeText={(v) => onChange({ details: v })}
        placeholder={text.detailsPlaceholder}
        multiline
        maxLength={10000}
        testID="give-details"
      />
      <View>
        <FieldLabel>{text.photosLabel}</FieldLabel>
        <View style={styles.thumbs}>
          {photos.map((p) => (
            <Pressable
              key={p.key}
              accessibilityRole="button"
              accessibilityLabel={p.status === "failed" ? text.photoFailed : text.removePhoto}
              onPress={() => (p.status === "failed" ? onRetryPhoto(p.key) : onRemovePhoto(p.key))}
              style={styles.thumb}
              testID={`give-photo-${p.key}`}
            >
              <Image source={{ uri: p.uri }} style={styles.thumbImage} contentFit="cover" />
              {p.status === "uploading" ? (
                <View style={styles.thumbVeil}>
                  <ActivityIndicator color={colors.onAccent} />
                </View>
              ) : p.status === "failed" ? (
                <View style={[styles.thumbVeil, styles.thumbFailed]}>
                  <AppIcon name="warning" size={20} color={colors.onAccent} />
                </View>
              ) : (
                <View style={styles.thumbRemove}>
                  <AppIcon name="close" size={12} color={colors.onAccent} />
                </View>
              )}
            </Pressable>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={text.addPhotoHint}
              onPress={onAddPhoto}
              style={({ pressed }) => [styles.thumb, styles.addThumb, pressed ? styles.pressed : null]}
              testID="give-add-photo"
            >
              <AppIcon name="camera" size={22} color={colors.accentDeep} />
              <ThemedText variant="caption" color={colors.accentDeep}>
                {text.addPhoto}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
        {photoMessage ? <Notice tone="caution" message={photoMessage} style={styles.noticeGap} /> : null}
      </View>
    </View>
  );
}

// ── Step 4: when and how ────────────────────────────────────────────────────

const LATE_DAYS = [0, 1, 2, 3] as const;

export function WhenStep({
  kind,
  presets,
  dueDay,
  onDueDay,
  dueTime,
  onDueTime,
  comesBack,
  onComesBack,
  gradingMode,
  onGradingMode,
  maxMarks,
  onMaxMarks,
  minutes,
  onMinutes,
  lateDays,
  onLateDays,
  moreOpen,
  onToggleMore,
  todayIso,
  hasGradeScale,
}: {
  kind: GiveKind;
  presets: { label: string; day: string }[];
  dueDay: string;
  onDueDay: (day: string) => void;
  dueTime: string;
  onDueTime: (t: string) => void;
  comesBack: ComesBack;
  onComesBack: (v: ComesBack) => void;
  gradingMode: GradingMode;
  onGradingMode: (v: GradingMode) => void;
  maxMarks: number;
  onMaxMarks: (v: number) => void;
  minutes: number | null;
  onMinutes: (v: number | null) => void;
  lateDays: number;
  onLateDays: (v: number) => void;
  moreOpen: boolean;
  onToggleMore: () => void;
  todayIso: string;
  hasGradeScale: boolean;
}) {
  const grading = gradingOptions(kind, comesBack).filter((g) => g !== "grade" || hasGradeScale);
  const showGrading = grading.length > 1 || grading[0] !== "none";
  return (
    <View style={styles.stack}>
      <View>
        <View style={styles.labelRow}>
          <FieldLabel>{kind === "reading" ? text.readBy : text.due}</FieldLabel>
          <ThemedText variant="chip" color={colors.tone[timeLeft(dueInstant(dueDay, dueTime)).tone].fg}>
            {timeLeft(dueInstant(dueDay, dueTime)).label}
          </ThemedText>
        </View>
        <DueChips presets={presets} day={dueDay} onDay={onDueDay} time={dueTime} onTime={onDueTime} minimumDate={todayIso} />
      </View>

      <View style={styles.part}>
        <FieldLabel>{text.comesBack}</FieldLabel>
        <View style={styles.opts}>
          {KIND_COMES_BACK[kind].map((v) => (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: comesBack === v }}
              onPress={() => onComesBack(v)}
              style={({ pressed }) => [styles.opt, comesBack === v ? styles.optOn : null, pressed ? styles.pressed : null]}
              testID={`give-back-${v}`}
            >
              <AppIcon
                name={v === "brought" ? "homework" : v === "sent" ? "camera" : v === "tick" ? "check" : "close"}
                size={18}
                color={comesBack === v ? colors.accentDeep : colors.muted}
              />
              <ThemedText variant="bodyStrong" color={comesBack === v ? colors.accentDeep : colors.muted} numberOfLines={1} style={styles.grow}>
                {text.comesBackOptions[v]}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      {showGrading ? (
        <View style={styles.part}>
          <FieldLabel>{text.grading}</FieldLabel>
          <SegmentBar
            label={text.grading}
            value={gradingMode}
            options={grading.map((g) => ({ value: g, label: text.gradingOptions[g], testID: `give-grading-${g}` }))}
            onChange={onGradingMode}
          />
          <ThemedText variant="meta" style={styles.gradingHelp}>
            {gradingMode === "marks" ? text.gradingHelp.marks(String(maxMarks)) : text.gradingHelp[gradingMode]}
          </ThemedText>
          {gradingMode === "marks" ? (
            <View style={styles.kvline}>
              <ThemedText variant="body">{text.outOf}</ThemedText>
              <MarksStepper value={maxMarks} onChange={onMaxMarks} />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.part}>
          <Notice tone="neutral" message={comesBack === "tick" ? text.noGradingTick : text.noGradingNone} />
        </View>
      )}

      <View style={styles.part}>
        <FieldLabel>{text.howLong}</FieldLabel>
        <MinutesChips value={minutes} onChange={onMinutes} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        onPress={onToggleMore}
        style={styles.moreRow}
        testID="give-more"
      >
        <ThemedText variant="body" style={styles.grow}>
          {text.more}
        </ThemedText>
        <ThemedText variant="meta">{`${text.late}: ${text.lateOptions[lateDays]}`}</ThemedText>
        <AppIcon name={moreOpen ? "chevronUp" : "chevronDown"} size={18} color={colors.chevron} />
      </Pressable>
      {moreOpen ? (
        <View>
          <FieldLabel>{text.late}</FieldLabel>
          <View style={styles.chips}>
            {LATE_DAYS.map((d) => (
              <Chip key={d} label={text.lateOptions[d]!} on={lateDays === d} onPress={() => onLateDays(d)} testID={`give-late-${d}`} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}


/** Today in the phone's calendar, for the date picker's floor. */
export function todayLocal(): string {
  return localDateToIso(new Date());
}

const styles = StyleSheet.create({
  question: { marginTop: spacing.lg, marginBottom: spacing.md, gap: spacing.xs },
  crumbs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  crumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 32,
    maxWidth: "100%",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.chip,
  },
  fieldLabel: { marginBottom: spacing.sm },
  labelRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  part: { paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(16, 24, 40, 0.14)" },
  gradingHelp: { marginTop: spacing.sm },
  stack: { gap: spacing.lg, marginTop: spacing.md },
  grow: { flex: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: {
    width: "47%",
    flexGrow: 1,
    minHeight: 120,
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.hairline,
  },
  tileOn: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  tileSoon: { opacity: 0.5 },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
    marginBottom: spacing.xs,
  },
  tileIconOn: { backgroundColor: colors.accent },
  sameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    minHeight: 64,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  subj: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  subjOn: { borderColor: colors.accentStrong },
  subjOff: { opacity: 0.5 },
  subjHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  secs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  sec: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(16, 24, 40, 0.14)",
  },
  secOn: { backgroundColor: colors.accentTint, borderWidth: 1.5, borderColor: colors.accent },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.chevron,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tone.caution.fg,
  },
  dotInline: { position: "relative", top: 0, right: 0 },
  dotNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.field,
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbVeil: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 24, 40, 0.45)",
  },
  thumbFailed: { backgroundColor: "rgba(180, 35, 24, 0.7)" },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 24, 40, 0.6)",
  },
  addThumb: { alignItems: "center", justifyContent: "center", gap: spacing.xxs, backgroundColor: colors.accentTint },
  noticeGap: { marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    justifyContent: "center",
    backgroundColor: colors.field,
  },
  chipOn: { backgroundColor: colors.accent },
  opts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  opt: {
    width: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "rgba(16, 24, 40, 0.10)",
    backgroundColor: colors.surface,
  },
  optOn: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  kvline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  stepKey: {
    width: 44,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  stepperValue: { minWidth: 44, textAlign: "center" },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
});
