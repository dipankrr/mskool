import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

const text = copy.homework.give;
/** How long the toast stays; Undo itself is judged by the server. */
const VISIBLE_MS = 8000;

/**
 * Frame 14: "Given to 6A and 6B" with Undo. Undo takes the homework back to a
 * draft, which the server allows only while no student has done anything.
 * A draft save shows the same toast without Undo.
 */
export function GivenToast({
  homeworkId,
  labels,
  draft,
  sectionId,
  subjectId,
  onDone,
}: {
  homeworkId: string;
  labels: string;
  draft: boolean;
  sectionId: string;
  subjectId: string;
  onDone: () => void;
}) {
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();
  const [message, setMessage] = useState(draft ? text.saved : text.given(labels));
  const [error, setError] = useState<string | null>(null);
  const undo = trpc.homework.undoGive.useMutation({
    onSuccess: () => {
      setMessage(text.undone);
      void utils.homework.home.invalidate();
    },
    onError: (cause) => setError(toFriendlyError(cause).message),
  });

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  useEffect(() => {
    if (undo.isPending) return;
    const timer = setTimeout(onDone, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [onDone, undo.isPending, message, error]);

  const canUndo = !draft && !undo.isSuccess;

  return (
    <View style={styles.toast} accessibilityLiveRegion="polite" testID="homework-toast">
      <ThemedText variant="bodyStrong" color={colors.onAccent} style={styles.grow} numberOfLines={2}>
        {error ?? message}
      </ThemedText>
      {canUndo ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            undo.mutate({
              organizationId: organizationId ?? "",
              id: homeworkId,
              sectionId,
              subjectId,
            })
          }
          disabled={undo.isPending}
          hitSlop={8}
          style={styles.undo}
          testID="homework-toast-undo"
        >
          <ThemedText variant="bodyStrong" color={colors.accentTint}>
            {undo.isPending ? copy.common.saving : text.undo}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  grow: {
    flex: 1,
  },
  undo: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
});
