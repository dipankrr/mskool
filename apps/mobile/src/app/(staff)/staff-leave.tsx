import { useLocalSearchParams } from "expo-router";

import { StaffLeaveScreen } from "../../screens/staff/staff-leave";

/** Thin route (ADR-068); the screen lives in `screens/staff`. */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StaffLeaveScreen id={id} />;
}
