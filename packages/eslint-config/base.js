// Flat ESLint config shared by every app/package.
// Each app's eslint.config.js just does: module.exports = require("@repo/eslint-config/base");
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Errors on purpose: stale-closure and missed-dependency bugs type-check
      // fine and are exactly what the UI milestone's dialog bugs were.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // The configs are CJS and lint themselves if not ignored — `require` and
    // `module` are undefined in the recommended configs' eyes.
    ignores: ["dist/**", ".next/**", "node_modules/**", "**/eslint.config.*"],
  },
];
