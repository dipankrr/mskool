import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

/**
 * Export staff (frame R18) as a spreadsheet (CSV) to the phone's share sheet.
 * Personal details and people who left are off by default. The PDF list in
 * the mockup is not built.
 */
export function StaffExportSheet({ count, onClose }: { count: number; onClose: () => void }) {
  const { organizationId, schoolId } = useActiveContext();
  const branchName = useActiveBranchName();
  const exporter = trpc.staff.export.useMutation();
  const [teaching, setTeaching] = useState(true);
  const [roles, setRoles] = useState(true);
  const [personal, setPersonal] = useState(false);
  const [includeLeft, setIncludeLeft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    if (!organizationId || !schoolId) return;
    setError(null);
    try {
      const out = await exporter.mutateAsync({ organizationId, schoolId, teaching, roles, personal, includeLeft });
      const file = new File(Paths.cache, out.fileName);
      if (file.exists) file.delete();
      file.create();
      // A byte-order mark so Excel reads names in Indian scripts correctly.
      file.write(`﻿${out.csv}`);
      await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Staff list" });
      onClose();
    } catch (cause) {
      setError(thrownMessage(cause));
    }
  }

  return (
    <FormSheet
      title="Export staff"
      onClose={onClose}
      testIDPrefix="export"
      footer={
        <CapsuleButton
          title="Export and share"
          icon="share"
          onPress={() => void share()}
          loading={exporter.isPending}
          style={{ alignSelf: "stretch" }}
          testID="export-share"
        />
      }
    >
      <ThemedText variant="meta">
        {[branchName, `${count} people working now`].filter(Boolean).join(" · ")} · a spreadsheet
      </ThemedText>
      <View style={styles.card}>
        <View style={styles.always}>
          <ThemedText variant="body" style={styles.grow}>
            Name, code, job title, phone
          </ThemedText>
          <ThemedText variant="meta">Always</ThemedText>
        </View>
        <SwitchRow label="What they teach" value={teaching} onChange={setTeaching} testID="export-teaching" />
        <SwitchRow label="Roles" value={roles} onChange={setRoles} testID="export-roles" />
        <SwitchRow label="Email, birthday, address" value={personal} onChange={setPersonal} testID="export-personal" />
        <SwitchRow label="People who left" value={includeLeft} onChange={setIncludeLeft} testID="export-left" />
      </View>
      {error ? <ThemedText variant="meta" style={styles.error}>{error}</ThemedText> : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, borderRadius: radius.lg, backgroundColor: colors.canvas, paddingHorizontal: spacing.md },
  always: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52 },
  grow: { flex: 1 },
  error: { color: colors.tone.critical.fg, marginTop: spacing.md },
});
