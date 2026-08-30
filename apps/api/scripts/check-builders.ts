/**
 * Static guard for the builder surface (plan chunk A3).
 *
 *   pnpm --filter @repo/api check:builders
 *
 * After `publicProcedure` was deleted, an ungated procedure should be
 * UNCONSTRUCTIBLE from packages/trpc's exported surface. This script keeps it
 * that way: no router file may reference the bare `t.procedure` builder or a
 * deleted-export ghost of it.
 *
 * Why static and not runtime: a procedure's `_def` records its middleware as
 * anonymous functions and carries no trace of which builder created it, so
 * walking `appRouter._def.procedures` could only ever approximate provenance —
 * and only by importing `unstable-core-do-not-import`. A grep is dumber and
 * cannot lie.
 *
 * Scope is exactly `packages/trpc/src/routers/`. The one legitimate bare-builder
 * consumer (the health check) lives in trpc.ts itself beside the builders; if a
 * second ever appears, do not widen the allow-list — reopen the decision.
 */
import fs from "node:fs";
import path from "node:path";

// apps/api builds to CommonJS, so import.meta.url is unavailable and
// __dirname is the portable way to anchor the path to this script.
const routersDir = path.resolve(__dirname, "../../../packages/trpc/src/routers");

const PATTERNS: Array<[RegExp, string]> = [
  // Matches ANY `.procedure` access — `t.procedure`, `t2.procedure`, a local
  // initTRPC under any name. No router file ever legitimately touches a
  // builder's .procedure property: gated builders arrive ready-made from
  // ../trpc, so any hit is someone re-opening the ungated hole.
  [/\.\s*procedure\b/, "no bare builder access in routers/ — use staffProcedure/staffListProcedure/protectedProcedure"],
  [/\bpublicProcedure\b/, "publicProcedure was deleted (A3) — do not resurrect it"],
];

let failures = 0;

function scan(file: string) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [pattern, reason] of PATTERNS) {
      if (pattern.test(line)) {
        failures++;
        console.error(
          `FAIL ${path.relative(process.cwd(), file)}:${i + 1}\n` +
            `      ${line.trim()}\n      → ${reason}`,
        );
      }
    }
  });
}

/**
 * Second guard: the overlap gate is READS-only.
 *
 * ADR-028 made single-row reads ask whether the row is inside a grant — but
 * `gate: "overlap"` on a MUTATION would make every write permissive, the one
 * direction the decision forbids ("cover is mandatory for mutations" is
 * currently enforced by a comment in trpc.ts, and comments do not block
 * merges). Routers here are formulaic enough for a static check: from each
 * `gate: "overlap"` occurrence up to the next builder call, the chain must be
 * a query. A grep is dumber than introspection and cannot lie — same
 * reasoning as the builder scan above.
 */
function scanOverlapOnMutations(file: string) {
  const content = fs.readFileSync(file, "utf8");
  for (const match of content.matchAll(/gate:\s*"overlap"/g)) {
    const rest = content.slice(match.index!);
    const nextCall = ["staffProcedure(", "staffListProcedure("]
      .map((needle) => {
        const idx = rest.indexOf(needle, 10);
        return idx === -1 ? Number.POSITIVE_INFINITY : idx;
      })
      .reduce((a, b) => Math.min(a, b));

    // Everything from this option to the next builder call is ONE procedure
    // chain. A mutation anywhere in it means a write authorized permissively.
    if (/\.mutation\(/.test(rest.slice(0, nextCall))) {
      failures++;
      const lineNo = content.slice(0, match.index!).split(/\r?\n/).length;
      console.error(
        `FAIL ${path.relative(process.cwd(), file)}:${lineNo}\n` +
          `      ${match[0]}\n` +
          `      → gate: "overlap" on a mutation chain — writes must stay strict cover (ADR-028)`,
      );
    }
  }
}

/**
 * Third guard: subject-content writes compose the subjectGate (ADR-029).
 *
 * `can()` cannot see the subject axis — the scope tree has no subject node —
 * so a marks or homework write is authorized by TWO facts: the role grant
 * (the builders' permission gate) and an OPEN subject_teacher assignment. A
 * write procedure that names a gated permission without `{ subjectGate: true }`
 * ships the Phase-1 hole: the Physics teacher entering Chemistry marks. Same
 * grep philosophy as the guard above — from each gated permission literal to
 * the next builder call, the chain must carry the option. Comment lines are
 * stripped first so docstrings that MENTION the permission (the way the
 * subject router's explains the mechanism) do not trip it. The gated list is
 * imported from @repo/authz's PURE permissions module via its subpath export —
 * importing the trpc surface would drag the runtime graph (env validation,
 * Redis) into a guard that must stay hermetic for CI.
 */
import { SUBJECT_GATED_WRITES } from "@repo/authz/permissions";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanMissingSubjectGate(file: string) {
  const content = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\/\*|\*|\*\/)/.test(line))
    .join("\n");

  for (const permission of SUBJECT_GATED_WRITES) {
    const literal = new RegExp(escapeRegExp(`"${permission}"`), "g");
    for (const match of content.matchAll(literal)) {
      const rest = content.slice(match.index!);
      const nextCall = ["staffProcedure(", "staffListProcedure("]
        .map((needle) => {
          const idx = rest.indexOf(needle, 10);
          return idx === -1 ? Number.POSITIVE_INFINITY : idx;
        })
        .reduce((a, b) => Math.min(a, b));

      if (!/subjectGate:\s*true/.test(rest.slice(0, nextCall))) {
        failures++;
        const lineNo = content.slice(0, match.index!).split(/\r?\n/).length;
        console.error(
          `FAIL ${path.relative(process.cwd(), file)}:${lineNo}\n` +
            `      ${match[0]}\n` +
            `      → subject-content write without subjectGate: true — the scope tree cannot see subjects (ADR-029)`,
        );
      }
    }
  }
}

for (const entry of fs.readdirSync(routersDir, { recursive: true })) {
  const full = path.join(routersDir, entry.toString());
  if (full.endsWith(".ts")) {
    scan(full);
    scanOverlapOnMutations(full);
    scanMissingSubjectGate(full);
  }
}

if (failures > 0) {
  console.error(`\n${failures} builder-surface violation(s) under routers/.`);
  process.exit(1);
}

console.log(
  "check:builders — no ungated builders, no overlap-gated mutations, no subject-content writes without subjectGate under routers/.",
);
