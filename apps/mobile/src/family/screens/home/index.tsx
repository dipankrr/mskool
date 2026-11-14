import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { useFamilyTheme } from "../../theme";
import { FEmptyState, FErrorState, FOfflineNote, FScreen, FText, useFamilyTabBarSpace } from "../../ui";
import { SignOutButton } from "../sign-out-button";
import { FamilyTabHeader } from "../tab-header";
import { BookieLine } from "./bookie-line";
import { Tiles } from "./tiles";
import { Today } from "./today";
import { Tomorrow } from "./tomorrow";
import { Bag, Tonight } from "./tonight";
import { useHome } from "./use-home";

/**
 * Family Home, the evening loop (owner, 2026-11-15). Top to bottom: Bookie
 * says one line about the evening and reacts as it changes; Tonight is the
 * work and then the bag; Tomorrow shows the day ahead; Today at school tells
 * what happened; three tiles keep the slow numbers. The same screen for a
 * student and a parent, so the copy never says "you" or "your child".
 */
export function FamilyHome() {
  const { t } = useTranslation("family");
  const format = useFormat();
  const space = useFamilyTabBarSpace();
  const { child, children, query: childrenQuery } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const home = useHome(studentId);

  if (childrenQuery.isError && !childrenQuery.data) {
    return (
      <FScreen bottomSpace={space}>
        <FErrorState onRetry={() => void childrenQuery.refetch()} />
        <SignOutButton />
      </FScreen>
    );
  }
  if (childrenQuery.isSuccess && children.length === 0) {
    return (
      <FScreen bottomSpace={space}>
        <FEmptyState title={t("noChildren.title")} body={t("noChildren.body")} />
        <SignOutButton />
      </FScreen>
    );
  }

  return (
    <FScreen
      testID="family-home"
      bottomSpace={space}
      refreshing={home.refreshing}
      onRefresh={home.refetch}
      header={
        <FamilyTabHeader
          title={format.date(home.today, "weekdayDayMonth")}
          trailing={child ? <ProfileButton name={child.firstName} /> : null}
        />
      }
    >
      {home.offline ? <FOfflineNote /> : null}
      <BookieLine home={home} />
      <Tonight home={home} />
      <Bag home={home} />
      <Tomorrow home={home} />
      <Today home={home} />
      <Tiles home={home} />
    </FScreen>
  );
}

/** The child's initial in a circle: opens Profile (the child, the school, sign out). */
function ProfileButton({ name }: { name: string }) {
  const { t } = useTranslation("family");
  const theme = useFamilyTheme();
  const a = theme.components.home.avatar;
  return (
    <Pressable
      testID="home-profile"
      accessibilityRole="button"
      accessibilityLabel={t("home.profile")}
      hitSlop={8}
      onPress={() => router.push("/family/profile")}
    >
      <View style={[styles.center, { width: a.size, height: a.size, borderRadius: a.size / 2, backgroundColor: a.bg }]}>
        <FText variant="label" tint={a.fg}>
          {name.trim().charAt(0).toUpperCase()}
        </FText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
