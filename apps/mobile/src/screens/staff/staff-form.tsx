import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ScreenFrame } from "../../components/screen-frame";
import { ThemedText } from "../../components/themed-text";
import { phoneDigits } from "../../family/lib/sign-in";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { PhotoSourceSheet } from "../students/student-photo";
import type { PickedImage } from "../students/student-photo";
import { StaffAvatar, useStaffPhotoUploader } from "./staff-photo";
import { looksLikeTeacher, splitName } from "./staff-logic";
import { givableRoles, isOrgOnly, roleLabel, titleFromPicks } from "./role-logic";
import type { OfficeRole } from "./role-logic";
import { RolePicks } from "./role-picks";

/**
 * Add or edit a staff member (ADR-068, frame 06; frames R1-R3). Photo first
 * (optional), then name and phone — the phone is checked as it is typed,
 * because it is how they will sign in — then "What do they do here?": Teacher
 * (no role; pre-picked for teacher titles), the office roles this person may
 * give, or Office staff. The job title fills itself from the first office
 * pick until it is typed over. Roles picked for someone who hasn't joined
 * wait and start when they join. One button; what to do next comes after.
 */
export function StaffFormScreen({ id }: { id?: string }) {
  const editing = Boolean(id);
  const { organizationId, schoolId } = useActiveContext();
  const orgId = organizationId ?? "";
  const utils = trpc.useUtils();
  const existing = trpc.staff.byId.useQuery(
    { organizationId: orgId, id: id ?? "" },
    { enabled: editing && Boolean(organizationId) },
  );
  const hints = trpc.staff.formHints.useQuery(
    { organizationId: orgId },
    { enabled: Boolean(organizationId && schoolId) },
  );
  const create = trpc.staff.create.useMutation();
  const update = trpc.staff.update.useMutation();
  const assignRole = trpc.role.assignStaff.useMutation();
  const { has, hasOrgWide } = usePermissions();
  const branchName = useActiveBranchName();
  const photoUploader = useStaffPhotoUploader();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [teachesPicked, setTeaches] = useState(false);
  const [teachesTouched, setTeachesTouched] = useState(false);
  const [more, setMore] = useState(false);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [picks, setPicks] = useState<OfficeRole[]>([]);
  // The title the picks last filled in; typing over it stops the filling.
  const [autoTitle, setAutoTitle] = useState("");

  if (editing && existing.data && !loaded) {
    const row = existing.data;
    setName(`${row.firstName} ${row.lastName}`.trim());
    setPhone(row.phone ?? "");
    setDesignation(row.designation ?? "");
    setTeaches(row.teachesClasses);
    setTeachesTouched(true);
    setCode(row.employeeCode);
    setEmail(row.email ?? "");
    setLoaded(true);
  }

  // Teacher titles switch "Teaches classes" on until the person decides.
  const teaches = teachesTouched ? teachesPicked : looksLikeTeacher(designation);
  // Roles are given here only when adding; afterwards on the profile (R5).
  const roles = editing
    ? []
    : givableRoles({
        canAssign: has("role_assignment:assign"),
        canAssignOrgWide: hasOrgWide("role_assignment:assign"),
      });

  function setPicksAndTitle(next: OfficeRole[]) {
    setPicks(next);
    const title = titleFromPicks(next);
    if (designation.trim() === autoTitle.trim()) setDesignation(title);
    setAutoTitle(title);
  }
  const digits = phoneDigits(phone);
  const check = trpc.staff.checkPhone.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", phone: digits, exceptId: id },
    { enabled: digits.length === 10 && Boolean(organizationId && schoolId) },
  );


  const phoneState =
    digits.length < 10
      ? null
      : check.data?.state === "free"
        ? ({ tone: "positive", text: "Free" } as const)
        : check.data?.state === "here"
          ? ({ tone: "critical", text: `${check.data.name} already has this number` } as const)
          : check.data?.state === "elsewhere"
            ? ({ tone: "critical", text: "Used by staff at another school" } as const)
            : null;
  const { firstName, lastName } = splitName(name);
  // A joined person's sign-in follows the phone (R13).
  const phoneMoves =
    editing &&
    existing.data?.joinState === "joined" &&
    digits.length === 10 &&
    digits !== (existing.data?.phone ?? "");
  const canSave =
    firstName.length > 0 &&
    lastName.length > 0 &&
    digits.length === 10 &&
    check.data?.state === "free" &&
    !create.isPending &&
    !update.isPending &&
    !assignRole.isPending &&
    !photoUploader.busy;

  // Say why the button is off instead of leaving it silently grey.
  const missing =
    firstName.length > 0 && lastName.length === 0
      ? 'Add a surname too, like "Priya Sharma"'
      : digits.length > 0 && digits.length < 10
        ? "A phone number is 10 digits"
        : digits.length === 10 && check.isError
          ? "Couldn't check this number. Try again in a moment."
          : null;

  const suggestions = (hints.data?.designations ?? [])
    .filter((d) => !designation || d.toLowerCase().includes(designation.trim().toLowerCase()))
    .filter((d) => d.toLowerCase() !== designation.trim().toLowerCase())
    .slice(0, 6);

  async function save() {
    if (!organizationId || !schoolId) return;
    setError(null);
    try {
      const data = {
        firstName,
        lastName,
        phone: digits,
        designation: designation.trim() || null,
        teachesClasses: teaches,
        email: email.trim() || null,
      };
      if (editing && id) {
        await update.mutateAsync({ organizationId, id, data });
        if (picked) await photoUploader.upload(organizationId, id, picked);
        await Promise.all([utils.staff.list.invalidate(), utils.staff.byId.invalidate()]);
        router.back();
        return;
      }
      const row = await create.mutateAsync({
        organizationId,
        schoolId,
        data: { ...data, employeeCode: code.trim() || undefined },
      });
      if (picked) {
        await photoUploader.upload(organizationId, row.id, picked).catch(() => undefined);
      }
      // Each role is its own grant, checked against where it is given. A
      // refusal doesn't undo the person: the Added screen says which failed.
      const failed: string[] = [];
      for (const role of picks) {
        await assignRole
          .mutateAsync({
            organizationId,
            schoolId,
            staffId: row.id,
            roleType: role,
            scopeType: isOrgOnly(role) ? "org" : "school",
            id: isOrgOnly(role) ? organizationId : schoolId,
          })
          .catch(() => failed.push(roleLabel(role)));
      }
      await utils.staff.list.invalidate();
      router.replace({
        pathname: "/staff-added",
        params: { id: row.id, ...(failed.length ? { failed: failed.join(", ") } : {}) },
      });
    } catch (cause) {
      setError(thrownMessage(cause));
    }
  }

  const existingPhoto = existing.data?.photo;

  return (
    <ScreenFrame
      title={editing ? "Edit staff" : "Add staff"}
      backAccessibilityLabel="Cancel"
      footer={
        <CapsuleButton
          title={editing ? "Save" : firstName ? `Add ${firstName}` : "Add"}
          onPress={() => void save()}
          disabled={!canSave}
          loading={create.isPending || update.isPending || assignRole.isPending || photoUploader.busy}
          testID="staff-form-save"
          style={{ alignSelf: "stretch" }}
        />
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a photo"
        onPress={() => setSheet(true)}
        style={styles.photoRow}
      >
        {picked || existingPhoto ? (
          <StaffAvatar
            name={name || "?"}
            uri={picked?.uri ?? existingPhoto?.url}
            size={72}
            badge="camera"
          />
        ) : (
          <View style={styles.photoEmpty}>
            <AppIcon name="person" size={30} color={colors.muted} />
            <View style={styles.photoBadge}>
              <AppIcon name="camera" size={14} color={colors.onAccent} />
            </View>
          </View>
        )}
        <View style={styles.grow}>
          <ThemedText variant="bodyStrong">{picked || existingPhoto ? "Change photo" : "Add a photo"}</ThemedText>
          <ThemedText variant="meta">Optional. Used on ID cards and lists.</ThemedText>
        </View>
      </Pressable>

      <Field icon="person">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Full name"
          placeholderTextColor={colors.muted}
          style={styles.input}
          autoCapitalize="words"
          testID="staff-form-name"
          accessibilityLabel="Full name"
        />
      </Field>
      <Field icon="call" tone={phoneState?.tone}>
        <ThemedText variant="bodyStrong" style={styles.prefix}>
          +91
        </ThemedText>
        <TextInput
          value={phone}
          onChangeText={(text) => {
            // Digits only, at most 10. A pasted "+91 98765 43210" or
            // "098765 43210" drops its prefix instead of being cut off.
            let d = text.replace(/\D/g, "");
            if (d.length > 10 && (d.startsWith("91") || d.startsWith("0"))) d = d.slice(d.length - 10);
            setPhone(d.slice(0, 10));
          }}
          placeholder="Phone · they sign in with this"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          style={styles.input}
          testID="staff-form-phone"
          accessibilityLabel="Phone number"
        />
        {phoneState?.tone === "positive" ? (
          <View style={styles.free}>
            <AppIcon name="check" size={12} color={colors.tone.positive.fg} />
            <ThemedText variant="caption" style={{ color: colors.tone.positive.fg }}>
              Free
            </ThemedText>
          </View>
        ) : null}
      </Field>
      {missing && !phoneState ? (
        <ThemedText variant="meta" style={styles.fieldHint}>
          {missing}
        </ThemedText>
      ) : null}
      {phoneState?.tone === "critical" ? (
        <ThemedText variant="meta" style={styles.fieldError}>
          {phoneState.text}
        </ThemedText>
      ) : null}
      {phoneMoves ? (
        <View style={styles.warn} testID="staff-form-phone-warning">
          <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
          <ThemedText variant="meta" style={styles.warnText}>
            {firstName} signs in with this number. From now on it’s {digits}, with the same password. {existing.data?.phone} stops working when you save.
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.askHead}>
        <ThemedText variant="name">What does {firstName || "this person"} do here?</ThemedText>
        <ThemedText variant="meta">{editing ? "Roles are given on the profile" : "Pick all that apply"}</ThemedText>
      </View>
      <RolePicks
        firstName={firstName}
        teacher={teaches}
        onTeacher={(next) => {
          setTeaches(next);
          setTeachesTouched(true);
        }}
        roles={roles}
        picks={picks}
        onRole={(role) =>
          setPicksAndTitle(picks.includes(role) ? picks.filter((r) => r !== role) : [...picks, role])
        }
        onOffice={() => {
          setTeaches(false);
          setTeachesTouched(true);
          setPicksAndTitle([]);
        }}
      />
      {picks.length > 0 ? (
        <View style={styles.given} testID="staff-form-roles-line">
          <AppIcon name="shield" size={18} color={colors.accentDeep} />
          <ThemedText variant="meta" style={styles.givenText}>
            <ThemedText variant="meta" style={styles.givenStrong}>
              {picks
                .map((r) => (isOrgOnly(r) ? `${roleLabel(r)} for every branch` : `${roleLabel(r)} for ${branchName ?? "this branch"}`))
                .join(", ")}
              .
            </ThemedText>{" "}
            {firstName ? `It starts when ${firstName} joins the app.` : "It starts when they join the app."}
          </ThemedText>
        </View>
      ) : null}

      <ThemedText variant="sectionLabel" style={styles.titleLabel}>
        Job title
      </ThemedText>
      <View style={[styles.designation, designation ? styles.designationOn : null]}>
        <View style={styles.fieldRow}>
          <AppIcon name="shield" size={18} color={colors.muted} />
          <TextInput
            value={designation}
            onChangeText={setDesignation}
            placeholder="PRT, TGT, Accountant…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            testID="staff-form-designation"
            accessibilityLabel="Job title"
          />
        </View>
        {suggestions.length > 0 ? (
          <View style={styles.sugg}>
            {suggestions.map((s, i) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                onPress={() => setDesignation(s)}
                style={[styles.suggChip, i === 0 && designation ? styles.suggHot : null]}
              >
                <ThemedText variant="chip" style={i === 0 && designation ? styles.hotText : null}>
                  {s}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {!editing ? (
        <Pressable accessibilityRole="button" onPress={() => setMore((v) => !v)} style={styles.moreRow}>
          <AppIcon name={more ? "chevronUp" : "add"} size={16} color={colors.accentDeep} />
          <ThemedText variant="bodyStrong" style={styles.link}>
            More details
          </ThemedText>
          {!more ? (
            <ThemedText variant="meta">· code {hints.data?.nextEmployeeCode ?? "EMP-…"}, email</ThemedText>
          ) : null}
        </Pressable>
      ) : null}
      {more || editing ? (
        <>
          {!editing ? (
            <Field icon="profileCard">
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder={`Employee code (${hints.data?.nextEmployeeCode ?? "suggested"})`}
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoCapitalize="characters"
                accessibilityLabel="Employee code"
              />
            </Field>
          ) : null}
          <Field icon="message">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email (contact only)"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
              accessibilityLabel="Email"
            />
          </Field>
        </>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <AppIcon name="warningCircle" size={18} color={colors.tone.critical.fg} />
          <ThemedText variant="meta" style={styles.errorText}>
            {error}
          </ThemedText>
        </View>
      ) : null}

      <PhotoSourceSheet
        visible={sheet}
        hasPhoto={Boolean(picked)}
        onDismiss={() => setSheet(false)}
        onPicked={(next) => setPicked(next)}
        onRemove={() => setPicked(null)}
        onError={(cause) => setError(thrownMessage(cause))}
      />
    </ScreenFrame>
  );
}

function Field({
  icon,
  tone,
  children,
}: {
  icon: AppIconName;
  tone?: "positive" | "critical";
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.field,
        tone === "critical" ? { borderColor: colors.tone.critical.fg, borderWidth: 1.5 } : null,
      ]}
    >
      <AppIcon name={icon} size={18} color={colors.muted} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginBottom: spacing.sm },
  photoEmpty: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.inputLine,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.canvas,
  },
  grow: { flex: 1, minWidth: 0, gap: spacing.xxs },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 50 },
  input: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.callout,
    color: colors.ink,
    paddingVertical: spacing.md,
  },
  prefix: { paddingRight: spacing.sm, borderRightWidth: 1, borderRightColor: colors.inputLine },
  free: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.tone.positive.bg,
  },
  fieldHint: { color: colors.muted, marginLeft: spacing.xs, marginTop: spacing.xs },
  fieldError: { color: colors.tone.critical.fg, marginLeft: spacing.xs, marginTop: spacing.xs },
  designation: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  designationOn: { borderWidth: 2, borderColor: colors.accent },
  sugg: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2, paddingBottom: spacing.sm },
  suggChip: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.chip,
    justifyContent: "center",
  },
  suggHot: { backgroundColor: colors.accentTint },
  hotText: { color: colors.accentDeep },
  askHead: { marginTop: spacing.xl, gap: 2, paddingHorizontal: spacing.xs },
  given: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
    marginTop: spacing.sm,
  },
  givenText: { flex: 1, color: colors.accentDeep },
  givenStrong: { color: colors.accentDeep, fontFamily: fontFamily.semibold },
  titleLabel: { marginTop: spacing.lg, marginLeft: spacing.xs },
  warn: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.caution.bg,
    marginTop: spacing.sm,
  },
  warnText: { flex: 1, color: colors.tone.caution.fg },
  switchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  switchIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  moreRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginTop: spacing.md, minHeight: 44 },
  link: { color: colors.accentDeep },
  error: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.critical.bg,
    marginTop: spacing.md,
  },
  errorText: { flex: 1, color: colors.tone.critical.fg },
});
