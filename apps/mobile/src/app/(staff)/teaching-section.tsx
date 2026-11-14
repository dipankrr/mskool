import { useLocalSearchParams } from "expo-router";

import { TeachingSectionScreen } from "../../screens/teaching/teaching-section";

/** Thin route (ADR-068). */
export default function Route() {
  const { sectionId } = useLocalSearchParams<{ sectionId: string }>();
  return <TeachingSectionScreen sectionId={sectionId} />;
}
