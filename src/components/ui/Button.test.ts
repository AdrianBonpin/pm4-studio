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
 * are not buttons (`border-err bg-err/5`, a different pair) are not this — and
 * neither is the notice treatment's own box, which `NOT_A_CONTROL` names with
 * the reason it is not a control.
 */

/** Every component and page source, as text, minus the tests. */
const SOURCES = import.meta.glob(["../../**/*.tsx", "!../../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The one file allowed to name the destructive button's classes. */
const BUTTON = "./Button.tsx";

/**
 * The other files allowed to name the same pair, and why neither is a button.
 *
 * An exemption needs a reason and is checked like the design allow-list: an
 * unexplained one is how a guard stops guarding. `Notice` draws a failure as a
 * box — the pair is the error tone's frame, on a `<div>` with no action in it —
 * and the danger button on a red box would be the one place that distinction
 * mattered.
 */
const NOT_A_CONTROL: Record<string, string> = {
  "./Notice.tsx": "a notice is a box, not a control: the pair is the error tone's frame",
};

describe("the danger variant", () => {
  it("is the only place the destructive button classes appear", () => {
    expect(Object.keys(SOURCES)).toContain(BUTTON);

    for (const [file, source] of Object.entries(SOURCES)) {
      if (file === BUTTON || file in NOT_A_CONTROL) continue;
      expect(source, file).not.toContain("border-err/50");
      expect(source, file).not.toContain("bg-err/10");
    }
  });

  it("still carries those classes itself, so the check above is not vacuous", () => {
    expect(SOURCES[BUTTON]).toContain("border-err/50");
    expect(SOURCES[BUTTON]).toContain("bg-err/10");
  });

  it("exempts only what it names, and names only real files", () => {
    for (const [file, reason] of Object.entries(NOT_A_CONTROL)) {
      // A suppression naming a file that is not there excuses nothing.
      expect(SOURCES[file], file).toBeTruthy();
      expect(reason.trim().length, file).toBeGreaterThan(0);
      // And the exemption is for a file that really carries the pair, so it is
      // not a stale entry kept after the classes moved.
      expect(SOURCES[file], file).toContain("border-err/50");
      expect(SOURCES[file], file).toContain("bg-err/10");
    }
  });
});
