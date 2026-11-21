/**
 * The design check: the deterministic half of the design vocabulary.
 *
 * `impeccable` is vendored at `.agents/skills/impeccable/` and is a development
 * tool. Nothing here is imported by the app, and nothing in the app can reach it:
 * this module runs as `bun run design:check` and is never part of the bundle.
 *
 * Two things are this repository's to own, and they are the two things below:
 *
 * 1. **The allow-list.** The vendor's craft floor and this app's incumbent visual
 *    world genuinely disagree in one place, so a checked-in allow-list names each
 *    overridden rule with a one-line reason. An entry without a reason is a
 *    configuration error, not a pass: an unexplained suppression is how a rule
 *    set dies.
 * 2. **The refusal to call a missing detector a pass.** A tool that is not there
 *    exits non-zero and says so. The same is true of a finding: since the studio
 *    redesign landed this is a gate, so one un-suppressed violation fails the
 *    build. There is no stage flag to leave off — a check that can be advisory
 *    again is a check that can be skipped again.
 *
 * The rules themselves are the vendor's and are not restated here. They live in
 * the vendored skill and are versioned with it, so the two cannot drift.
 *
 * This file is outside the TypeScript project (`tsconfig.json` includes `src`
 * only) because it uses Node builtins and this project carries no `@types/node`.
 * Same discipline as `vite.config.ts`, which has its own project for the same
 * reason. Its behaviour is covered by `scripts/designCheck.test.ts`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** One finding as the detector reports it, in `--json` mode. */
export interface Finding {
  /** The rule id, e.g. `side-tab`. */
  readonly antipattern: string;
  readonly name: string;
  readonly description: string;
  readonly severity: string;
  readonly category: string;
  /** Absolute path, as the detector prints it. */
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

/** One rule this app's committed visual world overrides, and why. */
export interface AllowListEntry {
  readonly id: string;
  readonly reason: string;
}

export interface AllowList {
  readonly entries: readonly AllowListEntry[];
  /** Everything wrong with the file. Non-empty means the check fails. */
  readonly problems: readonly string[];
}

/**
 * Reads the checked-in allow-list.
 *
 * A suppression needs a named reason, and a rule needs suppressing once at most.
 * Both refusals are deliberate: the first is what stops the list becoming a
 * silent bin of things somebody did not want to look at, and the second stops two
 * reasons for the same rule from disagreeing about why the rule is overridden.
 */
export function parseAllowList(text: string): AllowList {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      entries: [],
      problems: [
        `the allow-list in scripts/design-allow-list.json is not readable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const rules = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) {
    return {
      entries: [],
      problems: ["the allow-list in scripts/design-allow-list.json has no `rules` array"],
    };
  }

  const entries: AllowListEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const [index, rule] of rules.entries()) {
    const id = typeof rule?.id === "string" ? rule.id.trim() : "";
    const reason = typeof rule?.reason === "string" ? rule.reason.trim() : "";

    if (!id) {
      problems.push(`allow-list entry ${index + 1} names no rule id`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`allow-list entry ${id} appears twice; keep one reason, not two`);
      continue;
    }
    if (!reason) {
      problems.push(`allow-list entry ${id} has no reason; an unexplained suppression is not allowed`);
      continue;
    }

    seen.add(id);
    entries.push({ id, reason });
  }

  return { entries, problems };
}

/** One rule violation this run is allowed to fail on. */
export interface Violation {
  /** Repo-relative, so two runs on two machines can be compared. */
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly name: string;
  readonly snippet: string;
}

/** An allow-listed rule that did fire, and the reason it may. */
export interface SuppressedRule {
  readonly id: string;
  readonly reason: string;
  readonly count: number;
}

export interface Report {
  readonly violations: readonly Violation[];
  readonly suppressed: readonly SuppressedRule[];
  /** Configuration errors. Any of these fails the check. */
  readonly problems: readonly string[];
}

export interface BuildReportInput {
  readonly findings: readonly Finding[];
  readonly allowList: readonly AllowListEntry[];
  /** The repository root that relative paths are taken from. */
  readonly root: string;
  readonly problems?: readonly string[];
}

/** Absolute path to a repo-relative one, with `/` separators on every platform. */
function relative(root: string, file: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return (file.startsWith(prefix) ? file.slice(prefix.length) : file).split("\\").join("/");
}

/**
 * Splits the detector's findings into what the check fails on and what the
 * committed visual world has allowed, keyed by rule so the reason is stated once.
 *
 * Ordering is imposed here rather than trusted from the detector: the report has
 * to be identical across two runs on unchanged input, and a stable order is what
 * makes a diff between two runs mean something changed.
 */
export function buildReport({ findings, allowList, root, problems = [] }: BuildReportInput): Report {
  const reasons = new Map(allowList.map((entry) => [entry.id, entry.reason]));
  const violations: Violation[] = [];
  const suppressedCounts = new Map<string, number>();

  for (const finding of findings) {
    if (reasons.has(finding.antipattern)) {
      suppressedCounts.set(finding.antipattern, (suppressedCounts.get(finding.antipattern) ?? 0) + 1);
      continue;
    }
    violations.push({
      file: relative(root, finding.file),
      line: finding.line,
      rule: finding.antipattern,
      name: finding.name,
      snippet: finding.snippet,
    });
  }

  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule) ||
      a.snippet.localeCompare(b.snippet),
  );

  const suppressed: SuppressedRule[] = [...suppressedCounts.entries()]
    .map(([id, count]) => ({ id, reason: reasons.get(id) ?? "", count }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { violations, suppressed, problems: [...problems] };
}

/**
 * The report a person reads.
 *
 * No timings, no absolute paths, no machine names: two runs on unchanged input
 * print the same bytes, which is what lets the same text be a check and evidence.
 *
 * The detector's own notes are carried through verbatim, under a caveat this
 * check always states: a source scan matches patterns rather than parsing a
 * rendered page, so a clean run is an undercount and never a clean bill of
 * health. The engine only prints that warning in its text mode, which is why the
 * report says it itself rather than relying on the engine's stderr.
 */
export function renderReport(report: Report, notes: readonly string[] = []): string {
  const lines: string[] = [];

  for (const problem of report.problems) {
    lines.push(`problem: ${problem}`);
  }

  lines.push(
    `${report.violations.length} design rule violation${report.violations.length === 1 ? "" : "s"}, ` +
      `${report.suppressed.reduce((total, rule) => total + rule.count, 0)} suppressed by the allow-list`,
  );

  for (const violation of report.violations) {
    lines.push(`  ${violation.file}:${violation.line}  [${violation.rule}] ${violation.snippet}`);
    lines.push(`    ${violation.name}`);
  }

  if (report.suppressed.length > 0) {
    lines.push("");
    lines.push("suppressed by this project's committed visual world:");
    for (const rule of report.suppressed) {
      lines.push(`  [${rule.id}] x${rule.count} — ${rule.reason}`);
    }
  }

  lines.push("");
  lines.push("detector notes:");
  lines.push(
    "  this check matches patterns in source files; rules that need a rendered page did not run, so it is an undercount rather than a clean bill of health.",
  );
  for (const note of notes) {
    lines.push(`  ${note}`);
  }

  lines.push("");
  lines.push(
    report.violations.length > 0
      ? "this check is a gate: the violations above fail the build. Fix them, or record in scripts/design-allow-list.json why this project's visual world overrides the rule."
      : "this check is a gate: any violation in a later run fails the build.",
  );

  return lines.join("\n");
}

/**
 * The exit code for one report.
 *
 * A configuration problem fails, because a check that cannot describe its own
 * suppressions is not a check. A violation fails too: that is the gate. The
 * redesign is finished and this is a wall, so there is deliberately no argument
 * that could turn the second refusal off.
 */
export function exitCodeFor(report: Report): number {
  return report.problems.length > 0 || report.violations.length > 0 ? 1 : 0;
}

/** What the engine exits with when it found something. */
const EXIT_FINDINGS = 2;
/** What the launcher exits with when it could not produce an engine. */
const EXIT_NO_ENGINE = 127;

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: { readonly code?: string } | null;
}

export type Spawn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => SpawnResult;

const defaultSpawn: Spawn = (command, args, options) => {
  const result = spawnSync(command, [...args], { cwd: options.cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? { code: (result.error as { code?: string }).code } : null,
  };
};

export type DetectorResult =
  | { readonly ok: true; readonly findings: readonly Finding[]; readonly notes: readonly string[] }
  | { readonly ok: false; readonly failure: string };

export interface RunDetectorInput {
  readonly launcher: string;
  readonly target: string;
  readonly cwd: string;
  readonly spawn?: Spawn;
}

/** Reads the detector's `--json` output. Throws when it is not a findings array. */
export function parseFindings(stdout: string): Finding[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("the design detector did not print a findings array");
  }
  return parsed as Finding[];
}

/**
 * Runs the detector over `target` and returns what it found, or why it could not
 * run at all.
 *
 * The distinction is the point. A missing engine, a failed download, a launcher
 * that is not there and a target that could not be scanned are all failures with
 * their own message, never an empty findings list: a tool that is not there is
 * never a pass.
 */
export function runDetector({ launcher, target, cwd, spawn }: RunDetectorInput): DetectorResult {
  const run: Spawn = spawn ?? defaultSpawn;

  const result = run(launcher, ["detect", "--json", target], { cwd });
  const detail = result.stderr.trim();

  if (result.error) {
    return {
      ok: false,
      failure: `the design detector cannot run: the launcher at ${launcher} could not be started (${result.error.code ?? "unknown error"})`,
    };
  }

  if (result.status === EXIT_NO_ENGINE) {
    return {
      ok: false,
      failure: `the design detector cannot run: the launcher exited 127, which means no engine was available${detail ? `\n${detail}` : ""}`,
    };
  }

  if (result.status === 1) {
    return {
      ok: false,
      failure: `the design detector could not scan ${target}${detail ? `\n${detail}` : ""}`,
    };
  }

  if (result.status !== 0 && result.status !== EXIT_FINDINGS) {
    return {
      ok: false,
      failure: `the design detector cannot run: the launcher exited ${String(result.status)}${detail ? `\n${detail}` : ""}`,
    };
  }

  try {
    return {
      ok: true,
      findings: parseFindings(result.stdout),
      notes: result.stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    };
  } catch (error) {
    return {
      ok: false,
      failure: `the design detector cannot run: its output was not readable (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
}

/** The rule ids the vendored detector carries, from `--list-rules --quiet`. */
export function parseRuleIds(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

type CatalogResult =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly failure: string };

/**
 * Asks the vendored detector which rules it carries.
 *
 * This is what keeps the allow-list honest without copying the rule tree: an
 * entry naming a rule the detector no longer has fails the check, so a renamed
 * rule cannot leave a suppression behind that suppresses nothing.
 */
function runRuleList(launcher: string, cwd: string, spawn: Spawn | undefined): CatalogResult {
  const run: Spawn = spawn ?? defaultSpawn;
  const result = run(launcher, ["detect", "--list-rules", "--quiet"], { cwd });
  const detail = result.stderr.trim();

  if (result.error) {
    return {
      ok: false,
      failure: `the design detector cannot run: the launcher at ${launcher} could not be started (${
        result.error.code ?? "unknown error"
      })`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      failure: `the design detector cannot run: the launcher exited ${String(
        result.status,
      )} while listing its rules${detail ? `\n${detail}` : ""}`,
    };
  }

  return { ok: true, ids: parseRuleIds(result.stdout) };
}

export interface CheckOptions {
  /** Repository root; the check runs and reports relative to it. */
  readonly root: string;
  readonly launcher: string;
  /** What the detector scans. The app's interface sources only. */
  readonly target?: string;
  /** The checked-in allow-list, when a caller supplies one instead of the file. */
  readonly allowList?: readonly AllowListEntry[];
  /** Where the checked-in allow-list lives, relative to the root. */
  readonly allowListPath?: string;
  readonly spawn?: Spawn;
}

export interface CheckResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The whole check: the rule catalog, the allow-list, the scan, the report.
 *
 * Order matters. The catalog and the allow-list are checked before the scan, so a
 * repository whose suppressions no longer match the vendored rules fails instead
 * of quietly passing with a stale reason on file. A violation then fails the run:
 * this is the gate, and `bun run build` and `bun run verify` both run it rather
 * than leaving it as a command to remember.
 */
export function runCheck({
  root,
  launcher,
  target = "src/",
  allowList,
  allowListPath = "scripts/design-allow-list.json",
  spawn,
}: CheckOptions): CheckResult {
  const problems: string[] = [];
  let entries: readonly AllowListEntry[] = allowList ?? [];

  if (!allowList) {
    let text: string;
    try {
      text = readFileSync(resolve(root, allowListPath), "utf8");
    } catch {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `the design check cannot run: no allow-list at ${allowListPath}`,
      };
    }
    const parsed = parseAllowList(text);
    problems.push(...parsed.problems);
    entries = parsed.entries;
  }

  const catalog = runRuleList(launcher, root, spawn);
  if (!catalog.ok) {
    return { exitCode: 1, stdout: "", stderr: catalog.failure };
  }
  const known = new Set(catalog.ids);
  for (const entry of entries) {
    if (!known.has(entry.id)) {
      problems.push(
        `allow-list entry ${entry.id} is not a rule the vendored detector carries; the rule was renamed or removed, and this suppression no longer suppresses anything`,
      );
    }
  }

  const scan = runDetector({ launcher, target, cwd: root, spawn });
  if (!scan.ok) {
    return { exitCode: 1, stdout: "", stderr: scan.failure };
  }

  const report = buildReport({ findings: scan.findings, allowList: entries, root, problems });
  return {
    exitCode: exitCodeFor(report),
    stdout: renderReport(report, scan.notes),
    stderr: "",
  };
}
