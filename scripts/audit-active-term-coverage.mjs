#!/usr/bin/env node
// Run from any directory: node scripts/audit-active-term-coverage.mjs
// Optional: --metadata path/to/snapshot.json --output path/to/report.json
// Uses the installed esbuild; does not download packages or fetch schedules.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  entryPoints: [resolve(root, "scripts/audit-active-term-coverage.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
  define: { __AUDIT_ROOT__: JSON.stringify(root) },
});
try {
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
} catch (error) {
  // A data URL stack would dump the entire bundled application into the terminal.
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
}
