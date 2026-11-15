import { View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { isEntryOpen, sortExams } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import { stageLabel } from "../exams/meta";
import { useExamList, useExamScope } from "../exams/use-exam-data";
import { AreaIcon, HomeCard, Pill, SectionHead, homeStyles } from "./ui";

/**
 * Home's Exams part for people who don't teach a subject pair (a teacher's
 * own papers show in "You teach" instead): the exams open for marks right
 * now, one tap from each exam's hub.
 *
 * It exists only when it has something to say; a failed read leaves it out
 * and the full list stays one tap away. Gated on both seeing an exam
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
      <SectionHead title={copy.home.exams} area="exams" icon="exams" link={copy.home.examsLink} onLink={() => router.push("/exams")} />
      <HomeCard padless>
        {open.map((row, index) => (
          <View key={row.id}>
            {index > 0 ? <View style={homeStyles.divider} /> : null}
            <HomeCard
              padless
              style={{ boxShadow: "none", borderRadius: 0 }}
              onPress={() => router.push({ pathname: "/exams/[examId]", params: { examId: row.id } })}
              accessibilityLabel={`${row.name}, ${row.termName}`}
              testID={`home-open-exam-${row.id}`}
            >
              <View style={homeStyles.rowLine}>
                <AreaIcon area="exams" icon="exams" size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText style={homeStyles.rowTitle} numberOfLines={1}>
                    {row.name}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {`${row.termName} · ${copy.exams.home.open}`}
                  </ThemedText>
                </View>
                <Pill text={stageLabel(row.status)} tone="exams" />
                <AppIcon name="chevronRight" size={16} color={colors.chevron} />
              </View>
            </HomeCard>
          </View>
        ))}
      </HomeCard>
    </View>
  );
}
