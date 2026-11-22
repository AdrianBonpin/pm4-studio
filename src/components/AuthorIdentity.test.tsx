// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { AuthorIdentity } from "./AuthorIdentity";
import { fakeBackend, renderUi } from "../test/dom";
import { libraryState } from "../test/libraryState";
import type { IdentityPreview, LfCard, WriteResult } from "../types";

/**
 * Gate 4 of 8: authoring an Identity by hand and writing it to the Blank on the
 * reader.
 *
 * The flow is three steps and only the last one writes: type the values, preview
 * the exact Identity, then read the Tag in the write position so the
 * confirmation can name what the write replaces. `lf_write` is the last step's
 * button and nothing earlier sends it — `lf_identity_preview_hex` mints nothing
 * and `lf_poll` reads nothing but the Tag.
 *
 * The confirmation at the end is the shared `ReplacementConfirmation`, so what
 * these tests prove is that *this* path hands it the button that writes.
 */

/** What the Rust codec would answer for the entry typed below. */
const PREVIEW: IdentityPreview = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  hex: "5500848212",
  facility: 0x84,
  card: 0x8212,
  payloadHex: "55 00 84 82 12 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
};

/** The Tag in the write position: it carries another Identity, so this write destroys it. */
const DEST: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "77 00 AB CD EF",
};

const WRITTEN: WriteResult = {
  customer: PREVIEW.customer,
  data32: PREVIEW.data32,
  readback: { ...DEST, ...PREVIEW, raw: PREVIEW.id },
  outcome: "verified",
  verified: true,
  message: null,
  refusalCause: null,
  confirmedCopies: null,
  countProblem: null,
};

/** The button that sends the write, in the words of the shared confirmation. */
const ACTION = `Replace ${DEST.id} with ${PREVIEW.id}`;

/** The two ways of entering an Identity, in the words the switch shows them. */
const ENTRY_OPTIONS = ["Customer, facility, card", "Five-byte hex"];

/** The form the entry phase opens on, and the one the other option shows. */
const PARTS_FIELDS = ["Customer", "Facility", "Card"] as const;
const HEX_FIELD = "Five-byte Identity";

/** Render the entry phase with a backend that answers the codec's previews. */
function mountEntry(answers: Parameters<typeof fakeBackend>[0] = {}) {
  const backend = fakeBackend({ lf_identity_preview: () => PREVIEW, ...answers });
  const ui = renderUi(
    <AuthorIdentity connected library={libraryState()} onDeviceError={() => {}} />,
  );
  return { backend, ...ui };
}

/** The entry switch, as a user finds it: one labelled group of options. */
function entrySwitch() {
  return screen.getByRole("group", { name: "Identity entry" });
}

/** Type an Identity, preview it, and read the Tag in the write position. */
async function upToConfirmation() {
  const backend = fakeBackend({
    lf_identity_preview_hex: () => PREVIEW,
    lf_poll: () => DEST,
    lf_write: () => WRITTEN,
  });
  const { user, container } = renderUi(
    <AuthorIdentity
      connected
      library={libraryState()}
      onDeviceError={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Five-byte hex" }));
  await user.type(screen.getByLabelText("Five-byte Identity"), "55 00 84 82 12");
  await user.click(screen.getByRole("button", { name: "Preview the Identity" }));

  // The previewed Identity is on screen, and the write is offered as a read
  // first: nothing has been written by asking the codec what the entry means.
  await user.click(
    await screen.findByRole("button", { name: "Read the tag, then write" }),
  );
  expect(backend.callsTo("lf_write")).toHaveLength(0);

  // Reading the write position is what turns the write into an offered button.
  await screen.findByRole("button", { name: ACTION });

  return { backend, user, container };
}

describe("authoring an Identity", () => {
  it("asks before writing, and going back writes nothing", async () => {
    const { backend, user, container } = await upToConfirmation();

    // The confirmation names the Identity that would be destroyed.
    expect(screen.getByText(`Writing ${PREVIEW.id} replaces ${DEST.id}`)).toBeTruthy();
    // Rendered by the shared component, in its destructive tone: this path and
    // the clone path show one confirmation, not two opinions about one.
    expect(container.querySelector('[data-tone="warn"]')).toBeTruthy();
    expect(container.querySelector('[data-tone="warn"]')?.textContent).toContain("Check this");

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(backend.callsTo("lf_write")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: ACTION })).toBeNull();
  });

  it("writes the previewed Identity when the confirmation is confirmed", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => {
      expect(backend.callsTo("lf_write")).toHaveLength(1);
    });
    // The Identity the codec previewed, which is the one the user consented to.
    expect(backend.callsTo("lf_write")[0]?.args).toEqual({
      customer: PREVIEW.customer,
      data32: PREVIEW.data32,
    });
  });
});

/**
 * The two ways of entering an Identity are one switch, not two buttons drawn to
 * look like a pair.
 *
 * "Chip" used to name three different things — the band mode switch, this pair,
 * and the console's presets — and only one of the three was ever a switch. This
 * pair is structurally the same decision as the band switch: exactly one of two
 * ways of entering a value, in place. So it is the same component, and these
 * tests read the same contract the rest of the app's switches satisfy: one
 * labelled group, one pressed option, the order it was given, labels on one line.
 */
describe("the ways of entering an Identity", () => {
  it("are one labelled group of options, in the order they are offered", () => {
    mountEntry();

    expect(within(entrySwitch()).getAllByRole("button").map((b) => b.textContent)).toEqual(
      ENTRY_OPTIONS,
    );

    // One option is current, and it is the parts form the entry phase opens on.
    const pressed = within(entrySwitch())
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["true", "false"]);
    expect(screen.getByLabelText(PARTS_FIELDS[0])).toBeTruthy();
  });

  it("keeps every option's label on one line", () => {
    mountEntry();

    // A control that wraps at the 900 × 700 minimum window is a defect here,
    // not a tight fit.
    for (const button of within(entrySwitch()).getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("whitespace-nowrap");
    }
  });

  it("is operable by keyboard alone", async () => {
    const { user } = mountEntry();

    // The switch is the first thing in the entry phase, so Tab reaches it and
    // Tab again walks its options: no pointer, no arrow-key roving focus.
    await user.tab();
    expect(document.activeElement?.textContent).toBe(ENTRY_OPTIONS[0]);
    await user.tab();
    expect(document.activeElement?.textContent).toBe(ENTRY_OPTIONS[1]);

    // Enter chooses the focused option, and the choice is reported as pressed.
    await user.keyboard("{Enter}");
    expect(
      within(entrySwitch()).getByRole("button", { name: ENTRY_OPTIONS[1] }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(screen.getByLabelText(HEX_FIELD)).toBeTruthy();

    // Space does the same, back the other way.
    await user.tab({ shift: true });
    await user.keyboard(" ");
    expect(
      within(entrySwitch()).getByRole("button", { name: ENTRY_OPTIONS[0] }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(screen.getByLabelText(PARTS_FIELDS[0])).toBeTruthy();
  });

  it("shows each option's own form, and neither reads the other's value", async () => {
    const { backend, user } = mountEntry();

    // Values typed under the parts form.
    for (const field of PARTS_FIELDS) await user.type(screen.getByLabelText(field), "1");

    // The hex form is its own form, and it starts empty: the parts values are
    // not carried into it, because they are not a hex entry.
    await user.click(within(entrySwitch()).getByRole("button", { name: ENTRY_OPTIONS[1] }));
    expect(screen.queryByLabelText(PARTS_FIELDS[0])).toBeNull();
    expect((screen.getByLabelText(HEX_FIELD) as HTMLInputElement).value).toBe("");

    await user.type(screen.getByLabelText(HEX_FIELD), "55 00 84 82 12");
    await user.click(screen.getByRole("button", { name: "Preview the Identity" }));

    // The preview is the codec's, asked in the terms of the mode showing: only
    // the hex that was typed, and none of the values left in the other form.
    await waitFor(() => {
      expect(backend.callsTo("lf_identity_preview_hex")).toHaveLength(1);
    });
    expect(backend.callsTo("lf_identity_preview_hex")[0]?.args).toEqual({
      hex: "5500848212",
    });
    expect(backend.callsTo("lf_identity_preview")).toHaveLength(0);
  });

  it("asks the parts form's own question when that is the option showing", async () => {
    const { backend, user } = mountEntry();

    // A hex value typed first does not become a parts entry: coming back, the
    // parts fields are empty and the codec is asked about what they hold.
    await user.click(within(entrySwitch()).getByRole("button", { name: ENTRY_OPTIONS[1] }));
    await user.type(screen.getByLabelText(HEX_FIELD), "55 00 84 82 12");
    await user.click(within(entrySwitch()).getByRole("button", { name: ENTRY_OPTIONS[0] }));

    for (const field of PARTS_FIELDS) {
      expect((screen.getByLabelText(field) as HTMLInputElement).value).toBe("");
    }

    await user.type(screen.getByLabelText(PARTS_FIELDS[0]), "85");
    await user.type(screen.getByLabelText(PARTS_FIELDS[1]), "132");
    await user.type(screen.getByLabelText(PARTS_FIELDS[2]), "33298");
    await user.click(screen.getByRole("button", { name: "Preview the Identity" }));

    await waitFor(() => {
      expect(backend.callsTo("lf_identity_preview")).toHaveLength(1);
    });
    expect(backend.callsTo("lf_identity_preview")[0]?.args).toEqual({
      customer: "85",
      facility: "132",
      card: "33298",
    });
    expect(backend.callsTo("lf_identity_preview_hex")).toHaveLength(0);
  });
});
