import { useLocalSearchParams } from "expo-router";

import { EmptyState } from "../../components/empty-state";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { PhotoStartScreen } from "./photo-start";
import { PhotoWorkbenchScreen } from "./photo-workbench";

/**
 * Student photos (revamp 2026-11-09). One route, three faces: the start
 * screen (what's missing, per section), one section's photo grid
 * (`?sectionId=`), and photos named with admission numbers (`?mode=register`).
 * Photo day, the camera walk, is its own route. Every gate is a permission
 * string; the server re-checks each upload.
 */
export function StudentPhotosScreen() {
  const { sectionId, mode } = useLocalSearchParams<{ sectionId?: string; mode?: string }>();
  const { ready, organizationId, academicYear } = useActiveContext();
  const { has } = usePermissions();

  const gate = (body: React.ReactNode) => (
    <ScreenFrame title={copy.photos.title} backAccessibilityLabel={copy.common.back} titleTestID="photos-title">
      {body}
    </ScreenFrame>
  );

  if (!has("student:update") || !has("student:read")) {
    return gate(
      <EmptyState icon="shield" title={copy.photos.deniedTitle} message={copy.photos.deniedBody} testID="photos-denied" />,
    );
  }
  if (!ready || !organizationId) return gate(<Skeleton height={220} />);
  if (!academicYear) {
    return gate(
      <EmptyState
        icon="sessions"
        title={copy.photos.noSessionTitle}
        message={copy.photos.noSessionBody}
        testID="photos-no-session"
      />,
    );
  }
  if (mode === "register") return <PhotoWorkbenchScreen register />;
  if (sectionId) return <PhotoWorkbenchScreen key={sectionId} sectionId={sectionId} register={false} />;
  return <PhotoStartScreen />;
}
