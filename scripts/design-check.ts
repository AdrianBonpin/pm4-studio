/**
 * `bun run design:check` — the command, and nothing else.
 *
 * The work lives in `designCheck.ts` so it can be tested without an engine; this
 * file only names the vendored launcher, the target and the exit code.
 *
 * A missing detector is a failure, never a pass: if the launcher is absent, its
 * engine could not be fetched, or a requested target could not be scanned, this
 * exits non-zero with the reason. Violations are advisory for now, which is why a
 * red finding still exits 0 — the distinction between "found something" and
 * "could not look" is the whole point.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "./designCheck";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = resolve(root, ".agents/skills/impeccable/scripts/impeccable");

const result = runCheck({ root, launcher, target: "src/" });

if (result.stdout) process.stdout.write(`${result.stdout}\n`);
if (result.stderr) process.stderr.write(`${result.stderr}\n`);

process.exitCode = result.exitCode;
