import { Redirect } from "expo-router";

import { FamilyFeesPreview } from "../family/screens/fees/preview";

/**
 * Dev-only: `mskool://family-fees-preview` shows family Fees on sample data,
 * one kind of account at a time. Release builds redirect home.
 */
export default function FamilyFeesPreviewRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <FamilyFeesPreview />;
}
