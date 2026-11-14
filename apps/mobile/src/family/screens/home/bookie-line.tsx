import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useFormat } from "../../i18n/format";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FHand, FMascot, FSkeleton, FText } from "../../ui";
import type { Home } from "./use-home";

/**
 * Bookie and one handwritten line about the evening. The face and the line
 * change as the list gets done; a new line fades in where the old one was.
 */
export function BookieLine({ home }: { home: Home }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const theme = useFamilyTheme();
  const h = theme.components.home;
  const { says, plan } = home;

  const line = t(`home.bookie.${says.line}`, { count: says.count ?? 0, subject: says.subject ?? "" });

  let sub: string | null = null;
  if (says.line === "bagNext" || says.line === "packBag") sub = t("home.sub.toPack", { count: plan.bagLeft });
  else if (says.line === "allSet" || says.line === "allSetTomorrow") sub = plan.bag.length > 0 ? t("home.sub.packed") : null;
  else if (says.line === "examTomorrow" || says.line === "examNext") {
    sub = plan.left > 0 ? t("home.sub.toRevise", { count: plan.left }) : null;
  } else if (plan.left > 0 && plan.minutes > 0) sub = t("home.sub.about", { time: format.duration(plan.minutes) });

  return (
    <View testID="home-bookie" style={[styles.row, { gap: theme.space.md, minHeight: Math.round(h.mascot * 0.8) }]}>
      <FMascot size={h.mascot} mood={says.mood} look="right" />
      <Reveal
        loading={!home.saysReady}
        placeholder={
          <View style={{ gap: theme.space.sm }}>
            <FSkeleton width="80%" height={28} />
            <FSkeleton width="50%" height={14} />
          </View>
        }
        style={styles.flex}
      >
        <Enter key={says.line + String(says.count ?? "")}>
          <View accessible accessibilityLabel={sub ? `${line} ${sub}` : line} style={{ gap: theme.space.xs }}>
            <FHand tone="info" size={h.hand}>
              {line}
            </FHand>
            {sub ? (
              <FText variant="meta" color="muted" style={{ paddingLeft: theme.space.sm }}>
                {sub}
              </FText>
            ) : null}
          </View>
        </Enter>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});
