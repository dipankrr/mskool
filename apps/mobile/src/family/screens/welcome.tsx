import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Trans, useTranslation } from "react-i18next";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import type { LoginChoice } from "../../lib/login-choice";
import { Enter } from "../motion";
import { FamilyThemeProvider, useFamilyTheme } from "../theme";
import { FMascot, FText } from "../ui";

/** Bookie's drawing is 704 x 560. */
const MASCOT_ASPECT = 560 / 704;

/**
 * The first screen before sign-in (design: `docs/design/mobile/prototype/
 * welcome.html`, direction A). Bookie stands on a blue stage; two role cards
 * pick the sign-in form. Shown only while the phone has no saved choice.
 */
export function Welcome({ onChoose }: { onChoose: (choice: LoginChoice) => void }) {
  return (
    <FamilyThemeProvider>
      <Screen onChoose={onChoose} />
    </FamilyThemeProvider>
  );
}

function Screen({ onChoose }: { onChoose: (choice: LoginChoice) => void }) {
  const { t } = useTranslation(["auth", "common"]);
  const theme = useFamilyTheme();
  const w = theme.components.welcome;
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();

  // Short phones and large text both shrink Bookie, so the cards stay in view.
  const room = height / Math.max(1, fontScale);
  const mascot = room >= 800 ? w.mascot.tall : room >= 700 ? w.mascot.medium : w.mascot.short;
  const mascotHeight = Math.round(mascot * MASCOT_ASPECT);
  const above = Math.round(mascotHeight * w.mascotAbove);

  // The headline runs a size above the theme's display: it is the whole message here.
  const base = theme.text("display");
  const display = {
    ...base,
    fontSize: w.headline.size,
    lineHeight: Math.round(w.headline.size * (base.lineHeight / base.fontSize)),
    letterSpacing: w.headline.tracking,
  };
  const hand = {
    fontFamily: theme.components.hand.font,
    fontSize: Math.round(display.fontSize * 1.3),
  };

  return (
    <View
      testID="welcome"
      style={[styles.fill, { backgroundColor: theme.color.canvas, experimental_backgroundImage: w.wash }]}
    >
      <ScrollView contentContainerStyle={styles.grow} bounces={false} showsVerticalScrollIndicator={false}>
        <Enter
          style={{
            paddingTop: insets.top + theme.space.lg,
            paddingHorizontal: theme.space.xxl,
            gap: theme.space.md,
          }}
        >
          <FText variant="heading">{t("common:appName")}</FText>
          <View style={{ paddingTop: theme.space.xl }}>
            <View>
              <Text accessibilityRole="header" style={[display, { color: theme.color.ink }]}>
                <Trans t={t} i18nKey="auth:welcomeLineOne" components={{ hand: <Text style={hand} /> }} />
              </Text>
              <Text style={[display, { color: w.accent }]}>
                <Trans t={t} i18nKey="auth:welcomeLineTwo" components={{ hand: <Text style={hand} /> }} />
              </Text>
            </View>
            <FText variant="body" color="muted" style={[styles.sub, { marginTop: theme.space.md }]}>
              {t("auth:welcomeSub")}
            </FText>
          </View>
        </Enter>

        <View style={[styles.fill, { minHeight: above + theme.space.xxxl }]} />

        <View
          style={{
            backgroundColor: w.stage.bg,
            borderTopLeftRadius: w.stage.radius,
            borderTopRightRadius: w.stage.radius,
            paddingTop: mascotHeight - above + theme.space.xl,
            paddingHorizontal: theme.space.lg,
            // Clear of Android's nav bar even when the inset reads 0.
            paddingBottom: Math.max(insets.bottom, theme.space.xxl) + theme.space.huge,
          }}
        >
          <View pointerEvents="none" style={[styles.mascot, { top: -above }]}>
            <FMascot size={mascot} mood="happy" />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.bubble,
              {
                top: -above - theme.space.lg,
                right: theme.space.lg,
                backgroundColor: w.bubble.bg,
                borderRadius: w.bubble.radius,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.xs,
                transform: [{ rotate: w.bubble.tilt }],
              },
            ]}
          >
            <Text style={{ fontFamily: theme.components.hand.font, fontSize: 22, color: w.bubble.fg, paddingRight: theme.space.md }}>
              {t("auth:welcomeHello")}
            </Text>
          </View>

          <FText variant="caption" tint={w.stage.ask} style={[styles.upper, { marginBottom: theme.space.md }]}>
            {t("auth:welcomeAsk")}
          </FText>
          <View style={{ gap: theme.space.md }}>
            <RoleCard
              testID="welcome-family"
              icon="homework"
              look={w.card.family}
              title={t("auth:roleFamily")}
              body={t("auth:roleFamilyBody")}
              onPress={() => onChoose("family")}
            />
            <RoleCard
              testID="welcome-staff"
              icon="attendance"
              look={w.card.staff}
              title={t("auth:roleStaff")}
              body={t("auth:roleStaffBody")}
              onPress={() => onChoose("staff")}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** A light face on a darker edge; pressing pushes the face down onto it. */
function RoleCard({
  icon,
  look,
  title,
  body,
  onPress,
  testID,
}: {
  icon: AppIconName;
  look: { fg: string; bg: string };
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useFamilyTheme();
  const c = theme.components.welcome.card;
  return (
    <View
      style={{
        backgroundColor: c.edge,
        borderRadius: c.radius,
        paddingBottom: c.edgeHeight,
        boxShadow: c.shadow,
      }}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${body}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          {
            minHeight: c.minHeight,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.rim,
            experimental_backgroundImage: c.face,
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.md,
            gap: theme.space.md,
            transform: [{ translateY: pressed ? c.edgeHeight - 1 : 0 }],
          },
        ]}
      >
        <View
          style={[
            styles.center,
            { width: c.icon.size, height: c.icon.size, borderRadius: c.icon.radius, backgroundColor: look.bg },
          ]}
        >
          <AppIcon name={icon} size={24} color={look.fg} />
        </View>
        <View style={styles.text}>
          <FText variant="heading">{title}</FText>
          <FText variant="meta" color="muted">
            {body}
          </FText>
        </View>
        <View
          style={[
            styles.center,
            { width: c.go.size, height: c.go.size, borderRadius: c.go.size / 2, backgroundColor: c.go.bg },
          ]}
        >
          <AppIcon name="chevronRight" size={20} color={c.go.fg} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  sub: {
    maxWidth: 300,
  },
  mascot: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  bubble: {
    position: "absolute",
  },
  upper: {
    textTransform: "uppercase",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
