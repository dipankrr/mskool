const { withProjectBuildGradle } = require("expo/config-plugins");

/**
 * mskool — Android CMake/Ninja path-length fix for Windows hosts with MAX_PATH
 * enforcement on (LongPathsEnabled=0) and pnpm-deep node_modules trees.
 *
 * Why this is a plugin and not a comment in android/build.gradle: `android/`
 * is generated and gitignored. Without this plugin, `expo prebuild` silently
 * drops the fix and the Windows build breaks again with the same two
 * symptoms — ninja "manifest still dirty after 100 tries", and object paths
 * of ~370 chars that ninja cannot mkdir. Full record and probes:
 * `.kilo/plans/1791972469955-mobile-step0-foundation.md` → "Native build
 * resolution + device walk".
 *
 * The exact values matter (proven against cmake 3.22.1; 90 and 128 both fail):
 * - CMAKE_OBJECT_PATH_MAX=255 — CMake ignores limits below 128, refuses to
 *   shorten at all unless the limit is ABOVE the absolute object directory
 *   (~172 chars in this tree), caps shortened paths at the limit, and must
 *   stay ≤ 255 so ninja `.d` sidecars remain under Windows' 260.
 * - CMAKE_SUPPRESS_REGENERATION=ON — removes CMake's regenerated-manifest
 *   phony edge entirely; Gradle re-runs CMake configure when inputs change,
 *   so nothing is lost.
 *
 * Applied unconditionally (not Windows-gated): the arguments are valid CMake
 * everywhere, and a deterministic generated file beats platform-conditional
 * "works on my machine" drift. Registered in app.json → plugins.
 */
const MARKER = "mskool: CMake path-limit fix (with-cmake-path-limit)";

const GRADLE_INJECTION = `
// ${MARKER} — injected by plugins/with-cmake-path-limit.js on prebuild.
// Do not edit values here; edit the plugin. Rationale:
// .kilo/plans/1791972469955-mobile-step0-foundation.md.
subprojects { sp ->
  sp.plugins.withId('com.android.library') {
    sp.android.defaultConfig.externalNativeBuild.cmake {
      arguments.add('-DCMAKE_OBJECT_PATH_MAX=255')
      arguments.add('-DCMAKE_SUPPRESS_REGENERATION=ON')
    }
  }
  sp.plugins.withId('com.android.application') {
    sp.android.defaultConfig.externalNativeBuild.cmake {
      arguments.add('-DCMAKE_OBJECT_PATH_MAX=255')
      arguments.add('-DCMAKE_SUPPRESS_REGENERATION=ON')
    }
  }
}
`;

module.exports = function withCmakePathLimit(config) {
  return withProjectBuildGradle(config, (gradleConfig) => {
    const gradle = gradleConfig.modResults;
    if (gradle.language !== "groovy") {
      throw new Error(
        "with-cmake-path-limit: android/build.gradle is not Groovy — rewrite the injection.",
      );
    }
    if (!gradle.contents.includes(MARKER)) {
      gradle.contents += GRADLE_INJECTION;
    }
    return gradleConfig;
  });
};
