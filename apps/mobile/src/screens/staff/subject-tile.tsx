import { StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { fontFamily } from "../../theme/tokens";

/**
 * A subject's tile (ADR-068, owner kept the colours): a soft tint and an icon
 * or glyph, so a section's subjects read at a glance. Colour here means
 * "which subject", never status, and it only appears on subject tiles.
 */
type Look = { bg: string; fg: string; glyph?: string; icon?: AppIconName };

const LOOKS: { test: RegExp; look: Look }[] = [
  { test: /math/i, look: { bg: "#E6EEFF", fg: "#2556D9", glyph: "∑" } },
  { test: /english/i, look: { bg: "#EFEAFE", fg: "#6440D8", glyph: "Aa" } },
  { test: /hindi|sanskrit|bengali|bangla|marathi|tamil|telugu|urdu|odia|punjabi|gujarati|kannada|malayalam/i, look: { bg: "#FFEEDF", fg: "#C0550B", glyph: "अ" } },
  { test: /science|physics|chemistry|biology|evs|environment/i, look: { bg: "#E3F5F2", fg: "#0E8274", icon: "science" } },
  { test: /social|history|geography|civics|political|economics|sst/i, look: { bg: "#FDE9F1", fg: "#BE2F6E", icon: "globe" } },
  { test: /computer|ict|it\b|coding/i, look: { bg: "#E8ECFF", fg: "#3F3CC9", icon: "computer" } },
  { test: /art|drawing|craft/i, look: { bg: "#FBE8FB", fg: "#A62BB6", icon: "art" } },
  { test: /music|dance/i, look: { bg: "#FFF4D6", fg: "#9A6700", icon: "music" } },
  { test: /physical|sport|pe\b|games|yoga/i, look: { bg: "#E1F4FA", fg: "#0B7197", icon: "sport" } },
];

const FALLBACK: Look = { bg: colors.chip, fg: colors.muted };

export function subjectLook(name: string): Look {
  return LOOKS.find((entry) => entry.test.test(name))?.look ?? FALLBACK;
}

export function SubjectTile({ name, size = 40 }: { name: string; size?: number }) {
  const look = subjectLook(name);
  const letter = look.glyph ?? (look.icon ? undefined : name.trim().slice(0, 2));
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: look.bg },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {look.icon ? (
        <AppIcon name={look.icon} size={Math.round(size * 0.5)} color={look.fg} />
      ) : (
        <ThemedText
          variant="body"
          style={{ color: look.fg, fontFamily: fontFamily.bold, fontSize: Math.round(size * 0.38) }}
        >
          {letter}
        </ThemedText>
      )}
    </View>
  );
}

/** The class teacher's tile: the accent star. */
export function ClassTeacherTile({ size = 40, empty = false }: { size?: number; empty?: boolean }) {
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          backgroundColor: empty ? colors.surface : colors.accent,
        },
        empty ? styles.empty : null,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AppIcon
        name="star"
        size={Math.round(size * 0.48)}
        color={empty ? colors.tone.caution.fg : colors.onAccent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
  empty: { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.tone.caution.fg },
});
