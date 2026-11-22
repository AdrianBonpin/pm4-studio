/**
 * `bun run tokens:check` — the command, and nothing else.
 *
 * The work lives in `tokenCheck.ts` so it can be tested without a filesystem
 * fixture; this file only names the target, the palette and the exit code.
 *
 * This is a gate, not a notice. A class naming a border colour the palette does
 * not define exits non-zero, and so does a check that could not look: a missing
 * palette, a palette defining nothing, a target it could not read and a target
 * with no sources in it all fail with the reason. "Found something" and "could
 * not look" are different failures, and neither is a pass. `bun run build` runs
 * this command, so a violation fails `bun run verify` rather than waiting to be
 * run by hand.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "./tokenCheck";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = runCheck({ root, target: "src/", palettePath: "src/index.css" });

if (result.stdout) process.stdout.write(`${result.stdout}\n`);
if (result.stderr) process.stderr.write(`${result.stderr}\n`);

process.exitCode = result.exitCode;
