// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

/**
 * Family side guards (family screens plan, sections 2 and 5): every colour
 * and radius comes from `src/family/theme/`, and every visible string from
 * the language files. A redesign or a new language then never needs a
 * screen change.
 */
const familyFiles = ["src/family/**/*.{ts,tsx}", "src/app/family/**/*.{ts,tsx}"];
const familyTheme = ["src/family/theme/**"];
const familyTests = ["src/family/**/*.test.{ts,tsx}"];

const familyLookRules = [
  {
    selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
    message: "Family: colours come from src/family/theme, not hex literals.",
  },
  {
    selector: "Literal[value=/^rgba?\\(/]",
    message: "Family: colours come from src/family/theme, not rgb() literals.",
  },
  {
    selector: "Property[key.name=/^border(Top|Bottom)?(Left|Right|Start|End)?Radius$/][value.type='Literal']",
    message: "Family: radii come from src/family/theme (a component block or theme.radius).",
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: familyFiles,
    ignores: [...familyTheme, ...familyTests],
    rules: {
      "no-restricted-syntax": ["error", ...familyLookRules],
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true }],
    },
  },
]);
