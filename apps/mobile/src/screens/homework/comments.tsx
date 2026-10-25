import { useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage, toFriendlyError } from "../../lib/errors";
import { clockOf, dayKeyOf, dayLabel } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { CommentRow } from "./types";

const MAX_COMMENT = 2000;

/**
 * The conversation attached to one homework.
 *
 * The server has two threads per assignment: the class-wide one
 * (`studentAssignmentId = null`) and one private thread per student. Calling
 * `comments.list` for a private thread also returns the class-wide comments, so
 * this screen filters to exactly the thread it opened — no class message can
 * leak into a family's thread, and no private message can appear on the class
 * board by accident.
 *
 * Replies are one level of visual indentation with a "Replying to" line for
 * deeper answers: the data is a tree, but the reading pattern stays a
 * conversation. Composer text is guarded by the unsaved-changes hook, and a
 * post only clears the box after the server confirms.
 */
export function HomeworkCommentsScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    saId?: string;
    name?: string;
  }>();
  const assignmentId = params.id ?? "";
  const studentAssignmentId = params.saId ?? null;
  const studentName = params.name ?? null;
  const isPrivate = Boolean(studentAssignmentId);

  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canComment = has("homework:comment");

  const utils = trpc.useUtils();
  const inputRef = useRef<TextInput>(null);

  const detail = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id: assignmentId },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignmentId),
    },
  );

  const comments = trpc.homework.comments.list.useQuery(
    {
      organizationId: organizationId ?? "",
      assignmentId,
      ...(studentAssignmentId ? { studentAssignmentId } : {}),
    },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignmentId),
    },
  );

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [posted, setPosted] = useState(false);
  const [postError, setPostError] = useState<unknown>(null);

  const dirty = canComment && body.trim().length > 0;
  useUnsavedChanges(dirty);

  const post = trpc.homework.comments.post.useMutation({
    onSuccess: async () => {
      setBody("");
      setReplyTo(null);
      setPostError(null);
      setPosted(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.homework.comments.list.invalidate();
    },
    onError: (error) => setPostError(error),
  });

  const assignment = detail.data ?? null;

  const rows = useMemo(() => {
    const all = comments.data ?? [];
    return all.filter((row) =>
      isPrivate
        ? row.studentAssignmentId === studentAssignmentId
        : row.studentAssignmentId === null,
    );
  }, [comments.data, isPrivate, studentAssignmentId]);

  const threads = useMemo(() => buildThreads(rows), [rows]);

  const text = copy.homework.comments;

  const meta = [
    isPrivate ? studentName : null,
    assignment?.title ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  const send = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setPostError(null);
    setPosted(false);
    post.mutate({
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      assignmentId,
      ...(studentAssignmentId ? { studentAssignmentId } : {}),
      ...(replyTo ? { parentCommentId: replyTo.id } : {}),
      body: trimmed,
    });
  };

  const focusComposer = () => inputRef.current?.focus();

  // A composer over a failed thread would promise a post the screen cannot
  // show; it appears only once the thread has actually loaded.
  const showComposer = canComment && comments.isSuccess && detail.isSuccess;

  const footer = canComment ? (    <View style={styles.composer}>
      {replyTo ? (
        <View style={styles.replyBanner}>
          <ThemedText variant="meta" numberOfLines={1} style={styles.replyText}>
            {text.replyingTo(replyTo.authorName || text.authorFallback)}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={text.cancelReply}
            hitSlop={8}
            onPress={() => setReplyTo(null)}
            style={({ pressed }) => [pressed ? styles.pressed : null]}
            testID="homework-comment-cancel-reply"
          >
            <AppIcon name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {postError ? (
        <Notice
          tone="critical"
          title={text.postError}
          message={errorMessage(postError)}
          testID="homework-comment-error"
        />
      ) : null}

      <View style={styles.inputWrap}>
        <TextInput
          ref={inputRef}
          value={body}
          onChangeText={(value) => {
            setBody(value);
            setPosted(false);
          }}
          placeholder={
            isPrivate
              ? text.composerPlaceholderPrivate
              : text.composerPlaceholderClass
          }
          placeholderTextColor={colors.muted}
          multiline
          maxLength={MAX_COMMENT}
          accessibilityLabel={text.composerLabel}
          accessibilityHint={text.composerHint}
          style={styles.input}
          testID="homework-comment-input"
        />
        <View style={styles.composerFoot}>
          <ThemedText variant="caption">
            {`${body.length}/${MAX_COMMENT}`}
          </ThemedText>
          <CapsuleButton
            title={post.isPending ? text.sending : text.send}
            icon="check"
            size="compact"
            onPress={send}
            loading={post.isPending}
            disabled={post.isPending || body.trim().length === 0}
            testID="homework-comment-send"
          />
        </View>
      </View>
    </View>
  ) : undefined;

  const frame = (children: React.ReactNode) => (
    <ScreenFrame
      title={isPrivate ? text.privateTitle : text.classTitle}
      meta={meta || null}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-comments-back"
      titleTestID="homework-comments-title"
      footer={showComposer ? footer : undefined}
      onRefresh={
        canRead
          ? () => {
              void comments.refetch();
              void detail.refetch();
            }
          : undefined
      }
      refreshing={comments.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={text.noAccessTitle}
        message={text.noAccessBody}
        testID="homework-comments-denied"
      />,
    );
  }

  if (!assignmentId) {
    return frame(
      <EmptyState
        icon="comments"
        title={text.notFoundTitle}
        message={text.notFoundBody}
        testID="homework-comments-missing"
      />,
    );
  }

  if (detail.isPending || comments.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={96} />
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={96} />
      </View>,
    );
  }

  if (detail.isError) {
    const friendly = toFriendlyError(detail.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="comments"
          title={text.notFoundTitle}
          message={text.notFoundBody}
          testID="homework-comments-not-found"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="homework-comments-detail-error"
      />,
    );
  }

  if (comments.isError) {
    const friendly = toFriendlyError(comments.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="comments"
          title={text.notFoundTitle}
          message={text.notFoundBody}
          testID="homework-comments-not-found"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={comments.error}
        onRetry={() => void comments.refetch()}
        testID="homework-comments-error"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Notice
        tone="neutral"
        message={isPrivate ? text.privateMeta : text.classMeta}
        testID="homework-comments-meta"
      />

      {!canComment ? (
        <Notice
          tone="caution"
          title={text.viewerTitle}
          message={text.viewerBody}
          testID="homework-comments-viewer"
        />
      ) : null}

      {posted ? (
        <Notice
          tone="positive"
          message={text.posted}
          testID="homework-comments-posted"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="comments"
          title={isPrivate ? text.emptyPrivateTitle : text.emptyClassTitle}
          message={isPrivate ? text.emptyPrivateBody : text.emptyClassBody}
          testID="homework-comments-empty"
        >
          {canComment ? (
            <CapsuleButton
              title={
                isPrivate ? text.emptyPrivateCta : text.emptyClassCta
              }
              icon="comments"
              size="compact"
              onPress={focusComposer}
              testID="homework-comments-start"
            />
          ) : null}
        </EmptyState>
      ) : (
        <>
          <ThemedText variant="meta">{text.count(rows.length)}</ThemedText>
          <View style={styles.threads}>
            {threads.map((thread) => (
              <View key={thread.root.id} style={styles.thread}>
                <CommentCard
                  comment={thread.root}
                  canComment={canComment}
                  onReply={() => {
                    setReplyTo(thread.root);
                    focusComposer();
                  }}
                />
                {thread.replies.length > 0 ? (
                  <View style={styles.replies}>
                    {thread.replies.map((reply) => (
                      <CommentCard
                        key={reply.row.id}
                        comment={reply.row}
                        parentName={reply.parentName}
                        parentDeleted={reply.parentDeleted}
                        reply
                        canComment={canComment}
                        onReply={() => {
                          setReplyTo(reply.row);
                          focusComposer();
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </>
      )}
    </View>,
  );
}

type ThreadReply = {
  row: CommentRow;
  parentName: string | null;
  parentDeleted: boolean;
};

function buildThreads(rows: readonly CommentRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));

  const rootOf = (row: CommentRow): string => {
    let current = row;
    const seen = new Set<string>([row.id]);
    while (current.parentCommentId) {
      const parent = byId.get(current.parentCommentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  };

  const roots = rows
    .filter((row) => {
      if (!row.parentCommentId) return true;
      return !byId.has(row.parentCommentId) || rootOf(row) === row.id;
    })
    .sort(byTime);

  const threads: { root: CommentRow; replies: ThreadReply[] }[] = roots.map(
    (root) => ({ root, replies: [] }),
  );
  const byRoot = new Map(threads.map((thread) => [thread.root.id, thread]));

  for (const row of [...rows].sort(byTime)) {
    if (row.parentCommentId === null) continue;
    const rootId = rootOf(row);
    if (rootId === row.id) continue;
    const parent = row.parentCommentId
      ? byId.get(row.parentCommentId)
      : undefined;
    const thread = byRoot.get(rootId);
    if (!thread) continue;
    thread.replies.push({
      row,
      parentName:
        parent && !parent.isDeleted && parent.id !== thread.root.id
          ? parent.authorName
          : null,
      parentDeleted: parent?.isDeleted ?? false,
    });
  }

  return threads;
}

function byTime(a: CommentRow, b: CommentRow): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "·";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function CommentCard({
  comment,
  parentName = null,
  parentDeleted = false,
  reply = false,
  canComment,
  onReply,
}: {
  comment: CommentRow;
  parentName?: string | null;
  parentDeleted?: boolean;
  reply?: boolean;
  canComment: boolean;
  onReply: () => void;
}) {
  const text = copy.homework.comments;
  const name = comment.authorName || text.authorFallback;
  const when = `${dayLabel(dayKeyOf(comment.createdAt))} · ${
    clockOf(comment.createdAt) ?? "—"
  }`;
  const role = comment.authorIsStaff ? text.teacher : text.student;

  return (
    <Card style={[styles.comment, reply ? styles.commentReply : null]}>
      <View style={styles.commentHead}>
        <View style={styles.avatar}>
          <ThemedText variant="caption" color={colors.accentDeep}>
            {initialsOf(name)}
          </ThemedText>
        </View>
        <View style={styles.byline}>
          <ThemedText variant="bodyStrong" numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText variant="caption" numberOfLines={1}>
            {`${role} · ${when}`}
          </ThemedText>
        </View>
        {canComment && !comment.isDeleted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${text.reply}, ${name}`}
            accessibilityHint={text.replyHint}
            hitSlop={8}
            onPress={onReply}
            style={({ pressed }) => [
              styles.replyButton,
              pressed ? styles.pressed : null,
            ]}
            testID={`homework-comment-reply-${comment.id}`}
          >
            <ThemedText variant="caption" color={colors.accentDeep}>
              {text.reply}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {parentName ? (
        <ThemedText variant="caption" color={colors.muted}>
          {text.replyingTo(parentName)}
        </ThemedText>
      ) : parentDeleted ? (
        <ThemedText variant="caption" color={colors.muted}>
          {text.deletedReply}
        </ThemedText>
      ) : null}

      {comment.isDeleted ? (
        <ThemedText variant="meta" style={styles.removed}>
          {text.removed}
        </ThemedText>
      ) : (
        <ThemedText variant="body" selectable style={styles.commentBody}>
          {comment.body}
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  threads: {
    gap: spacing.md,
  },
  thread: {
    gap: spacing.sm,
  },
  comment: {
    gap: spacing.xs,
  },
  commentReply: {
    padding: spacing.md,
  },
  commentHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  avatar: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  byline: {
    flex: 1,
    gap: spacing.xxs,
  },
  replyButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  commentBody: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  removed: {
    marginTop: spacing.xs,
    fontStyle: "italic",
  },
  replies: {
    gap: spacing.sm,
    marginLeft: spacing.xl,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentTint,
  },
  composer: {
    gap: spacing.xs,
  },
  replyBanner: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.sm,
    backgroundColor: colors.accentTint,
  },
  replyText: {
    flex: 1,
  },
  inputWrap: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: {
    minHeight: 44,
    maxHeight: 120,
    fontFamily: fontFamily.regular,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    color: colors.ink,
    fontSize: fontSize.callout,
    textAlignVertical: "top",
  },
  composerFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});
