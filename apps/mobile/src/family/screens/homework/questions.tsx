import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FErrorState, FHeader, FScreen, FSegment, FSkeleton, FText } from "../../ui";

type Board = "class" | "teacher";

/**
 * Questions on one homework: the class board (everyone in the class sees it)
 * and a thread with just the teacher. Teacher replies are blue and labelled;
 * the child's own messages sit on the right.
 */
export function FamilyHomeworkQuestions() {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const input = { studentId, studentAssignmentId: id ?? "" };
  const utils = trpc.useUtils();
  const [board, setBoard] = useState<Board>("class");
  const [body, setBody] = useState("");
  const list = trpc.portalHomework.comments.list.useQuery(input, { enabled: studentId.length > 0 && !!id });
  // Reading the board marks the teacher's messages read on the list and the homework page.
  const read = list.dataUpdatedAt;
  useEffect(() => {
    if (read > 0) {
      void utils.portalHomework.list.invalidate();
      void utils.portalHomework.get.invalidate(input);
    }
    // Once per fresh read; `input` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);
  const post = trpc.portalHomework.comments.post.useMutation({
    onSuccess: (rows) => {
      setBody("");
      utils.portalHomework.comments.list.setData(input, rows);
    },
  });
  const back = () => (router.canGoBack() ? router.back() : router.replace("/family/homework"));
  const header = <FHeader title={t("comments.title")} onBack={back} backLabel={t("detail.back")} />;
  const bubble = theme.components.homework.bubble;
  const shown = (list.data ?? []).filter((c) => (board === "class" ? c.studentAssignmentId === null : c.studentAssignmentId !== null));
  const field = theme.components.field;

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FScreen testID="family-homework-questions" header={header} refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
        <FSegment
          value={board}
          onChange={setBoard}
          options={[
            { key: "class", label: t("comments.class") },
            { key: "teacher", label: t("comments.teacher") },
          ]}
        />
        <FText variant="meta" color="muted">
          {board === "class" ? t("comments.classHint") : t("comments.teacherHint")}
        </FText>
        {list.isError && !list.data ? (
          <FErrorState onRetry={() => void list.refetch()} />
        ) : (
          <Reveal loading={list.isPending} placeholder={<FSkeleton height={64} radius="lg" />}>
            {shown.length === 0 ? (
              <FText variant="body" color="muted" align="center">
                {board === "class" ? t("comments.emptyClass") : t("comments.emptyTeacher")}
              </FText>
            ) : (
              <View style={{ gap: theme.space.md }}>
                {shown.map((c, i) => (
                  <Enter key={c.id} index={i} style={c.isMine ? styles.mine : styles.theirs}>
                    <View
                      style={{
                        maxWidth: "86%",
                        gap: 2,
                        paddingHorizontal: theme.space.lg,
                        paddingVertical: theme.space.md,
                        borderRadius: bubble.radius,
                        borderTopLeftRadius: c.isMine ? bubble.radius : bubble.corner,
                        borderTopRightRadius: c.isMine ? bubble.corner : bubble.radius,
                        backgroundColor: c.isMine ? bubble.mine : c.fromStaff ? bubble.teacher : bubble.other,
                      }}
                    >
                      <FText variant="caption" tint={c.isMine ? theme.color.faint : theme.color.muted}>
                        {c.isMine ? t("comments.you") : c.fromStaff ? t("comments.teacherTag", { name: c.authorName }) : c.authorName}
                      </FText>
                      <FText variant="body" tint={c.isMine ? bubble.mineFg : theme.color.ink} selectable>
                        {c.body}
                      </FText>
                    </View>
                  </Enter>
                ))}
              </View>
            )}
          </Reveal>
        )}
        {post.isError ? (
          <FText variant="meta" color="critical">
            {t("comments.failed")}
          </FText>
        ) : null}
        <View style={[styles.row, { gap: theme.space.sm }]}>
          <TextInput
            testID="hw-question-input"
            value={body}
            onChangeText={setBody}
            placeholder={t("comments.placeholder")}
            placeholderTextColor={field.placeholder}
            multiline
            maxLength={2000}
            accessibilityLabel={t("comments.placeholder")}
            style={[
              styles.input,
              theme.text("body"),
              {
                backgroundColor: field.bg,
                color: field.text,
                borderRadius: field.radius,
                paddingHorizontal: field.paddingX,
                paddingVertical: theme.space.md,
              },
            ]}
          />
          <Pressable
            testID="hw-question-send"
            accessibilityRole="button"
            accessibilityLabel={t("comments.send")}
            disabled={!body.trim() || post.isPending}
            onPress={() => post.mutate({ ...input, toClass: board === "class", body: body.trim() })}
            style={[
              styles.send,
              { backgroundColor: theme.color.accent, borderRadius: theme.radius.full, opacity: !body.trim() || post.isPending ? 0.45 : 1 },
            ]}
          >
            <AppIcon name="share" size={20} color={theme.color.onAccent} />
          </Pressable>
        </View>
      </FScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-end" },
  mine: { alignItems: "flex-end" },
  theirs: { alignItems: "flex-start" },
  input: { flex: 1, minHeight: 52, maxHeight: 140 },
  send: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
});
