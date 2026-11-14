import { Redirect } from "expo-router";

import { FamilyHomePreview } from "../family/screens/home/preview";

/**
 * Dev-only: `mskool://family-home-preview` shows family Home on sample data,
 * one kind of evening at a time. Release builds redirect home.
 */
export default function FamilyHomePreviewRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <FamilyHomePreview />;
}
