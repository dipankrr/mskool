import { useMemo } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { fullName } from "../../lib/exams";
import { isoOf } from "../../lib/exam-results";
import { formatIsoDate } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { useClassCards, useClassResults } from "./use-results";
import { useExamScope } from "./use-exam-data";

/**
 * The class's card set (`cards.classSet`): every published card of the exam's
 * term beside the roster, in roll order. A student without a card prints an
 * honest "No card" row — the read cohorts on all enrollments (gap 24), so a
 * leaver can appear here without one. Tap renders that student's card.
 */
export function ClassCardsScreen() {
  const { examId = "", classId = "" } = useLocalSearchParams<{
    examId: string;
    classId: string;
  }>();
  const scope = useExamScope();
  const table = useClassResults(examId, classId);
  const cards = useClassCards(examId, classId);

  const rows = useMemo(() => {
    const byStudent = new Map(
      (cards.data?.cards ?? []).map((card) => [card.studentId, card]),
    );
    const roster = table.data?.roster ?? [];
    return roster.map((student) => ({
      student,
      card: byStudent.get(student.studentId) ?? null,
    }));
  }, [cards.data, table.data]);

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.cards.row}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-cards-back"
      titleTestID="exam-cards-title"
      onRefresh={() => void cards.refetch()}
      refreshing={cards.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canReadCards) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-cards-denied"
      />,
    );
  }

  if (!scope.ready || cards.isPending || table.isPending) {
    return frame(
      <View style={styles.body} testID="exam-cards-loading">
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (cards.isError) {
    return frame(
      <ErrorCard
        cause={cards.error}
        onRetry={() => void cards.refetch()}
        testID="exam-cards-error"
      />,
    );
  }

  if (rows.length === 0) {
    return frame(
      <EmptyState
        icon="grade"
        title={copy.exams.cards.noCard}
        message={copy.exams.cards.noCardBody}
        testID="exam-cards-empty"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Card padless testID="exam-cards-list">
        {rows.map(({ student, card }, index) => (
          <Pressable
            key={student.studentId}
            accessibilityRole={card ? "button" : "text"}
            accessibilityLabel={
              card
                ? `${fullName(student)}, ${copy.exams.cards.version(card.version)}`
                : `${fullName(student)}, ${copy.exams.cards.noCard}`
            }
            disabled={!card}
            onPress={() =>
              card &&
              router.push({
                pathname: "/exams/[examId]/class/[classId]/card/[studentId]",
                params: { examId, classId, studentId: student.studentId },
              })
            }
            style={({ pressed }) => [
              styles.row,
              index === 0 ? styles.rowFirst : null,
              pressed && card ? styles.rowPressed : null,
            ]}
            testID={`exam-cards-row-${student.studentId}`}
          >
            <View style={styles.nameBlock}>
              <ThemedText variant="bodyStrong" numberOfLines={1}>
                {fullName(student)}
              </ThemedText>
              <ThemedText variant="meta" color={colors.muted} numberOfLines={1}>
                {card
                  ? `${copy.exams.cards.version(card.version)} · ${copy.exams.cards.publishedOn(
                      formatIsoDate(isoOf(card.publishedAt)),
                    )}`
                  : copy.exams.cards.noCardBody}
              </ThemedText>
            </View>
            <ThemedText variant="bodyStrong" color={card ? colors.accentDeep : colors.chevron}>
              {card ? copy.exams.cards.version(card.version) : copy.exams.cards.noCard}
            </ThemedText>
          </Pressable>
        ))}
      </Card>
    </View>,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowFirst: {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
});
