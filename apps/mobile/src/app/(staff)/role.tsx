import { useLocalSearchParams } from "expo-router";

import { RoleScreen } from "../../screens/roles/role-screen";

/** Thin route (frames R19-R24); the screen lives in `screens/roles`. */
export default function Route() {
  const { type } = useLocalSearchParams<{ type: string }>();
  return <RoleScreen type={type} />;
}
