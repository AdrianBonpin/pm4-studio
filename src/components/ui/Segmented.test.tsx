// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { Segmented, type SegmentedOption } from "./Segmented";
import { renderUi } from "../../test/dom";

/**
 * The switch's contract, in one file.
 *
 * Every place the app asks "which one of these?" is this component: the band
 * modes, Library's Collections, Settings' groups, the Quiet level, the corner
 * the messages appear in, and now the two ways of entering an Identity. So the
 * contract is written down once, here, rather than re-derived at each call site:
 * one labelled group, one button per option in the order it was given, exactly
 * one of them pressed, and every label on one line.
 *
 * What it does not test is the painted shape — the corner radius, the padding.
 * Those are visual, they are settled in `DESIGN.md`, and ticket 02 changes them
 * for every call site at once. A test that pinned them here would be a test that
 * argues with the design.
 *
 * The last block is a source scan in the spirit of `Button.test.ts`: a second
 * hand-rolled switcher is the failure this component exists to prevent, and a
 * look-alike that happens to satisfy the contract behaviourally still diverges
 * the first time the switch changes shape.
 *
 * One block after it scans for the pill for the same reason. The switch and a
 * button are two different shapes, settled in `DESIGN.md` under "Shapes";
 * neither corner radius is asserted here, because a class string cannot honestly
 * own a painted radius. What is asserted is only the thing a class string *can*
 * own: that the fully rounded shape is not drawn by a control any more, so the
 * next restyle has to argue with this file before it hands a switcher or a
 * button the pill back.
 */

/** A three-option switch, and the value it was last asked for. */
const OPTIONS: readonly SegmentedOption<"off" | "warn" | "all">[] = [
  { value: "warn", label: "Errors and warnings" },
  { value: "off", label: "Off" },
  { value: "all", label: "All" },
];

/** The switch as a controlled component, the way every call site holds it. */
function Controlled({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<"off" | "warn" | "all">("warn");
  return (
    <Segmented
      label="Quiet level"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

/** Every option in the group, in the order it is rendered. */
function options() {
  return within(screen.getByRole("group", { name: "Quiet level" })).getAllByRole("button");
}

/** Which options report themselves as pressed. */
function pressed(): string[] {
  return options()
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent ?? "");
}

describe("the switch's contract", () => {
  it("is one labelled group holding each option, in the order it was given", () => {
    renderUi(<Controlled />);

    // One group with an accessible name: a screen reader announces what is
    // being chosen between before it announces the choices.
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(options().map((button) => button.textContent)).toEqual([
      "Errors and warnings",
      "Off",
      "All",
    ]);
  });

  it("reports exactly one option pressed, and moves it when another is chosen", async () => {
    const { user } = renderUi(<Controlled />);

    expect(pressed()).toEqual(["Errors and warnings"]);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(pressed()).toEqual(["All"]);

    // A group of toggle buttons, not a set of independent ones: choosing never
    // adds a second pressed option.
    expect(
      options().map((button) => ({
        label: button.textContent,
        pressed: button.getAttribute("aria-pressed"),
      })),
    ).toEqual([
      { label: "Errors and warnings", pressed: "false" },
      { label: "Off", pressed: "false" },
      { label: "All", pressed: "true" },
    ]);
  });

  it("is operable by keyboard alone, with Enter and with Space", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Controlled onChange={onChange} />);

    // Tab reaches the options and Tab walks them: no arrow-key roving focus,
    // because this is not a tab strip.
    await user.tab();
    expect(document.activeElement).toBe(options()[0]);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(options()[2]);

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("all");

    await user.tab({ shift: true });
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith("off");
  });

  it("keeps every label on one line", () => {
    renderUi(<Controlled />);

    // At the 900 × 700 minimum window a label that wraps is a defect, so the
    // rule is the component's rather than each caller's.
    for (const button of options()) {
      expect(button.className, button.textContent ?? "").toContain("whitespace-nowrap");
    }
  });

  it("lays a two-column group out as a grid, and the default as one row", () => {
    const { unmount } = renderUi(
      <Segmented label="Messages appear in" value="top-left" options={[
        { value: "top-left", label: "Top left" },
        { value: "bottom-right", label: "Bottom right" },
      ]} onChange={() => {}} columns={2} />,
    );
    expect(screen.getByRole("group", { name: "Messages appear in" }).className).toContain(
      "grid-cols-2",
    );
    unmount();

    renderUi(<Controlled />);
    expect(screen.getByRole("group", { name: "Quiet level" }).className).not.toMatch(/grid/);
  });
});

/** Every component and page source, as text, minus the tests. */
const SOURCES = import.meta.glob(["../../**/*.tsx", "!../../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The one file allowed to report a pressed option in a switch. */
const SWITCHER = "./Segmented.tsx";

/**
 * The other files that report `aria-pressed`, and why none is a switch.
 *
 * An exemption needs a reason and is checked like the design allow-list: an
 * unexplained one is how this guard stops guarding. Each is a row in a list
 * where the row *is* the item — it carries its own name and facts, and choosing
 * it opens that item's own panel, wherever the layout puts it. A switch holds a
 * fixed set of labels and hides nothing; a list of saved things is neither.
 */
const NOT_A_SWITCHER: Record<string, string> = {
  "../../pages/LibraryPage.tsx":
    "a Snapshot row: the row is the saved thing, and choosing one opens it beside the list",
  "../../pages/DraftsCollection.tsx":
    "a Draft row: the same list-and-detail shape, with the Draft's own facts on the row",
  "../WriteDraftMode.tsx":
    "a Draft row: the row is the saved thing, and choosing one opens it below the list",
};

/**
 * The only two places a fully rounded surface remains, and why each one holds.
 *
 * An exemption needs a reason and is checked like the design allow-list: an
 * unexplained one is how this guard stops guarding. The Toggle is the one pill
 * left in the interface because a switch is a physical affordance and reads as
 * one — its track and its knob are the same shape for the same reason. The
 * bullet dot is a marker on a line of prose: it carries no action, is four
 * pixels square and is not a control at all.
 */
const PILL: Record<string, string> = {
  "./Toggle.tsx":
    "the Toggle: a switch is a physical affordance, and its track and knob are the same pill",
  "../ClearSavedData.tsx":
    "a decorative bullet dot on a line of prose — a marker, not a control",
};

describe("the shape vocabulary", () => {
  it("draws the pill for the Toggle and nothing else", () => {
    for (const [file, source] of Object.entries(SOURCES)) {
      if (file in PILL) continue;
      expect(source, file).not.toContain("rounded-full");
    }
  });

  it("still finds the pill where it is named, so the scan is not vacuous", () => {
    for (const [file, reason] of Object.entries(PILL)) {
      expect(SOURCES[file], file).toBeTruthy();
      expect(reason.trim().length, file).toBeGreaterThan(0);
      expect(SOURCES[file], file).toContain("rounded-full");
    }

    // A pill written some other way would pass this scan; it guards the utility
    // the codebase draws pills with, not every possible pill.
    expect(SOURCES[SWITCHER]).toBeTruthy();
  });
});

describe("a second switcher", () => {
  it("does not exist: pressed options are reported by the switch and by nothing else", () => {
    expect(Object.keys(SOURCES)).toContain(SWITCHER);

    for (const [file, source] of Object.entries(SOURCES)) {
      if (file === SWITCHER || file in NOT_A_SWITCHER) continue;
      expect(source, file).not.toContain("aria-pressed");
    }
  });

  it("is what the switch itself reports, so the scan above is not vacuous", () => {
    expect(SOURCES[SWITCHER]).toContain("aria-pressed");
    expect(SOURCES[SWITCHER]).toContain('role="group"');
  });

  it("exempts only what it names, and names only files that really carry it", () => {
    for (const [file, reason] of Object.entries(NOT_A_SWITCHER)) {
      // An exemption for a file that is not there excuses nothing.
      expect(SOURCES[file], file).toBeTruthy();
      expect(reason.trim().length, file).toBeGreaterThan(0);
      // And it is for a file that really reports a pressed row, so it is not
      // a stale entry kept after the rows moved.
      expect(SOURCES[file], file).toContain("aria-pressed");
    }
  });
});
