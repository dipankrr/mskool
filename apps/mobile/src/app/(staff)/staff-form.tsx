import { useLocalSearchParams } from "expo-router";

import { StaffFormScreen } from "../../screens/staff/staff-form";

/** Thin route (ADR-068); `id` edits, no id adds. */
export default function Route() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <StaffFormScreen id={id} />;
}
