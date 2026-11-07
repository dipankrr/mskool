import { Tabs } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";

import { FTabBar } from "../../../family/ui";

const ICONS = {
  home: "home",
  attendance: "calendar",
  fees: "fees",
  exams: "exams",
} as const;

/** Home, Attendance, Fees, Exams. Homework stays hidden until its revamp. */
export default function FamilyTabsLayout() {
  const { t } = useTranslation("family");
  return (
    <Tabs tabBar={(props) => <FTabBar {...props} icons={ICONS} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="attendance" options={{ title: t("tabs.attendance") }} />
      <Tabs.Screen name="fees" options={{ title: t("tabs.fees") }} />
      <Tabs.Screen name="exams" options={{ title: t("tabs.exams") }} />
    </Tabs>
  );
}
