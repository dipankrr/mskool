import { useLocalSearchParams } from "expo-router";

import { StaffHistoryScreen } from "../../screens/staff/staff-history";

/** Thin route (frame R16); the screen lives in `screens/staff`. */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StaffHistoryScreen id={id} />;
}
