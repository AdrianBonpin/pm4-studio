import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exitCodeFor, findOffences, parsePalette, renderReport, runCheck } from "./tokenCheck";

/**
 * The colour-token gate: `bun run tokens:check`.
 *
 * The defect this was built for is one class, `border-t border-line pt-4` on the
 * Clear panel, which named a colour the palette does not define and therefore
 * painted nothing. Tailwind does not fail a build over a class it cannot resolve,
 * so nothing in the ordinary commands noticed; a hairline that was written and
 * did not exist is invisible to every test that renders a page, because jsdom has
 * no paint.
 *
 * What is held here is the contract of the gate: it catches a border colour that
 * names nothing and says which class and where, it stays silent for every border
 * utility that is not a colour, and it fails rather than passes when it cannot
 * look at anything. The palette is not restated: it is read from `src/index.css`,
 * which is the one place this app defines a colour.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The app's real palette, read the way the command reads it. */
function realPalette(): string[] {
  return parsePalette(readFileSync(resolve(repoRoot, "src/index.css"), "utf8"));
}

describe("the palette", () => {
  it("reads the colours src/index.css defines", () => {
    const colours = realPalette();

    expect(colours).toEqual(
      expect.arrayContaining([
        "canvas",
        "surface",
        "surface-raised",
        "border",
        "border-hover",
        "text",
        "text-muted",
        "accent",
        "accent-hover",
        "accent-muted",
        "ok",
        "warn",
        "err",
      ]),
    );
  });

  it("does not invent a colour, and does not read one out of a border utility", () => {
    // `line` is the token the Clear panel named. It is not a colour here, and no
    // amount of it appearing in a class may make this list say otherwise.
    expect(realPalette()).not.toContain("line");
  });

  it("names a colour once, even when :root derives it a second time", () => {
    const parsed = parsePalette(
      ["@theme {", "  --color-accent: #2563eb;", "}", ":root {", "  --color-accent: red;", "}"].join(
        "\n",
      ),
    );

    expect(parsed).toEqual(["accent"]);
  });

  it("reads only colour tokens, not the type or radius namespaces", () => {
    const parsed = parsePalette(
      ["@theme {", "  --color-ok: #4ade80;", "  --font-sans: Outfit;", "  --radius-lg: 8px;", "}"].join(
        "\n",
      ),
    );

    expect(parsed).toEqual(["ok"]);
  });
});

describe("a border colour that names nothing", () => {
  it("catches the class the Clear panel shipped", () => {
    const offences = findOffences(
      '<div className="flex flex-col gap-2 border-t border-line pt-4">',
      realPalette(),
    );

    expect(offences).toEqual([{ line: 1, className: "border-line", colour: "line" }]);
  });

  it("says which line of the file the class is on", () => {
    const source = [
      "export function Panel() {",
      "  return (",
      '    <div className="flex flex-col gap-2 border-t border-line pt-4">',
      "      <p />",
      "    </div>",
      "  );",
      "}",
    ].join("\n");

    const offences = findOffences(source, realPalette());

    expect(offences).toHaveLength(1);
    expect(offences[0].line).toBe(3);
  });

  it("catches one class in a template literal, and names the variant it carries", () => {
    const offences = findOffences(
      '<div className={`flex ${wide ? "gap-4" : "gap-2"} hover:border-line`} />',
      realPalette(),
    );

    expect(offences).toEqual([{ line: 1, className: "hover:border-line", colour: "line" }]);
  });

  it("catches a class kept in a constant rather than written on an element", () => {
    const offences = findOffences(
      ['const DIVIDER = "border-t border-line pt-4";', "export { DIVIDER };"].join("\n"),
      realPalette(),
    );

    expect(offences.map((offence) => offence.className)).toEqual(["border-line"]);
  });

  it("catches a defined colour carrying an opacity modifier once its base names nothing", () => {
    const offences = findOffences('<div className="border-line/50" />', realPalette());

    expect(offences.map((offence) => offence.className)).toEqual(["border-line/50"]);
    expect(offences[0].colour).toBe("line");
  });

  it("catches a side prefix over a colour that names nothing", () => {
    const offences = findOffences('<div className="border-t-line" />', realPalette());

    expect(offences.map((offence) => offence.className)).toEqual(["border-t-line"]);
  });

  it("reports every offending class, in file order", () => {
    const source = [
      '<p className="border-line" />',
      '<p className="border-nothing" />',
      '<p className="border-line" />',
    ].join("\n");

    const offences = findOffences(source, realPalette());

    expect(offences.map((offence) => [offence.line, offence.colour])).toEqual([
      [1, "line"],
      [2, "nothing"],
      [3, "line"],
    ]);
  });
});

describe("everything that is not a colour stays silent", () => {
  const silent = (source: string) => expect(findOffences(source, realPalette())).toEqual([]);

  it("stays silent for a defined colour", () => {
    silent('<div className="border-accent border-border border-border-hover border-err" />');
  });

  it("stays silent for a border width, including zero", () => {
    silent('<div className="border border-0 border-2 border-4 border-8" />');
  });

  it("stays silent for a border style", () => {
    silent('<div className="border-solid border-dashed border-dotted border-double border-none" />');
  });

  it("stays silent for a side, with and without a width", () => {
    silent('<div className="border-t border-r-2 border-b-0 border-l border-x border-y border-s border-e" />');
  });

  it("stays silent for a variant over a width", () => {
    // `Section` draws its own hairline this way.
    silent('<section className="border-t border-border pt-6 first:border-t-0 first:pt-0" />');
  });

  it("stays silent for an opacity modifier on a defined colour", () => {
    silent('<div className="border-border/50 border-accent/40 border-text-muted/70" />');
  });

  it("stays silent for an arbitrary value", () => {
    silent('<div className="border-[#123456] border-[1px] border-[color:var(--x)]" />');
  });

  it("stays silent for Tailwind's palette-independent keywords", () => {
    silent('<div className="border-current border-transparent border-inherit" />');
  });

  it("stays silent for a colour name written in a comment", () => {
    silent(
      [
        "// border-line is not a colour in the palette",
        "/* border-line was the defect */",
        "export function Panel() {",
        "  return (",
        "    {/* border-line, again, in a JSX comment */}",
        '    <div className="flex" />',
        "  );",
        "}",
      ].join("\n"),
    );
  });

  it("stays silent for a colour name written in prose on the screen", () => {
    // Prose is not a class: it is JSX text, not a string literal, and nothing here
    // reads it. A colour mentioned where a person reads it is not a defect.
    silent(
      [
        "export function Note() {",
        "  return (",
        '    <p className="text-sm text-text-muted">',
        "      The divider above Destroy named border-line, which is not a colour,",
        "      so it never painted. The Reader's hairline is --color-border.",
        "    </p>",
        "  );",
        "}",
      ].join("\n"),
    );
  });

  it("stays silent for a CSS declaration inside a style string", () => {
    silent('el.style.cssText = "border:1px solid var(--color-err);border-radius:8px";');
  });

  it("does not attempt other typo'd utilities", () => {
    // Out of remit: this gate is about a border colour that names nothing. A
    // misspelled spacing or type utility is a different gate's problem.
    silent('<div className="p-13 text-2x1 gap-7 rounded-lgg bg-surfce text-txt-muted" />');
  });
});

describe("the report", () => {
  const report = {
    palette: ["canvas", "surface", "border", "text", "accent", "ok", "warn", "err"],
    files: 12,
    violations: [
      { file: "src/components/ClearTag.tsx", line: 176, className: "border-line", colour: "line" },
    ],
    problems: [],
  } as const;

  it("names the class and where it is", () => {
    const text = renderReport(report);

    expect(text).toContain("src/components/ClearTag.tsx:176");
    expect(text).toContain("border-line");
    expect(text).toContain("line");
  });

  it("says a violation fails the build, and is not a note", () => {
    const text = renderReport(report);

    expect(text).toContain("gate");
    expect(text).toContain("fail the build");
    expect(text).not.toContain("advisory");
  });

  it("says what was scanned, so a clean run is evidence rather than silence", () => {
    const text = renderReport({ ...report, violations: [] });

    expect(text).toContain("12");
  });

  it("fails a tree with a violation", () => {
    expect(exitCodeFor(report)).toBe(1);
  });

  it("passes a clean tree", () => {
    expect(exitCodeFor({ ...report, violations: [] })).toBe(0);
  });

  it("fails a run that could not look", () => {
    expect(exitCodeFor({ ...report, violations: [], problems: ["scanned no files"] })).toBe(1);
  });
});

/** A throwaway repository: an index.css palette and whatever sources a test needs. */
function tree(files: Record<string, string>, palette = true): string {
  const root = mkdtempSync(join(tmpdir(), "token-check-"));
  mkdirSync(join(root, "src/components"), { recursive: true });
  if (palette) {
    writeFileSync(
      join(root, "src/index.css"),
      "@theme {\n  --color-border: #27272a;\n  --color-text: #fafafa;\n}\n",
    );
  }
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

describe("the check", () => {
  it("passes a tree whose classes all name a palette colour", () => {
    const root = tree({ "src/components/Fine.tsx": '<div className="border-t border-border" />' });
    try {
      const result = runCheck({ root });

      expect(result.stdout).toContain("0");
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails a tree whose class names a colour that does not exist, naming class and place", () => {
    const root = tree({
      "src/components/Fine.tsx": '<div className="border-border" />',
      "src/components/Bad.tsx": 'export const D = () => <div className="border-t border-line" />;',
    });
    try {
      const result = runCheck({ root });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("src/components/Bad.tsx:1");
      expect(result.stdout).toContain("border-line");
      // The file that is fine is not named: a report is about the defect.
      expect(result.stdout).not.toContain("src/components/Fine.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when it scanned no files, instead of reporting a pass", () => {
    // A gate that looks at nothing has found nothing, which is not the same as
    // there being nothing to find.
    const root = tree({});
    try {
      const result = runCheck({ root });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no source files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the palette is not there, instead of passing everything", () => {
    // An absent palette would otherwise read as an empty allow-list of colours
    // and fail every class; either way it must be named as a failure to look.
    const root = tree({ "src/components/Fine.tsx": '<div className="border-border" />' }, false);
    try {
      const result = runCheck({ root });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("src/index.css");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the palette defines no colours", () => {
    const root = tree(
      { "src/components/Fine.tsx": '<div className="border-border" />' },
      false,
    );
    try {
      writeFileSync(join(root, "src/index.css"), "@theme {\n  --font-sans: Outfit;\n}\n");
      const result = runCheck({ root });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no colours");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves test files alone, so a test may name the defect it is checking for", () => {
    // A test that asserts a class is gone has to write that class down. Reading
    // test files would make the gate refuse its own regression test.
    const root = tree({
      "src/components/Fine.tsx": '<div className="border-border" />',
      "src/components/Fine.test.tsx": 'expect(classes).not.toContain("border-line");',
    });
    try {
      const result = runCheck({ root });

      expect(result.exitCode).toBe(0);
      // The test file is not counted as an interface source.
      expect(result.stdout).toContain("in 1 source file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the target is not a directory it can read", () => {
    const root = tree({});
    try {
      const result = runCheck({ root, target: "src-that-is-not-there/" });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("could not scan");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the committed interface", () => {
  it("names no border colour the palette does not define", () => {
    // The regression this ticket is: `border-line` on the Clear panel. If it
    // comes back, this fails in `bun run test` as well as in the build.
    const result = runCheck({ root: repoRoot });

    expect(result.stdout).toContain("0 undefined border colour");
    expect(result.exitCode).toBe(0);
  });
});

/**
 * The package scripts, read as data, the way `designCheck.test.ts` reads them: a
 * gate nobody calls is a check run by hand, so where it runs is part of what is
 * tested.
 */
function scripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

function reachableScripts(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return seen;
  seen.add(name);

  const command = scripts()[name] ?? "";
  for (const match of command.matchAll(/bun run ([\w:-]+)/g)) {
    reachableScripts(match[1], seen);
  }
  return seen;
}

describe("the ordinary verification command", () => {
  it("registers the gate as its own command", () => {
    expect(scripts()["tokens:check"]).toContain("scripts/token-check.ts");
  });

  it("runs the token gate inside the build, so a violation fails it", () => {
    expect(
      [...reachableScripts("build")],
      "`bun run build` no longer reaches `tokens:check`; an undefined border colour would not fail the build",
    ).toContain("tokens:check");
  });

  it("fails `bun run verify` with it", () => {
    expect([...reachableScripts("verify")]).toContain("tokens:check");
  });
});
