import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  exitCodeFor,
  parseAllowList,
  parseFindings,
  parseRuleIds,
  renderReport,
  runCheck,
  runDetector,
  type Finding,
  type SpawnResult,
} from "./designCheck";

/**
 * The design check: the deterministic half of the design vocabulary.
 *
 * These tests hold the contract of `bun run design:check`, not the vendor's rule
 * set. The rules belong to the vendored skill and are versioned there; what this
 * repository owns is the allow-list, the report, and the refusal to report a
 * missing detector as a pass.
 *
 * The detector itself is a self-contained binary that is downloaded once on a
 * developer machine, so nothing here starts it. The seam is the boundary the
 * script talks to: the command it would run is injected, and every test below
 * answers as that boundary. What the real run produces is reported in the ticket,
 * not asserted here, because an assertion on today's violation count would fail
 * the first time somebody fixes a component.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function finding(over: Partial<Finding> = {}): Finding {
  return {
    antipattern: "side-tab",
    name: "Side-tab accent border",
    description: "A bar down one side of a rounded box.",
    severity: "warning",
    category: "slop",
    file: resolve(repoRoot, "src/components/Example.tsx"),
    line: 12,
    snippet: "border-l-4",
    ...over,
  };
}

describe("the allow-list", () => {
  it("refuses an entry that carries no reason", () => {
    const parsed = parseAllowList(
      JSON.stringify({ rules: [{ id: "side-tab" }, { id: "nested-cards", reason: "  " }] }),
    );

    expect(parsed.entries).toEqual([]);
    // Both entries are named, so the message says which entries to fix rather
    // than only that something is wrong.
    expect(parsed.problems.join("\n")).toContain("side-tab");
    expect(parsed.problems.join("\n")).toContain("nested-cards");
    expect(parsed.problems.join("\n")).toContain("reason");
  });

  it("refuses the same rule twice", () => {
    const parsed = parseAllowList(
      JSON.stringify({
        rules: [
          { id: "side-tab", reason: "the first reason" },
          { id: "side-tab", reason: "the second reason" },
        ],
      }),
    );

    expect(parsed.problems.join("\n")).toContain("side-tab");
    expect(parsed.problems.join("\n")).toContain("twice");
  });

  it("keeps an entry that carries a reason", () => {
    const parsed = parseAllowList(
      JSON.stringify({ rules: [{ id: "design-system-font", reason: "gridline sets Space Mono on headings" }] }),
    );

    expect(parsed.entries).toEqual([
      { id: "design-system-font", reason: "gridline sets Space Mono on headings" },
    ]);
    expect(parsed.problems).toEqual([]);
  });

  it("reports unreadable JSON as a problem rather than throwing", () => {
    const parsed = parseAllowList("{ not json");

    expect(parsed.entries).toEqual([]);
    expect(parsed.problems.join("\n")).toContain("allow-list");
  });

  it("parses the checked-in allow-list", () => {
    const text = readFileSync(resolve(repoRoot, "scripts/design-allow-list.json"), "utf8");
    const parsed = parseAllowList(text);

    // An unexplained suppression is how a rule set dies, so a checked-in entry
    // without a reason has to fail here rather than be discovered in review.
    expect(parsed.problems).toEqual([]);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });
});

describe("the report", () => {
  it("counts an allow-listed rule as suppressed, with its reason", () => {
    const report = buildReport({
      findings: [finding({ antipattern: "design-system-font", snippet: "font-heading" })],
      allowList: [{ id: "design-system-font", reason: "gridline sets Space Mono on headings" }],
      root: repoRoot,
    });

    expect(report.violations).toEqual([]);
    expect(report.suppressed).toEqual([
      { id: "design-system-font", reason: "gridline sets Space Mono on headings", count: 1 },
    ]);
  });

  it("reports a rule that is not allow-listed as a violation, in repo-relative paths", () => {
    const report = buildReport({ findings: [finding()], allowList: [], root: repoRoot });

    expect(report.suppressed).toEqual([]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].file).toBe("src/components/Example.tsx");
    expect(report.violations[0].rule).toBe("side-tab");
    expect(report.violations[0].line).toBe(12);
  });

  it("prints the same report whatever order the detector lists findings in", () => {
    const findings = [
      finding({ file: resolve(repoRoot, "src/b.tsx"), line: 4, antipattern: "side-tab" }),
      finding({ file: resolve(repoRoot, "src/a.tsx"), line: 9, antipattern: "nested-cards" }),
      finding({ file: resolve(repoRoot, "src/a.tsx"), line: 2, antipattern: "side-tab" }),
    ];

    const forward = renderReport(buildReport({ findings, allowList: [], root: repoRoot }));
    const backward = renderReport(
      buildReport({ findings: [...findings].reverse(), allowList: [], root: repoRoot }),
    );

    expect(backward).toBe(forward);
    // Sorted by file, then line: a diff between two runs has to mean a change.
    expect(forward.indexOf("src/a.tsx:2")).toBeLessThan(forward.indexOf("src/a.tsx:9"));
    expect(forward.indexOf("src/a.tsx:9")).toBeLessThan(forward.indexOf("src/b.tsx:4"));
  });

  it("says the check is advisory while the redesign is in progress", () => {
    const report = buildReport({ findings: [finding()], allowList: [], root: repoRoot });

    expect(renderReport(report)).toContain("advisory");
  });
});

describe("the detector boundary", () => {
  it("fails when the engine is not there, instead of reporting a pass", () => {
    const result = runDetector({
      launcher: resolve(repoRoot, ".agents/skills/impeccable/scripts/impeccable"),
      target: "src/",
      cwd: repoRoot,
      spawn: () => ({ status: null, stdout: "", stderr: "", error: { code: "ENOENT" } }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toContain("cannot run");
  });

  it("fails when the launcher could not fetch its engine", () => {
    const result = runDetector({
      launcher: "/nonexistent/impeccable",
      target: "src/",
      cwd: repoRoot,
      spawn: () => ({ status: 127, stdout: "", stderr: "impeccable: no checksum for engine\n" }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toContain("cannot run");
    expect(result.failure).toContain("127");
  });

  it("fails when the target could not be scanned", () => {
    const result = runDetector({
      launcher: "/bin/true",
      target: "src/",
      cwd: repoRoot,
      spawn: () => ({ status: 1, stdout: "", stderr: "" }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toContain("could not scan");
  });

  it("asks for JSON and the project's own design system", () => {
    let seen: string[] = [];
    runDetector({
      launcher: "/bin/true",
      target: "src/",
      cwd: repoRoot,
      spawn: (_cmd, args) => {
        seen = args;
        return { status: 0, stdout: "[]", stderr: "" };
      },
    });

    expect(seen).toContain("detect");
    expect(seen).toContain("--json");
    expect(seen).toContain("src/");
    // The project's DESIGN.md is what makes the design-system rules speak about
    // this app rather than a generic one, so the scan must not disable it.
    expect(seen).not.toContain("--no-config");
    expect(seen).not.toContain("--no-design-system");
  });

  it("reads the findings the engine printed", () => {
    const result = runDetector({
      launcher: "/bin/true",
      target: "src/",
      cwd: repoRoot,
      spawn: () => ({ status: 2, stdout: JSON.stringify([finding()]), stderr: "" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exit 2 is findings, not failure: the engine said the scan itself worked.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].antipattern).toBe("side-tab");
  });

  it("treats unreadable detector output as a failure to run", () => {
    const result = runDetector({
      launcher: "/bin/true",
      target: "src/",
      cwd: repoRoot,
      spawn: () => ({ status: 0, stdout: "not json", stderr: "" }),
    });

    expect(result.ok).toBe(false);
  });
});

describe("parseFindings", () => {
  it("rejects output that is not a findings array", () => {
    expect(() => parseFindings('{"findings":[]}')).toThrow();
    expect(() => parseFindings("[]")).not.toThrow();
  });
});

describe("the exit code", () => {
  const clean = buildReport({ findings: [], allowList: [], root: repoRoot });
  const dirty = buildReport({ findings: [finding()], allowList: [], root: repoRoot });

  it("passes a clean tree", () => {
    expect(exitCodeFor(clean, { blocking: false })).toBe(0);
    expect(exitCodeFor(clean, { blocking: true })).toBe(0);
  });

  it("reports violations without failing the build while advisory", () => {
    expect(exitCodeFor(dirty, { blocking: false })).toBe(0);
    expect(exitCodeFor(dirty, { blocking: true })).toBe(1);
  });

  it("fails a broken allow-list at any stage", () => {
    const broken = buildReport({
      findings: [],
      allowList: [],
      root: repoRoot,
      problems: ["allow-list entry design-system-font has no reason"],
    });

    expect(exitCodeFor(broken, { blocking: false })).toBe(1);
  });
});

describe("the rule catalog", () => {
  it("reads the ids the vendored detector reports", () => {
    expect(parseRuleIds("side-tab\n\n# a note\nflat-type-hierarchy\n")).toEqual([
      "side-tab",
      "flat-type-hierarchy",
    ]);
  });
});

/** A fake engine: the two commands the check runs, answered from the test. */
function engine({
  rules = ["side-tab", "flat-type-hierarchy", "undersized-ui-text"],
  findings = [],
  notes = "",
  scanStatus = findings.length > 0 ? 2 : 0,
}: {
  rules?: string[];
  findings?: Finding[];
  notes?: string;
  scanStatus?: number | null;
} = {}) {
  return (command: string, args: readonly string[]): SpawnResult => {
    void command;
    if (args.includes("--list-rules")) {
      return { status: 0, stdout: rules.join("\n"), stderr: "" };
    }
    return { status: scanStatus, stdout: JSON.stringify(findings), stderr: notes };
  };
}

describe("the check", () => {
  const options = { root: repoRoot, launcher: "/bin/true" };

  it("passes a clean tree", () => {
    const result = runCheck({ ...options, spawn: engine() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("0 design rule violations");
  });

  it("reports violations without failing the build while advisory", () => {
    const result = runCheck({ ...options, spawn: engine({ findings: [finding()] }) });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 design rule violation");
    expect(result.stdout).toContain("src/components/Example.tsx:12");
  });

  it("fails when an allow-list entry names a rule the detector does not have", () => {
    // The rule tree is not copied into this repository, so an allow-list entry
    // can go stale when the vendor renames a rule. A suppression that no longer
    // matches anything is a suppression nobody is checking.
    const result = runCheck({
      ...options,
      allowList: [{ id: "a-rule-that-was-renamed", reason: "kept from an older version" }],
      spawn: engine(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("a-rule-that-was-renamed");
  });

  it("fails loudly when the detector cannot run", () => {
    const result = runCheck({
      ...options,
      spawn: () => ({ status: 127, stdout: "", stderr: "impeccable: no engine\n" }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot run");
  });

  it("passes the detector's own notes through to the report", () => {
    const note = "engine 0.1.27 verified against engine-checksums.txt";
    const result = runCheck({ ...options, spawn: engine({ notes: `${note}\n` }) });

    expect(result.stdout).toContain(note);
  });

  it("always says the source scan is an undercount, even with no engine notes", () => {
    // The engine only prints that warning in its text mode, so a JSON run gets
    // silence from it. A clean report that stayed silent would read as a clean
    // bill of health it has not earned.
    const result = runCheck({ ...options, spawn: engine() });

    expect(result.stdout).toContain("undercount");
  });
});

describe("the agent-facing pointers", () => {
  const agents = () => readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");

  it("names where the vendored skill lives", () => {
    expect(agents()).toContain(".agents/skills/impeccable/SKILL.md");
  });

  it("names the documents the skill reads for this app", () => {
    expect(agents()).toContain("PRODUCT.md");
    expect(agents()).toContain("DESIGN.md");
    expect(readFileSync(resolve(repoRoot, "PRODUCT.md"), "utf8")).toContain("impeccable:product-schema");
    expect(readFileSync(resolve(repoRoot, "DESIGN.md"), "utf8")).toContain("--color-canvas");
  });

  it("names the command that runs the check", () => {
    expect(agents()).toContain("bun run design:check");
  });

  it("points at the skill rather than copying its rule tree", () => {
    // The rule tree is a versioned artifact. A copy here would be a second
    // source of truth, and the two would drift the first time the vendor
    // changes a rule.
    expect(agents()).not.toContain("craft-floor.md");
    expect(agents()).not.toContain("reference/");
  });
});
