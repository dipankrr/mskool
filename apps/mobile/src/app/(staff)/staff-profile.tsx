import { useLocalSearchParams } from "expo-router";

import { StaffProfileScreen } from "../../screens/staff/staff-profile";

/** Thin route (ADR-068); the screen lives in `screens/staff`. */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StaffProfileScreen id={id} />;
}
