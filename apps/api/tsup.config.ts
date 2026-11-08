import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  // No declaration emit: nothing imports @repo/api (web/mobile import the
  // AppRouter type from @repo/trpc), and the dts worker fails on TypeScript
  // 6's baseUrl deprecation, which would make every production build red.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  /**
   * Everything is bundled, including the workspace packages and their npm
   * dependencies, so `dist/index.mjs` is a self-contained server. Hostinger
   * deploys the whole Express root, but the workspace packages export raw
   * TypeScript; bundling keeps the runtime independent of that source layout
   * and makes the same artifact portable to other Node hosts.
   */
  noExternal: [/^(?!sharp$).*/],
  /**
   * sharp (ADR-063 image processing) ships a native binary per platform, which
   * cannot live inside a JS bundle. It stays a runtime import, resolved from
   * apps/api's own node_modules, which the host's build install provides.
   */
  external: ["sharp"],
  /**
   * Express and its CJS dependencies call require() lazily (depd, body-parser).
   * esbuild's ESM output stubs those out and throws "Dynamic require of ...
   * is not supported" at boot. Giving the bundle a real require() fixes it.
   */
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
