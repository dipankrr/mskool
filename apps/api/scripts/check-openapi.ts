/**
 * Proves the OpenAPI document actually generates, and prints what is in it.
 *
 * Why this exists as a script rather than a test: generateOpenApiDocument()
 * throws at RUNTIME (missing .output(), duplicate path+method, a zod schema it
 * cannot represent as JSON Schema). `tsc --noEmit` is blind to all of it, so a
 * green check-types says nothing about whether /docs will load. Before this,
 * the only way to find out was to boot the server and open a browser.
 *
 *   pnpm --filter @repo/api check:openapi
 */
import { openApiDocument } from "../src/openapi";

const paths = openApiDocument.paths ?? {};

const rows = Object.entries(paths).flatMap(([path, item]) =>
  Object.entries(item ?? {})
    .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
    .map(([method, op]) => ({
      method: method.toUpperCase(),
      path,
      summary: (op as { summary?: string }).summary ?? "",
    })),
);

rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

console.log(`\n${openApiDocument.info.title} v${openApiDocument.info.version}`);
console.log(`${rows.length} documented endpoint(s):\n`);

for (const r of rows) {
  console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(32)} ${r.summary}`);
}

console.log("");

// A router with no documented endpoints means the meta silently failed to
// register — a passing exit code there would be worse than useless.
if (rows.length === 0) {
  console.error("No endpoints in the spec. Is .meta({ openapi }) present?");
  process.exit(1);
}
