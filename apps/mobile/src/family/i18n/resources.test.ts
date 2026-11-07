jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { LANGUAGES, resources } from "./index";

/** Every leaf key path of a nested resource object. */
function keys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** Plural forms differ by language (`_one`/`_other`, `_few`…); compare the base key. */
function base(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, "");
}

describe("family language files", () => {
  const english = resources.en;

  it("every language has every English key, and no extras", () => {
    for (const language of LANGUAGES) {
      const files = (resources as Record<string, Record<string, unknown>>)[language.code];
      expect(files).toBeDefined();
      for (const [namespace, strings] of Object.entries(english)) {
        const expected = new Set(keys(strings).map(base));
        const actual = new Set(keys(files?.[namespace]).map(base));
        expect([...expected].filter((k) => !actual.has(k))).toEqual([]);
        expect([...actual].filter((k) => !expected.has(k))).toEqual([]);
      }
    }
  });

  it("no string is empty", () => {
    for (const [namespace, strings] of Object.entries(english)) {
      const empty = keys(strings).filter((key) => {
        const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], strings);
        return typeof value !== "string" || value.trim() === "";
      });
      expect({ namespace, empty }).toEqual({ namespace, empty: [] });
    }
  });
});
