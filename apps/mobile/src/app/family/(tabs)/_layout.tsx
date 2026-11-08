import { Tabs } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";

import { FTabBar } from "../../../family/ui";

const ICONS = {
  home: "home",
  attendance: "calendar",
  homework: "homework",
  fees: "fees",
  exams: "exams",
} as const;

/** Home, Attendance, Homework, Fees, Exams. */
export default function FamilyTabsLayout() {
  const { t } = useTranslation("family");
  return (
    <Tabs tabBar={(props) => <FTabBar {...props} icons={ICONS} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="attendance" options={{ title: t("tabs.attendance") }} />
      <Tabs.Screen name="homework" options={{ title: t("tabs.homework") }} />
      <Tabs.Screen name="fees" options={{ title: t("tabs.fees") }} />
      <Tabs.Screen name="exams" options={{ title: t("tabs.exams") }} />
    </Tabs>
  );
}
