/**
 * The family component kit. Family screens build ONLY from these (plus
 * `AppIcon`). Each component reads its look from its own block in
 * `family/theme/components.ts`, so a redesign happens one component at a
 * time without touching screens. Preview every component in every state on
 * the dev-only kit screen (`/family-kit`).
 */
export { FButton } from "./f-button";
export type { FButtonSize, FButtonVariant } from "./f-button";
export { FCard } from "./f-card";
export { FChildSwitcher } from "./f-child-switcher";
export type { FChild } from "./f-child-switcher";
export { FArrow, FHand } from "./f-hand";
export { FHeader } from "./f-header";
export { FMascot } from "./f-mascot";
export { FNote } from "./f-note";
export { FNumber } from "./f-number";
export { FPill } from "./f-pill";
export { FRow, FRowStack } from "./f-row";
export { FScreen } from "./f-screen";
export { FSegment } from "./f-segment";
export type { FSegmentOption } from "./f-segment";
export { FSheet } from "./f-sheet";
export { FSkeleton } from "./f-skeleton";
export { FStamp } from "./f-stamp";
export type { FStampTone } from "./f-stamp";
export { FEmptyState, FErrorState, FOfflineNote } from "./f-states";
export { FTabBar, FTabBarView, useFamilyTabBarSpace } from "./f-tab-bar";
export type { FTabItem } from "./f-tab-bar";
export { FText } from "./f-text";
export { FTextField } from "./f-text-field";
export type { TextColor } from "./f-text";
