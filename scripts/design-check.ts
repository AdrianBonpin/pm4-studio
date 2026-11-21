/**
 * `bun run design:check` — the command, and nothing else.
 *
 * The work lives in `designCheck.ts` so it can be tested without an engine; this
 * file only names the vendored launcher, the target and the exit code.
 *
 * This is a gate, not a notice. A violation exits non-zero, and so does a
 * detector that cannot look: if the launcher is absent, its engine could not be
 * fetched, or a requested target could not be scanned, this exits non-zero with
 * the reason. "Found something" and "could not look" are different failures, and
 * neither is a pass. `bun run build` and `bun run verify` run this command, so it
 * fails the build rather than waiting to be run by hand.
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
