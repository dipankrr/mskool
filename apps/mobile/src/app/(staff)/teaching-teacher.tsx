import { useLocalSearchParams } from "expo-router";

import { TeachingTeacherScreen } from "../../screens/teaching/teaching-teacher";

/** Thin route (ADR-068). */
export default function Route() {
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  return <TeachingTeacherScreen staffId={staffId} />;
}
