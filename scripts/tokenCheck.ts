/**
 * The colour-token gate: `bun run tokens:check`.
 *
 * Tailwind resolves a class at build time and says nothing when it cannot: a
 * class naming a colour the palette does not define is dropped from the output
 * sheet, and the element simply has no border. Nothing in `tsc`, vitest or the
 * design detector notices, and jsdom has no paint, so a hairline that was written
 * and never drew is invisible to every existing check. That is exactly what
 * `border-t border-line pt-4` did on the Clear panel.
 *
 * This is the gate for that one failure shape, and only that shape. It reads the
 * palette out of `src/index.css` — the one place this app defines a colour — and
 * then reads every `.ts`/`.tsx` file under `src/` looking for a class that starts
 * with `border` and names one. The colour list is not restated here: adding a
 * colour to the theme is the only way to widen what a border may name, and
 * `src/index.css` stays normative.
 *
 * What it deliberately does not do:
 *
 *   * It reads string literals and the text of template literals. Comments are
 *     never read, and prose on the screen is JSX text rather than a string, so a
 *     colour named where a person reads it is not a class and does not fire. A
 *     sentence inside a JavaScript string that contains a whitespace-delimited
 *     `border-word` token is indistinguishable from a class to any source scan,
 *     and this one will name it.
 *   * It does not resolve Tailwind. It knows this palette, so `border-white` —
 *     which Tailwind does define — is undefined here: gridline's palette is
 *     closed. Arbitrary values (`border-[#123456]`) are the escape hatch and are
 *     left alone.
 *   * It does not look for misspelled utilities of other kinds. `p-13` and
 *     `text-2x1` are a different gate's problem, not this one's.
 *   * It does not read test files. A test that asserts a defect is absent has to
 *     be able to name it — `expect(classes).not.toContain("border-line")` is the
 *     assertion this gate is the alternative to — and a test is not the
 *     interface the gate is protecting.
 *
 * It refuses to call a run it could not make a pass. A palette that is not there,
 * a palette that defines nothing, a target it cannot read and a target with no
 * source files in it all exit non-zero with the reason, the same way
 * `bun run design:check` refuses a missing engine. `bun run build` runs this
 * command, so a violation fails `bun run verify` rather than waiting to be run by
 * hand.
 *
 * Unlike `designCheck.ts` this needs no engine and no network: it is a file read
 * and a regular expression. That is why it is a script that `bun run build` calls
 * rather than a vitest suite — a build step is what stops a violation, and it is
 * still covered by `scripts/tokenCheck.test.ts`, which `bun run test` runs.
 *
 * This file is outside the TypeScript project (`tsconfig.json` includes `src`
 * only) because it uses Node builtins and this project carries no `@types/node`.
 * Same discipline as `scripts/designCheck.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** One class naming a border colour the palette does not define. */
export interface Offence {
  /** Repo-relative, with `/` separators, so two runs can be compared. */
  readonly file: string;
  readonly line: number;
  /** The class exactly as it was written, variants and opacity modifier included. */
  readonly className: string;
  /** The colour name it asked for, which is not in the palette. */
  readonly colour: string;
}

/** The same, before the file is known: what a scan of one source file found. */
export interface SourceOffence {
  readonly line: number;
  readonly className: string;
  readonly colour: string;
}

export interface Report {
  readonly palette: readonly string[];
  /** Where the palette came from, as reported to the reader. */
  readonly palettePath?: string;
  /** How many source files were read. A clean run reports this rather than silence. */
  readonly files: number;
  readonly violations: readonly Offence[];
  /** Why the run could not look. Any of these fails it. */
  readonly problems: readonly string[];
}

/**
 * Border sides. `border-t` is a width and `border-r-2` is a width; `border-t-line`
 * names a colour, so a side is stripped before the suffix is judged.
 */
const SIDE = "t|r|b|l|s|e|x|y";

/**
 * Suffixes of `border-` that are not colours: styles, table utilities, and the
 * palette-independent keywords Tailwind resolves without a theme.
 */
const NOT_A_COLOUR = new Set([
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "none",
  "current",
  "transparent",
  "inherit",
  "initial",
  "collapse",
  "separate",
]);

/** `border-spacing-*` is a table utility, not a colour. */
const TABLE_SPACING = "spacing";

/**
 * Reads the colours `src/index.css` defines.
 *
 * Every `--color-<name>:` declaration is a colour a class may name, wherever in
 * the file it sits: the `@theme` block defines them, and `:root` derives two of
 * them again from a runtime accent. A name defined twice is one colour.
 *
 * Comments are skipped first, so a colour mentioned in prose in the stylesheet is
 * not mistaken for a definition.
 */
export function parsePalette(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const colours: string[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    colours.push(name);
  }

  return colours;
}

interface Chunk {
  /** The literal text, with any `${…}` expression left out. */
  readonly text: string;
  /** Where in the file that text starts, so a line number can be counted. */
  readonly at: number;
}

/**
 * The text of every string literal and template literal in a source file.
 *
 * Comments are scanned past and never returned, which is what keeps a colour
 * mentioned in an explanation out of the report. A single- or double-quoted
 * literal that does not close before a line break is not a string at all — it is
 * an apostrophe in JSX prose — so it is dropped rather than swallowing the file.
 * Expressions inside `${…}` are code, and are read as code so that a class in
 * them is still found.
 */
export function stringChunks(source: string): Chunk[] {
  const chunks: Chunk[] = [];

  const push = (from: number, to: number) => {
    if (to > from) chunks.push({ text: source.slice(from, to), at: from });
  };

  const readQuote = (start: number, quote: string): number => {
    let j = start + 1;
    while (j < source.length) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "\n") return start + 1;
      if (c === quote) {
        push(start + 1, j);
        return j + 1;
      }
      j += 1;
    }
    return start + 1;
  };

  const readTemplate = (start: number): number => {
    let j = start + 1;
    let chunkStart = j;
    while (j < source.length) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") {
        push(chunkStart, j);
        return j + 1;
      }
      if (c === "$" && source[j + 1] === "{") {
        push(chunkStart, j);
        j = readCode(j + 2, true);
        chunkStart = j;
        continue;
      }
      j += 1;
    }
    push(chunkStart, j);
    return j;
  };

  const readCode = (start: number, stopAtBrace = false): number => {
    let j = start;
    let depth = 0;
    while (j < source.length) {
      const c = source[j];
      if (c === "/" && source[j + 1] === "/") {
        const newline = source.indexOf("\n", j);
        j = newline === -1 ? source.length : newline;
        continue;
      }
      if (c === "/" && source[j + 1] === "*") {
        const end = source.indexOf("*/", j + 2);
        j = end === -1 ? source.length : end + 2;
        continue;
      }
      if (c === "`") {
        j = readTemplate(j);
        continue;
      }
      if (c === '"' || c === "'") {
        j = readQuote(j, c);
        continue;
      }
      if (stopAtBrace) {
        if (c === "{") {
          depth += 1;
        } else if (c === "}") {
          if (depth === 0) return j + 1;
          depth -= 1;
        }
      }
      j += 1;
    }
    return j;
  };

  readCode(0);
  return chunks;
}

/** A class token without its variants: `hover:first:border-line` -> `border-line`. */
function withoutVariants(token: string): string {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i];
    if (c === "[") depth += 1;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) lastColon = i;
  }
  return token.slice(lastColon + 1);
}

/** Drops trailing characters that cannot be part of a utility name, e.g. `)` or `,`. */
function trimToken(token: string): string {
  return token.replace(/[^A-Za-z0-9_/\]]+$/, "").replace(/^!/, "");
}

/**
 * One class, if it names a border colour the palette does not define.
 *
 * The refusals are the contract. A width (`border-2`), a style (`border-none`), a
 * side alone (`border-t`, `border-r-2`), an arbitrary value (`border-[1px]`), an
 * opacity modifier over a real colour (`border-border/50`) and Tailwind's
 * palette-independent keywords all resolve to something that is not an undefined
 * colour, and none of them is a finding.
 */
export function classifyBorderClass(
  token: string,
  palette: ReadonlySet<string>,
): { className: string; colour: string } | null {
  const className = trimToken(token);
  const bare = withoutVariants(className);
  if (!bare.startsWith("border")) return null;

  // An arbitrary value is the escape hatch Tailwind gives on purpose.
  if (new RegExp(`^border(-(${SIDE}))?-\\[`).test(bare)) return null;

  const match = new RegExp(`^border(?:-(${SIDE}))?(?:-(.+))?$`).exec(bare);
  if (!match) return null;

  const rest = match[2];
  // `border`, `border-t`: a width, with no colour named at all.
  if (rest === undefined) return null;
  const colour = rest.split("/")[0];
  if (colour === "") return null;
  if (/^\d+(\.\d+)?$/.test(colour)) return null;
  if (NOT_A_COLOUR.has(colour)) return null;
  if (colour.startsWith(TABLE_SPACING)) return null;
  if (palette.has(colour)) return null;

  return { className, colour };
}

/** The line a byte offset sits on, counted from 1. */
function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Every class in one source file that names a border colour the palette does not
 * define, in the order they appear.
 */
export function findOffences(source: string, palette: readonly string[]): SourceOffence[] {
  const colours = new Set(palette);
  const offences: SourceOffence[] = [];

  for (const chunk of stringChunks(source)) {
    for (const match of chunk.text.matchAll(/\S+/g)) {
      const found = classifyBorderClass(match[0], colours);
      if (!found) continue;
      offences.push({
        line: lineAt(source, chunk.at + match.index),
        className: found.className,
        colour: found.colour,
      });
    }
  }

  return offences;
}

export interface CheckOptions {
  /** Repository root; the scan and the report are relative to it. */
  readonly root: string;
  /** What is scanned. The app's interface sources only. */
  readonly target?: string;
  /** Where the palette is defined, relative to the root. */
  readonly palettePath?: string;
}

export interface CheckResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Every interface source under `target`, repo-relative and sorted.
 *
 * Test files are left out on purpose: a test asserting that a bad class is gone
 * must be free to write the class down, and a test is not the interface. What the
 * gate protects is what ships.
 */
function collectSources(root: string, target: string): string[] {
  const files: string[] = [];
  const prefix = target.endsWith("/") ? target : `${target}/`;

  const walk = (relative: string) => {
    const entries = readdirSync(resolve(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const path = `${relative}${entry.name}`;
      if (entry.isDirectory()) {
        walk(`${path}/`);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
      files.push(path);
    }
  };

  walk(prefix);
  return files.sort();
}

/**
 * The report a person reads.
 *
 * No timings, no absolute paths, no machine names: two runs on unchanged input
 * print the same bytes. It states what was read, so a clean run is evidence
 * rather than silence, and it names the class and the place for anything it found.
 */
export function renderReport(report: Report, notes: readonly string[] = []): string {
  const palettePath = report.palettePath ?? "src/index.css";
  const violations = report.violations;
  const lines: string[] = [];

  for (const problem of report.problems) {
    lines.push(`problem: ${problem}`);
  }

  lines.push(
    `${violations.length} undefined border colour${violations.length === 1 ? "" : "s"} in ` +
      `${report.files} source file${report.files === 1 ? "" : "s"} ` +
      `(palette, from ${palettePath}: ${report.palette.join(", ") || "none"})`,
  );

  for (const violation of violations) {
    lines.push(`  ${violation.file}:${violation.line}  ${violation.className}`);
    lines.push(`    \`${violation.colour}\` is not a colour in ${palettePath}`);
  }

  lines.push("");
  lines.push("what this check does not do:");
  lines.push(
    "  it reads string and template literals, so a colour named in a comment or in prose on the screen is not a class and is not read.",
  );
  lines.push(
    "  it does not resolve Tailwind, so a colour outside the palette is undefined here even when Tailwind ships it; arbitrary values are left alone.",
  );
  lines.push("  it does not look for misspelled utilities of other kinds.");
  lines.push(
    "  it does not read test files: a test asserting a defect is absent must be able to name it, and a test is not the interface.",
  );
  for (const note of notes) {
    lines.push(`  ${note}`);
  }

  lines.push("");
  lines.push(
    violations.length > 0
      ? "this check is a gate: the classes above name a colour that does not exist and paint nothing, and they fail the build. Name a colour from the palette, or define it in src/index.css."
      : "this check is a gate: any undefined border colour in a later run fails the build.",
  );

  return lines.join("\n");
}

/** One report's exit code. A problem and a violation both fail; nothing else does. */
export function exitCodeFor(report: Report): number {
  return report.problems.length > 0 || report.violations.length > 0 ? 1 : 0;
}

/**
 * The whole check: the palette, the file list, the scan, the report.
 *
 * A palette that is not there or that defines nothing fails, because both would
 * otherwise turn into a report about every class in the app rather than about the
 * one that is wrong. A target that cannot be read fails, and so does a target
 * with no source files in it: a gate that looks at nothing has found nothing,
 * which is not the same as there being nothing to find.
 */
export function runCheck({ root, target = "src/", palettePath = "src/index.css" }: CheckOptions): CheckResult {
  let css: string;
  try {
    css = readFileSync(resolve(root, palettePath), "utf8");
  } catch {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `the token check cannot run: no palette at ${palettePath}`,
    };
  }

  const palette = parsePalette(css);
  if (palette.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `the token check cannot run: ${palettePath} defines no colours, so no border colour could be called defined`,
    };
  }

  let files: string[];
  try {
    files = collectSources(root, target);
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `the token check could not scan ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (files.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `the token check could not look: it found no source files under ${target}, and a gate that scans nothing is not a pass`,
    };
  }

  const problems: string[] = [];
  const violations: Offence[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(resolve(root, file), "utf8");
    } catch (error) {
      problems.push(
        `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const offence of findOffences(source, palette)) {
      violations.push({ file, line: offence.line, className: offence.className, colour: offence.colour });
    }
  }

  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.className.localeCompare(b.className),
  );

  const report: Report = { palette, palettePath, files: files.length, violations, problems };
  return { exitCode: exitCodeFor(report), stdout: renderReport(report), stderr: "" };
}
