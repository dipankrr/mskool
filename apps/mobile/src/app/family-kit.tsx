import { Redirect } from "expo-router";

import { FamilyKitScreen } from "../family/kit-screen";

/**
 * Dev-only: `mskool://family-kit` opens the family component showcase.
 * Release builds redirect home.
 */
export default function FamilyKitRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <FamilyKitScreen />;
}
