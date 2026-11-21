/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * `Button` is the single way to express a button in this app, and `variant`
 * the single way to say what kind of button it is.
 *
 * `danger` was added for an action that destroys something and cannot be undone,
 * and a same-intent site — the Library's "Delete permanently" — went on
 * hand-rolling the identical class string instead of asking for it. That is the
 * failure mode a design token exists to prevent: the component's look and the
 * hand-rolled look agree today and diverge the first time either is touched, and
 * nothing in between reports it.
 *
 * So the destructive style is asserted to live in one file. Notice blocks that
 * are not buttons (`border-err bg-err/5`, a different pair) are not this.
 */

/** Every component and page source, as text, minus the tests. */
const SOURCES = import.meta.glob(["../../**/*.tsx", "!../../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The one file allowed to name the destructive button's classes. */
const BUTTON = "./Button.tsx";

describe("the danger variant", () => {
  it("is the only place the destructive button classes appear", () => {
    expect(Object.keys(SOURCES)).toContain(BUTTON);

    for (const [file, source] of Object.entries(SOURCES)) {
      if (file === BUTTON) continue;
      expect(source, file).not.toContain("border-err/50");
      expect(source, file).not.toContain("bg-err/10");
    }
  });

  it("still carries those classes itself, so the check above is not vacuous", () => {
    expect(SOURCES[BUTTON]).toContain("border-err/50");
    expect(SOURCES[BUTTON]).toContain("bg-err/10");
  });
});
