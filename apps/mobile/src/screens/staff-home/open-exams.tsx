import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { EntityCard } from "../../components/entity-card";
import { SectionLabel } from "../../components/section-label";
import { copy } from "../../lib/copy";
import { isEntryOpen, sortExams } from "../../lib/exams";
import { spacing } from "../../theme/tokens";
import { stageLabel, stageTone } from "../exams/meta";
import { useExamList, useExamScope } from "../exams/use-exam-data";

/**
 * "Marks to enter" on Home: the exams that are open for marks right now, one
 * tap from the hub where the caller's own papers are pinned first.
 *
 * It exists only when it has something to say. A secondary card that shows a
 * skeleton, an empty state or an error on every Home visit is noise for the
 * many days nothing is open; a failed read simply leaves the card out, and the
 * full list stays one tap away in More. Gated on both grants: seeing an exam
 * (`exam:read`) and typing into one (`marks:create`).
 */
export function OpenExamsCard() {
  const scope = useExamScope();
  const list = useExamList();

  if (!scope.canRead || !scope.canEnter) return null;

  const open = sortExams((list.data ?? []).filter((row) => isEntryOpen(row.status))).slice(0, 3);
  if (open.length === 0) return null;

  return (
    <View testID="home-open-exams">
      <SectionLabel>{copy.exams.home.title}</SectionLabel>
      <View style={styles.cards}>
        {open.map((row) => (
          <EntityCard
            key={row.id}
            title={row.name}
            meta={`${row.termName} · ${copy.exams.home.open}`}
            icon="exams"
            emphasis="accent"
            status={{ label: stageLabel(row.status), tone: stageTone(row.status) }}
            onPress={() =>
              router.push({
                pathname: "/exams/[examId]",
                params: { examId: row.id },
              })
            }
            accessibilityHint={copy.exams.home.hint}
            testID={`home-open-exam-${row.id}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
});
