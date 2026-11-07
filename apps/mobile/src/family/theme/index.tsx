import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { currentScript } from "../i18n";
import type { Script } from "../i18n";
import { components } from "./components";
import { fontFiles, lineHeightScale } from "./palette";
import { color, motion, radius, space, tone, touch, type } from "./roles";
import type { FontWeightName, TypeVariant } from "./roles";

/**
 * The family theme, read ONLY through `useFamilyTheme()`. Today it is one
 * static object; the hook is the seam for dark mode or a school's own colour
 * later, with no screen or component change.
 */
const baseTheme = { color, tone, space, radius, type, motion, touch, components } as const;

export type FamilyTheme = typeof baseTheme & {
  script: Script;
  /** The font file for a weight in the current language's script. */
  font: (weight: FontWeightName) => string;
  /** The full text style values for a variant in the current script. */
  text: (variant: TypeVariant) => {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
  };
};

function buildTheme(script: Script): FamilyTheme {
  const files = fontFiles[script];
  const leading = lineHeightScale[script];
  return {
    ...baseTheme,
    script,
    font: (weight) => files[weight],
    text: (variant) => {
      const spec = type[variant];
      return {
        fontFamily: files[spec.font],
        fontSize: spec.size,
        lineHeight: Math.round(spec.size * leading[spec.leading]),
        letterSpacing: spec.tracking,
      };
    },
  };
}

const ThemeContext = createContext<FamilyTheme | null>(null);

/** Mount once at the family shell's root; rebuilds on a language change. */
export function FamilyThemeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const script = currentScript(i18n.language);
  const theme = useMemo(() => buildTheme(script), [script]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

const fallback = buildTheme("latin");

export function useFamilyTheme(): FamilyTheme {
  return useContext(ThemeContext) ?? fallback;
}

export type { Tone, TypeVariant } from "./roles";
