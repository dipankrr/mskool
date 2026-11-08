import { useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Avatar } from "../../components/avatar";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatDue } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

const text = copy.homework.comments;

/**
 * The class question board on one homework: students ask, the teacher
 * answers once for everyone. Private threads stay with each child (ADR-064).
 * Hold a message to remove it.
 */
export function HomeworkCommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();
  const [body, setBody] = useState("");
  const input = { organizationId: organizationId ?? "", id };

  const list = trpc.homework.comments.list.useQuery(input, { enabled: Boolean(organizationId && id) });
  const post = trpc.homework.comments.post.useMutation({
    onSuccess: (rows) => {
      setBody("");
      utils.homework.comments.list.setData(input, rows);
      void utils.homework.byId.invalidate();
    },
  });
  const remove = trpc.homework.comments.delete.useMutation({
    onSuccess: () => {
      void list.refetch();
      void utils.homework.byId.invalidate();
    },
  });

  const askRemove = (commentId: string) =>
    Alert.alert(text.removeTitle, undefined, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: text.remove,
        style: "destructive",
        onPress: () => remove.mutate({ organizationId: organizationId ?? "", id: commentId }),
      },
    ]);

  return (
    <ScreenFrame
      title={text.title}
      backAccessibilityLabel={copy.common.back}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      footer={
        <View style={styles.footer}>
          {post.isError ? <Notice tone="critical" message={toFriendlyError(post.error).message} /> : null}
          <View style={styles.composer}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={text.placeholder}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={2000}
              style={styles.input}
              testID="hw-comment-input"
            />
            <CapsuleButton
              title={text.send}
              size="compact"
              onPress={() => post.mutate({ ...input, body: body.trim() })}
              disabled={!body.trim() || post.isPending}
              loading={post.isPending}
              testID="hw-comment-send"
            />
          </View>
        </View>
      }
    >
      {list.isPending ? (
        <View style={styles.stack}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : list.isError ? (
        <ErrorCard cause={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon="comments" title={text.title} message={text.empty} />
      ) : (
        <View style={styles.stack}>
          {list.data.map((c) => (
            <Pressable
              key={c.id}
              onLongPress={() => askRemove(c.id)}
              accessibilityActions={[{ name: "longpress", label: text.remove }]}
              onAccessibilityAction={() => askRemove(c.id)}
              style={[styles.message, c.fromStaff ? styles.fromStaff : null]}
            >
              <Avatar name={c.authorName} />
              <View style={styles.grow}>
                <View style={styles.head}>
                  <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.grow}>
                    {c.authorName}
                  </ThemedText>
                  {c.fromStaff ? (
                    <View style={styles.tag}>
                      <ThemedText variant="caption" color={colors.accentDeep}>
                        {text.teacher}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText variant="body" selectable>
                  {c.body}
                </ThemedText>
                <ThemedText variant="caption">{formatDue(c.createdAt)}</ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm, marginTop: spacing.md },
  grow: { flex: 1, gap: spacing.xxs },
  footer: { gap: spacing.sm },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputLine,
    color: colors.ink,
  },
  message: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  fromStaff: { backgroundColor: colors.accentTint },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, backgroundColor: colors.surface },
});
