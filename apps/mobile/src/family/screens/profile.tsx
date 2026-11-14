import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../components/app-icon";
import { useMe } from "../../hooks/use-me";
import { childClass, useFamilyChild } from "../child-context";
import type { FamilyChild } from "../child-context";
import { useFamilyTheme } from "../theme";
import { FCard, FErrorState, FHeader, FRow, FRowStack, FScreen, FSkeleton, FText } from "../ui";
import { SignOutButton } from "./sign-out-button";

/**
 * Profile: who the app is showing (the child, class, roll number, school and
 * session), the other children on this login, and sign out. Opened from the
 * initial at the top of Home.
 */
export function FamilyProfile() {
  const { t } = useTranslation("family");
  const { t: tc } = useTranslation();
  const theme = useFamilyTheme();
  const { child, children, select, query } = useFamilyChild();
  const { me } = useMe();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/family/home"));
  const header = <FHeader title={t("profile.title")} onBack={back} backLabel={tc("back")} />;

  if (query.isError && !query.data) {
    return (
      <FScreen header={header}>
        <FErrorState onRetry={() => void query.refetch()} />
        <SignOutButton variant="secondary" />
      </FScreen>
    );
  }

  const others = children.filter((c) => c.studentId !== child?.studentId);
  return (
    <FScreen testID="family-profile" header={header}>
      {child ? <ChildCard child={child} /> : <FSkeleton height={220} radius="xl" />}
      {others.length > 0 ? (
        <View style={{ gap: theme.space.md }}>
          <FText variant="heading" accessibilityRole="header">
            {t("profile.children")}
          </FText>
          <FRowStack>
            {others.map((other) => (
              <FRow
                key={other.studentId}
                testID={`profile-child-${other.studentId}`}
                title={other.name}
                subtitle={childClass(t, other)}
                leading={<Initial name={other.firstName} size={44} />}
                chevron={false}
                trailing={<AppIcon name="swap" size={20} color={theme.color.muted} />}
                accessibilityLabel={`${t("switcher.hint")}: ${other.name}`}
                onPress={() => select(other.studentId)}
              />
            ))}
          </FRowStack>
        </View>
      ) : null}
      <View style={[styles.center, { gap: theme.space.md }]}>
        {me?.user.name ? (
          <View style={styles.center}>
            <FText variant="caption" color="muted">
              {t("profile.account").toUpperCase()}
            </FText>
            <FText variant="label">{me.user.name}</FText>
          </View>
        ) : null}
        <SignOutButton variant="secondary" />
      </View>
    </FScreen>
  );
}

function Initial({ name, size }: { name: string; size: number }) {
  const theme = useFamilyTheme();
  const a = theme.components.home.avatar;
  return (
    <View style={[styles.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: a.bg }]}>
      <FText variant={size >= 64 ? "title" : "label"} tint={a.fg}>
        {name.trim().charAt(0).toUpperCase()}
      </FText>
    </View>
  );
}

function ChildCard({ child }: { child: FamilyChild }) {
  const { t } = useTranslation("family");
  const theme = useFamilyTheme();
  const facts: [string, string][] = [
    [t("profile.class"), childClass(t, child)],
    ...(child.rollNumber ? ([[t("profile.roll"), child.rollNumber]] as [string, string][]) : []),
    [t("profile.school"), child.schoolName],
    [t("profile.session"), child.academicYear.name],
  ];
  return (
    <FCard testID="profile-child" style={{ gap: theme.space.lg }}>
      <View style={[styles.row, { gap: theme.space.lg }]}>
        <Initial name={child.firstName} size={64} />
        <FText variant="title" numberOfLines={2} style={styles.flex}>
          {child.name}
        </FText>
      </View>
      <View style={{ gap: theme.space.md }}>
        {facts.map(([label, value]) => (
          <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={[styles.row, { gap: theme.space.md }]}>
            <FText variant="meta" color="muted" style={styles.label}>
              {label}
            </FText>
            <FText variant="label" style={styles.flex}>
              {value}
            </FText>
          </View>
        ))}
      </View>
    </FCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  label: { width: 104 },
});
