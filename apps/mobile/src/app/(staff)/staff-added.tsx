import { useLocalSearchParams } from "expo-router";

import { StaffAddedScreen } from "../../screens/staff/staff-added";

/** Thin route (ADR-068); the screen lives in `screens/staff`. */
export default function Route() {
  const { id, failed } = useLocalSearchParams<{ id: string; failed?: string }>();
  return <StaffAddedScreen id={id} failed={failed} />;
}
