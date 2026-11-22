/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * The side-bar notice treatment, guarded at the source.
 *
 * `Notice.test.tsx` holds the replacement to its own properties — a border on all
 * four sides, a tint, a leading word, a shape, and an accessible name. This file
 * holds the other half: that the treatment it replaced is *gone* from the app,
 * including from the surfaces no test renders.
 *
 * Ticket 18's contract asks the design check to report zero occurrences of the
 * rule, and the detector cannot carry that on its own: its `side-tab` rule charges
 * `border-l-4`, while this app's notices used `border-l-2`. The detector reports
 * zero either way, so a zero from it is not evidence and is not relied on here.
 * The scan below is the evidence — it names the class this app actually used.
 *
 * The 1px `md:border-l` uses that remain are not this. They are the hairline
 * between a collection's list and its detail pane — a divider, with no words of
 * its own and no severity to carry — and they are asserted below to be exactly
 * that and nothing more, so a 2px rule cannot come back dressed as one.
 */

/**
 * Every app source file, as text, minus the tests.
 *
 * The same `?raw` glob the other source guards use, rather than a Node-only `fs`
 * walk: a guard on the shipped app should read what the bundler reads.
 */
const SOURCES = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Repo-relative path, so a failure names the file as the repository does. */
function pathOf(key: string): string {
  return key.startsWith("./") ? `src/lib/${key.slice(2)}` : key.replace(/^\.\.\//, "src/");
}

const MODULES = Object.entries(SOURCES).map(([key, text]) => ({ path: pathOf(key), text }));

/** Every line of one module, with its line number. */
function lines(text: string): { at: number; line: string }[] {
  return text.split("\n").map((line, index) => ({ at: index + 1, line }));
}

describe("the left-bar notice treatment", () => {
  it("appears nowhere in the app", () => {
    const found = MODULES.flatMap((module) =>
      lines(module.text)
        .filter(({ line }) => line.includes("border-l-2"))
        .map(({ at, line }) => `${module.path}:${at} ${line.trim()}`),
    );

    // One failure listing every site, rather than the first: a sweep is the work,
    // and knowing what is left is the whole report.
    expect(found, `the notice treatment is back:\n${found.join("\n")}`).toEqual([]);
  });

  it("leaves only the pane dividers, and only as hairlines", () => {
    const hasBorderLeft = MODULES.flatMap((module) =>
      lines(module.text)
        .filter(({ line }) => /border-l\b/.test(line))
        .map(({ at, line }) => ({ where: `${module.path}:${at}`, line: line.trim() })),
    );

    for (const { where, line } of hasBorderLeft) {
      // A divider between two panes: one pixel, drawn on the detail pane, and
      // never a width class that would make it a rule.
      expect(line, where).toMatch(/md:border-l md:border-border/);
      expect(line, where).not.toMatch(/border-l-\d/);
    }
  });
});
