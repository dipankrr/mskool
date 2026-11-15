import { StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatIsoDate } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

export type SessionCalendarPreview = {
  weekdays: string[] | null;
  added: number;
  addedFrom: string | null;
  addedTo: string | null;
  addedSchoolDays: number;
  removed: number;
  removedFrom: string | null;
  removedTo: string | null;
  removedSchoolDays: number;
  blocked: { date: string; sections: number }[];
  schoolDaysBefore: number;
  schoolDaysAfter: number;
};

/**
 * What new session dates do to the attendance calendar (ADR-069, mockup
 * C1/C2): added days are filled from the weekly pattern, removed days go,
 * and days that already have attendance block the change.
 */
export function CalendarChangeSheet({
  preview,
  before,
  after,
  saving,
  onSave,
  onClose,
}: {
  preview: SessionCalendarPreview;
  before: { startDate: string; endDate: string };
  after: { startDate: string; endDate: string };
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const words = copy.attendance.manage.cal;
  const endMoved = before.endDate !== after.endDate;
  const startMoved = before.startDate !== after.startDate;
  const title =
    endMoved && startMoved
      ? words.sessionTitleBoth
      : words.sessionTitle(formatIsoDate(endMoved ? after.endDate : after.startDate), endMoved);
  const blocked = preview.blocked.length > 0;
  const blockedSections = Math.max(...preview.blocked.map((b) => b.sections), 0);

  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix="session-calendar"
      footer={
        blocked ? (
          <CapsuleButton title={words.sessionChange} variant="secondary" onPress={onClose} testID="session-calendar-change" />
        ) : (
          <View style={styles.row}>
            <CapsuleButton title={words.back} variant="secondary" onPress={onClose} style={styles.flex} />
            <CapsuleButton title={words.sessionSave} loading={saving} onPress={onSave} style={styles.flex} testID="session-calendar-save" />
          </View>
        )
      }
    >
      {!startMoved || !endMoved ? (
        <ThemedText variant="meta">
          {words.sessionMoved(formatIsoDate(endMoved ? before.endDate : before.startDate))}
        </ThemedText>
      ) : null}
      <View style={styles.box}>
        {preview.added > 0 ? (
          <Line
            icon="add"
            good
            title={words.sessionAdded(preview.added)}
            meta={`${formatIsoDate(preview.addedFrom)} – ${formatIsoDate(preview.addedTo)}`}
            value={preview.weekdays ? words.sessionSchoolDelta(preview.addedSchoolDays) : ""}
          />
        ) : null}
        {preview.added > 0 ? (
          <Line icon="calendar" good title={preview.weekdays ? words.sessionFilled : words.sessionNoPattern} meta={null} value="" separated />
        ) : null}
        {preview.removed > 0 ? (
          <Line
            icon="close"
            title={words.sessionRemoved(preview.removed)}
            meta={`${formatIsoDate(preview.removedFrom)} – ${formatIsoDate(preview.removedTo)}`}
            value={words.sessionSchoolDelta(-preview.removedSchoolDays)}
            separated={preview.added > 0}
          />
        ) : null}
        {!blocked ? (
          <Line
            icon="check"
            good
            title={words.sessionTotal}
            meta={null}
            value={`${preview.schoolDaysBefore} → ${preview.schoolDaysAfter}`}
            separated
          />
        ) : null}
      </View>
      {blocked ? (
        <View style={styles.err} testID="session-calendar-blocked">
          <ThemedText variant="meta" color="#7A271A">
            {words.sessionBlocked(preview.blocked.map((b) => formatIsoDate(b.date)).join(", "), blockedSections)}
          </ThemedText>
        </View>
      ) : preview.added > 0 && preview.weekdays ? (
        <ThemedText variant="meta" style={styles.after}>
          {words.sessionAfterNote}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

function Line({
  icon,
  good = false,
  title,
  meta,
  value,
  separated = false,
}: {
  icon: AppIconName;
  good?: boolean;
  title: string;
  meta: string | null;
  value: string;
  separated?: boolean;
}) {
  return (
    <View style={[styles.line, separated ? styles.separated : null]}>
      <View style={[styles.icon, { backgroundColor: good ? colors.accentTint : colors.tone.critical.bg }]}>
        <AppIcon name={icon} size={14} color={good ? colors.accentDeep : colors.tone.critical.fg} />
      </View>
      <View style={styles.flex}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        {meta ? <ThemedText variant="meta">{meta}</ThemedText> : null}
      </View>
      {value ? <ThemedText variant="bodyStrong">{value}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: spacing.sm },
  box: { marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  separated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  icon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  err: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tone.critical.bg },
  after: { marginTop: spacing.md },
});
