import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import "./i18n";
import { useFormat } from "./i18n/format";
import { FamilyThemeProvider, useFamilyTheme } from "./theme";
import {
  FButton,
  FCard,
  FChildSwitcher,
  FEmptyState,
  FErrorState,
  FHeader,
  FMascot,
  FNumber,
  FOfflineNote,
  FPill,
  FRow,
  FRowStack,
  FScreen,
  FSegment,
  FSheet,
  FSkeleton,
  FTabBarView,
  FText,
} from "./ui";
import { Enter, Reveal } from "./motion";

/**
 * Dev-only showcase of the family kit: every component in every state, so a
 * redesign of one component can be checked in one place. Not a product
 * screen; the route redirects away outside development builds.
 */
export function FamilyKitScreen() {
  return (
    <FamilyThemeProvider>
      <Kit />
    </FamilyThemeProvider>
  );
}

const CHILDREN = [
  { id: "a", name: "Aarav Sharma", detail: "Class 6 · A" },
  { id: "b", name: "Diya Sharma", detail: "Class 3 · B" },
];

function Kit() {
  const { t } = useTranslation("kit");
  const format = useFormat();
  const theme = useFamilyTheme();
  const [period, setPeriod] = useState<"month" | "term" | "year">("month");
  const [tab, setTab] = useState("attendance");
  const [replay, setReplay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [child, setChild] = useState("a");
  const selected = CHILDREN.find((c) => c.id === child) ?? CHILDREN[0]!;

  return (
    <FScreen
      testID="family-kit"
      header={
        <FHeader
          title={t("title")}
          context={
            <FChildSwitcher
              testID="kit-child"
              items={CHILDREN}
              selectedId={child}
              onSelect={setChild}
              line={t("childLine", { ns: "common", name: selected.name, detail: selected.detail })}
              sheetTitle={t("sample.sheetTitle")}
              switchHint={t("sample.sheetTitle")}
            />
          }
        />
      }
    >
      <FText variant="body" color="muted">
        {t("subtitle")}
      </FText>

      <Section title={t("sections.text")}>
        <FText variant="display">{t("sample.display")}</FText>
        <FText variant="title">{t("sample.title")}</FText>
        <FText variant="heading">{t("sample.heading")}</FText>
        <FText variant="body">{t("sample.body")}</FText>
        <FText variant="meta" color="muted">
          {t("sample.meta")}
        </FText>
        <FText variant="caption" color="muted">
          {t("sample.caption")}
        </FText>
      </Section>

      <Section title={t("sections.buttons")}>
        <FButton label={t("sample.primary")} icon="receipt" onPress={() => undefined} block />
        <View style={[styles.wrap, { gap: theme.space.sm }]}>
          <FButton label={t("sample.secondary")} variant="secondary" size="md" onPress={() => undefined} />
          <FButton label={t("sample.quiet")} variant="quiet" size="md" onPress={() => undefined} />
          <FButton label={t("sample.loading")} size="sm" loading onPress={() => undefined} />
          <FButton label={t("sample.disabled")} size="sm" disabled onPress={() => undefined} />
        </View>
      </Section>

      <Section title={t("sections.segment")}>
        <FSegment
          testID="kit-segment"
          value={period}
          onChange={setPeriod}
          options={[
            { key: "month", label: t("sample.month") },
            { key: "term", label: t("sample.term") },
            { key: "year", label: t("sample.year") },
          ]}
        />
      </Section>

      <Section title={t("sections.pills")}>
        <View style={[styles.wrap, { gap: theme.space.sm }]}>
          <FPill label={t("sample.present")} tone="positive" icon="check" />
          <FPill label={t("sample.late")} tone="caution" icon="clock" />
          <FPill label={t("sample.absent")} tone="critical" />
          <FPill label={t("sample.holiday")} tone="info" />
          <FPill label={t("sample.caption")} tone="neutral" />
        </View>
      </Section>

      <Section title={t("sections.rows")}>
        <FRowStack>
          {[0, 1, 2].map((index) => (
            <Enter key={`${index}-${replay}`} index={index}>
              <FRow
                title={t("sample.rowTitle")}
                subtitle={index === 2 ? t("sample.rowSubDown") : t("sample.rowSub")}
                subtitleTone={index === 2 ? "critical" : undefined}
                value={t("sample.rowValue")}
                onPress={index === 1 ? () => undefined : undefined}
              />
            </Enter>
          ))}
        </FRowStack>
        <FCard onPress={() => undefined} label={t("sample.cardTitle")}>
          <FText variant="heading">{t("sample.cardTitle")}</FText>
          <FText variant="body" color="muted">
            {t("sample.cardBody")}
          </FText>
        </FCard>
      </Section>

      <Section title={t("sections.numbers")}>
        <FNumber value={86.4} format={(n) => format.percent(n)} size="numberHero" replayKey={replay} />
        <FNumber value={125000} format={(n) => format.money(String(Math.round(n)))} replayKey={replay} />
        <FText variant="meta" color="muted">
          {t("sample.when", {
            date: format.date("2026-10-14", "weekdayDayMonth"),
            time: format.time("09:30:00"),
            duration: format.duration(90),
          })}
        </FText>
        <FButton label={t("sample.replay")} variant="secondary" size="sm" onPress={() => setReplay((n) => n + 1)} />
      </Section>

      <Section title={t("sections.states")}>
        <FButton
          label={t("sample.loading")}
          variant="secondary"
          size="sm"
          onPress={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1500);
          }}
        />
        <Reveal
          loading={loading}
          placeholder={
            <FRowStack>
              <FSkeleton height={72} radius="lg" />
              <FSkeleton height={72} radius="lg" />
            </FRowStack>
          }
        >
          <FRowStack>
            <FRow title={t("sample.rowTitle")} subtitle={t("sample.rowSub")} value={t("sample.rowValue")} />
            <FRow title={t("sample.rowTitle")} subtitle={t("sample.rowSub")} value={t("sample.rowValue")} />
          </FRowStack>
        </Reveal>
        <FOfflineNote />
        <FEmptyState title={t("sample.emptyTitle")} body={t("sample.emptyBody")} />
        <FErrorState onRetry={() => undefined} />
      </Section>

      <Section title={t("sections.mascot")}>
        <View style={[styles.wrap, { gap: theme.space.xl }]}>
          <FMascot size={72} />
          <FMascot size={72} mood="happy" />
          <FMascot size={72} look="left" animate={false} />
        </View>
      </Section>

      <Section title={t("sections.sheet")}>
        <FButton label={t("sample.openSheet")} variant="secondary" size="md" onPress={() => setSheet(true)} />
        <FSheet visible={sheet} onDismiss={() => setSheet(false)} title={t("sample.sheetTitle")}>
          <FText variant="body" color="muted">
            {t("sample.sheetBody")}
          </FText>
        </FSheet>
      </Section>

      <Section title={t("sections.tabBar")}>
        <FTabBarView
          activeKey={tab}
          onPress={setTab}
          items={[
            { key: "home", label: t("tabs.home"), icon: "home" },
            { key: "attendance", label: t("tabs.attendance"), icon: "calendar" },
            { key: "fees", label: t("tabs.fees"), icon: "fees" },
            { key: "exams", label: t("tabs.exams"), icon: "exams" },
          ]}
        />
      </Section>
    </FScreen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <FText variant="caption" color="muted">
        {title}
      </FText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
});
