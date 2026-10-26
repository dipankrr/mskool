import { Tabs } from "expo-router/js-tabs";

import { AppIcon } from "../../../components/app-icon";
import { TabBar } from "../../../components/tab-bar";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import { colors } from "../../../theme/brand-admin";

/**
 * The staff tab set (Step 1). JS tabs with the custom floating bar: the
 * approved design is a custom bar on both platforms, and SDK 57's native
 * tabs are still `expo-router/unstable-native-tabs` — the plan locks JS tabs
 * until that settles.
 *
 * Role-aware: a destination exists only when its screen exists AND the
 * caller's permission hints allow it. Without an attendance grant the route
 * stays registered but leaves the bar (`href: null`), and the screen gates
 * itself anyway if reached by another path.
 */
export default function StaffTabsLayout() {
  const { hasAny } = usePermissions();
  const showAttendance = hasAny("attendance:read", "attendance:create");
  const showStudents = hasAny("student:read");
  const showHomework = hasAny("homework:read");
  // The fee desk needs a usable read: the dues list is the matrix
  // (`fee_report:read`), while assignment reads drive the desk. A caller with
  // only `fee_payment:read` (class teacher) has no student-bearing fee read,
  // so the tab would open onto a denial — it stays hidden instead.
  const showFees = hasAny("fee_report:read", "student_fee_assignment:read");

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: copy.nav.home,
          tabBarIcon: ({ color }) => (
            <AppIcon name="home" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: copy.nav.attendance,
          href: showAttendance ? undefined : null,
          tabBarIcon: ({ color }) => (
            <AppIcon name="attendance" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: copy.studentsTab.label,
          href: showStudents ? undefined : null,
          tabBarIcon: ({ color }) => (
            <AppIcon name="students" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="homework"
        options={{
          title: copy.nav.homework,
          href: showHomework ? undefined : null,
          tabBarIcon: ({ color }) => (
            <AppIcon name="homework" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="fees"
        options={{
          title: copy.nav.fees,
          href: showFees ? undefined : null,
          tabBarIcon: ({ color }) => (
            <AppIcon name="fees" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: copy.nav.more,
          tabBarIcon: ({ color }) => (
            <AppIcon name="more" color={color} size={22} />
          ),
        }}
      />
    </Tabs>
  );
}
