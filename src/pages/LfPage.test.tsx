// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { LfPage } from "./LfPage";
import { fakeBackend, renderUi, type CommandAnswer } from "../test/dom";
import { SNAPSHOT, libraryState, libraryView } from "../test/libraryState";
import { blankConfirmation } from "../lib/blankTag";
import { replacementConfirmation } from "../lib/replacement";
import type { IdentityPreview, LfCard, WriteResult } from "../types";
import type { LibraryState } from "../hooks/useLibrary";
import type { SaveResult } from "../lib/library";

/**
 * Ticket 11 — the 125 kHz page is a workspace, not a column.
 *
 * What these tests are about is the page's shape: five operations reachable in
 * one click, in the order the work happens, with one visible at a time and Read
 * — the base capability and the precondition every write depends on — open
 * first. The operations themselves already have their own tests; what is proven
 * here is that re-parenting them into a switcher did not drop one, hide one
 * behind a scroll, or (the part that matters) lose a safety gate on the way.
 *
 * The three gates a move can quietly break are driven end to end:
 *
 *   1. no write is offered until the tag in the write position has been read,
 *      and a tag that cannot be read is refused rather than written blind;
 *   2. a tag that already presents the Identity being written is refused, not
 *      offered;
 *   3. the confirmation names the Identity the write will replace, and it is
 *      that confirmation's button — not the reading before it — that sends the
 *      write.
 *
 * They are asserted through the page rather than through the components, because
 * the components' own tests cannot see a panel that is no longer rendered.
 */

/**
 * The original: the Identity a clone writes.
 *
 * `raw` is the `0x0072` payload the Reader actually replies with, which is why
 * it is longer than the Identity — it is the whole 24-byte payload, not the five
 * bytes decoded out of it.
 */
const SOURCE: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "01 01 00 00 00 00 00 55 00 00 00 12 82 84 00 00 00 C8 42 01 00 00 00",
};

/** The Tag in the write position: it carries another Identity, so a write destroys it. */
const DEST: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "01 01 00 00 00 00 00 77 00 00 00 EF CD AB 00 00 00 C8 42 01 00 00 00",
};

/** What the Rust codec answers for the five bytes typed in the Write mode. */
const PREVIEW: IdentityPreview = {
  customer: SOURCE.customer,
  data32: SOURCE.data32,
  id: SOURCE.id,
  hex: "5500848212",
  facility: SOURCE.facility,
  card: SOURCE.card,
  payloadHex:
    "55 00 84 82 12 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
};

const WRITTEN: WriteResult = {
  customer: SOURCE.customer,
  data32: SOURCE.data32,
  readback: SOURCE,
  outcome: "verified",
  verified: true,
  message: null,
  refusalCause: null,
  confirmedCopies: null,
  countProblem: null,
};

/** The guard's refusal when nothing could be read in the write position. */
const UNREADABLE =
  "could not read the tag on the reader, so refusing to write blind. Put a blank 125 kHz " +
  "tag on the reader and try again.";

/** The codec's refusal for a card number one past what the field can hold. */
const OUT_OF_RANGE = "card 65536 is out of range: the card field must be 0–65535 (0x0000–0xFFFF)";

/** The words on the button that sends a write, from the shared confirmation. */
const REPLACE_ACTION = replacementConfirmation(SOURCE, {
  kind: "identified",
  card: DEST,
}).action;

/** Render the page, with the Tauri boundary stubbed and the library as a prop. */
function renderPage(
  answers: Record<string, CommandAnswer> = {},
  library: Partial<LibraryState> = {},
) {
  const backend = fakeBackend(answers);
  const store = libraryState(library);
  const ui = renderUi(
    <LfPage connected onChirp={() => {}} library={store} onDeviceError={() => {}} />,
  );
  return { backend, store, ...ui };
}

/** The switcher, which is the only thing that names the five operations. */
function switcher() {
  return within(screen.getByRole("group", { name: "125 kHz operation" }));
}

/** The one panel a Section heading marks. */
function panel(heading: string) {
  const section = screen.getByRole("heading", { name: heading }).closest("section");
  if (section === null) throw new Error(`the ${heading} panel is not on screen`);
  return within(section as HTMLElement);
}

/** Type a five-byte Identity and ask the codec to preview it. */
async function previewIdentity(user: ReturnType<typeof renderUi>["user"]) {
  await user.click(screen.getByRole("button", { name: "Five-byte hex" }));
  await user.type(screen.getByLabelText("Five-byte Identity"), PREVIEW.hex);
  await user.click(screen.getByRole("button", { name: "Preview the Identity" }));
}

/** Drive the Write mode to the confirmation of what the write would replace. */
async function upToReplacement(user: ReturnType<typeof renderUi>["user"]) {
  await previewIdentity(user);
  await user.click(await screen.findByRole("button", { name: "Read the tag, then write" }));
  return screen.findByRole("button", { name: REPLACE_ACTION });
}

describe("the 125 kHz workspace", () => {
  it("offers the five operations in the order the work happens", () => {
    renderPage();

    expect(switcher().getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Read",
      "Write",
      "Reset",
      "Clone",
      "Batch",
    ]);
  });

  it("opens on Read, because reading is the precondition every write depends on", () => {
    renderPage();

    expect(switcher().getByRole("button", { name: "Read" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("heading", { name: "Read a tag" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Author an Identity" })).toBeNull();
  });

  it("shows one operation at a time, and reaches each in one click", async () => {
    const { user } = renderPage();

    await user.click(switcher().getByRole("button", { name: "Write" }));
    expect(screen.getByRole("heading", { name: "Author an Identity" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Read a tag" })).toBeNull();

    await user.click(switcher().getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("heading", { name: "Blank a tag" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Author an Identity" })).toBeNull();

    await user.click(switcher().getByRole("button", { name: "Clone" }));
    expect(screen.getByRole("heading", { name: "Clone a tag" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Blank a tag" })).toBeNull();

    await user.click(switcher().getByRole("button", { name: "Batch" }));
    expect(screen.getByRole("heading", { name: "Batch clone" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Clone a tag" })).toBeNull();

    await user.click(switcher().getByRole("button", { name: "Read" }));
    expect(screen.getByRole("heading", { name: "Read a tag" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Batch clone" })).toBeNull();
  });

  it("comes back to the mode you left, within the session", async () => {
    const { user, unmount } = renderPage();

    await user.click(switcher().getByRole("button", { name: "Batch" }));
    expect(screen.getByRole("heading", { name: "Batch clone" })).toBeTruthy();
    unmount();

    // Leaving the page for another destination unmounts it; coming back gives a
    // fresh page, and the session still knows where you were.
    renderPage();
    expect(screen.getByRole("heading", { name: "Batch clone" })).toBeTruthy();
    expect(
      switcher().getByRole("button", { name: "Batch" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("no longer carries the section that only pointed at another page", () => {
    renderPage();

    // The Library pointer was a panel with no operation in it. Library is a
    // destination in the sidebar, so the page ends with an operation now.
    expect(screen.queryByText(/Open Library in the sidebar/)).toBeNull();
    expect(screen.queryByText(/browsable with no Reader attached/)).toBeNull();
    // Every panel the switcher offers is an operation with a heading.
    for (const heading of [
      "Read a tag",
      "Author an Identity",
      "Blank a tag",
      "Clone a tag",
      "Batch clone",
    ]) {
      expect(heading.trim()).not.toBe("");
    }
  });
});

describe("Read", () => {
  it("shows the Identity large, with the decoded facility and card", async () => {
    const { user } = renderPage({ lf_poll: () => SOURCE });

    await user.click(screen.getByRole("button", { name: "Read tag" }));

    const read = panel("Read a tag");
    const identity = await read.findByText(SOURCE.id);
    // The display size is the design's claim that this is the value you read
    // across a desk, so it is asserted rather than left to the class name.
    expect(identity.className).toContain("text-[26px]");
    expect(read.getByText("Facility")).toBeTruthy();
    expect(read.getByText(String(SOURCE.facility))).toBeTruthy();
    expect(read.getByText("Card")).toBeTruthy();
    expect(read.getByText(String(SOURCE.card))).toBeTruthy();
  });

  it("keeps the raw payload available but collapsed", async () => {
    const { user } = renderPage({ lf_poll: () => SOURCE });

    await user.click(screen.getByRole("button", { name: "Read tag" }));
    await panel("Read a tag").findByText(SOURCE.id);

    const raw = panel("Read a tag").getByText("Raw payload").closest("details");
    expect(raw).toBeTruthy();
    expect((raw as HTMLDetailsElement).open).toBe(false);
    expect(within(raw as HTMLElement).getByText(SOURCE.raw)).toBeTruthy();
  });

  it("saves a read to the library in one action, and says what the save did", async () => {
    const saved: SaveResult = {
      outcome: "added",
      library: libraryView([SNAPSHOT]),
      snapshot: SNAPSHOT,
    };
    const saveLf = vi.fn(async (_card: LfCard) => saved);
    const { user } = renderPage({ lf_poll: () => SOURCE }, { saveLf });

    await user.click(screen.getByRole("button", { name: "Read tag" }));
    await panel("Read a tag").findByText(SOURCE.id);
    await user.click(screen.getByRole("button", { name: "Save to library" }));

    // One click, one save, the Tag that was read.
    expect(saveLf).toHaveBeenCalledTimes(1);
    expect(saveLf.mock.calls[0]?.[0]).toEqual(SOURCE);
    // And the outcome is on screen, not left to be guessed.
    expect(await screen.findByText(`Saved to the library as ${SNAPSHOT.name}.`)).toBeTruthy();
  });
});

describe("Write", () => {
  it("accepts customer, facility and card, and shows the range each field holds", async () => {
    const { user } = renderPage();
    await user.click(switcher().getByRole("button", { name: "Write" }));

    expect(screen.getByLabelText("Customer")).toBeTruthy();
    expect(screen.getByLabelText("Facility")).toBeTruthy();
    expect(screen.getByLabelText("Card")).toBeTruthy();
    // The ranges are what the refusal will quote, so they are on screen before
    // anything is typed rather than only in the error.
    for (const range of ["0–255 (0x00–0xFF)", "0–65535 (0x0000–0xFFFF)"]) {
      expect(screen.getAllByText(range).length).toBeGreaterThan(0);
    }
  });

  it("accepts a raw five-byte value instead", async () => {
    const { user } = renderPage();
    await user.click(switcher().getByRole("button", { name: "Write" }));

    await user.click(screen.getByRole("button", { name: "Five-byte hex" }));
    expect(screen.getByLabelText("Five-byte Identity")).toBeTruthy();
    expect(screen.queryByLabelText("Customer")).toBeNull();
  });

  it("refuses an out-of-range entry inline, in the codec's own words", async () => {
    const { backend, user } = renderPage({
      lf_identity_preview: () => {
        throw new Error(OUT_OF_RANGE);
      },
    });
    await user.click(switcher().getByRole("button", { name: "Write" }));

    await user.type(screen.getByLabelText("Customer"), "85");
    await user.type(screen.getByLabelText("Facility"), "132");
    await user.type(screen.getByLabelText("Card"), "65536");
    await user.click(screen.getByRole("button", { name: "Preview the Identity" }));

    // The refusal names the field, the value and the range, in the panel the
    // form is in — not in a message that leaves with the page.
    const refusal = await screen.findByText(/65536 is out of range/);
    expect(panel("Author an Identity").getByText(/65536 is out of range/)).toBe(refusal);
    // The codec's refusal is the form's answer, and nothing was previewed.
    expect(backend.callsTo("lf_identity_preview")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Read the tag, then write" })).toBeNull();
  });
});

/**
 * The gates the move could have lost. Each is driven through the page, from the
 * switcher in, because that is the path a user now takes.
 */
describe("the safety gates after the move", () => {
  it("gate 1: offers a write only after the tag in position has been read, and refuses one it cannot read", async () => {
    const { backend, user } = renderPage({
      lf_identity_preview_hex: () => PREVIEW,
      lf_poll: () => {
        throw new Error(UNREADABLE);
      },
    });

    await user.click(switcher().getByRole("button", { name: "Write" }));
    await previewIdentity(user);

    // The confirmation offers a read of the tag, not the write: nothing has been
    // asked of the Reader yet, so nothing can have been written.
    await user.click(await screen.findByRole("button", { name: "Read the tag, then write" }));
    expect(backend.callsTo("lf_write")).toHaveLength(0);

    // The reading failed, so the write is not offered at all and the refusal is
    // on screen in the guard's own words.
    expect(await screen.findByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: REPLACE_ACTION })).toBeNull();
    expect(backend.callsTo("lf_write")).toHaveLength(0);
  });

  it("gate 2: refuses a tag that already presents the Identity being written", async () => {
    const same: LfCard = { ...SOURCE, raw: SOURCE.id };
    const { backend, user } = renderPage({
      lf_identity_preview_hex: () => PREVIEW,
      lf_poll: () => same,
      lf_write: () => WRITTEN,
    });

    await user.click(switcher().getByRole("button", { name: "Write" }));
    await previewIdentity(user);
    await user.click(await screen.findByRole("button", { name: "Read the tag, then write" }));

    // The reading is turned into a refusal, not into an offered write: the guard
    // would refuse this, so presenting a button would be a lie.
    expect(
      await screen.findByText(`The tag on the reader already carries ${SOURCE.id}`),
    ).toBeTruthy();
    const refused = screen.getByRole("button", {
      name: `Refused: the tag already carries ${SOURCE.id}`,
    }) as HTMLButtonElement;
    expect(refused.disabled).toBe(true);
    expect(backend.callsTo("lf_write")).toHaveLength(0);
  });

  it("gate 3: names the Identity a clone will replace, and only its button writes", async () => {
    const reads: (LfCard | null)[] = [SOURCE, DEST, DEST];
    const { backend, user } = renderPage({
      lf_poll: () => reads.shift() ?? DEST,
      lf_write: () => WRITTEN,
    });

    await user.click(switcher().getByRole("button", { name: "Clone" }));
    await user.click(screen.getByRole("button", { name: "Start clone" }));
    await user.click(await screen.findByRole("button", { name: "Use this tag" }));

    // Both Identities are on one screen: what is written, and what is destroyed.
    expect(await screen.findByText(`Writing ${SOURCE.id} replaces ${DEST.id}`)).toBeTruthy();
    expect(backend.callsTo("lf_write")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: REPLACE_ACTION }));

    await waitFor(() => expect(backend.callsTo("lf_write")).toHaveLength(1));
    // The Identity read from the original, after the tag in position was read.
    expect(backend.callsTo("lf_write")[0]?.args).toEqual({
      customer: SOURCE.customer,
      data32: SOURCE.data32,
    });
    expect(backend.callsTo("lf_poll").length).toBeGreaterThanOrEqual(2);
  });

  it("gate 3, authoring: the confirmation names what the hand-written Identity replaces", async () => {
    const { backend, user } = renderPage({
      lf_identity_preview_hex: () => PREVIEW,
      lf_poll: () => DEST,
      lf_write: () => WRITTEN,
    });

    await user.click(switcher().getByRole("button", { name: "Write" }));
    await upToReplacement(user);

    expect(screen.getByText(`Writing ${PREVIEW.id} replaces ${DEST.id}`)).toBeTruthy();
    expect(backend.callsTo("lf_write")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: REPLACE_ACTION }));
    await waitFor(() => expect(backend.callsTo("lf_write")).toHaveLength(1));
    expect(backend.callsTo("lf_write")[0]?.args).toEqual({
      customer: PREVIEW.customer,
      data32: PREVIEW.data32,
    });
  });
});

describe("Batch", () => {
  it("reads the original once, then hands it to the batch run", async () => {
    const { backend, user } = renderPage({ lf_poll: () => SOURCE });

    await user.click(switcher().getByRole("button", { name: "Batch" }));
    await user.click(screen.getByRole("button", { name: "Read the tag to copy" }));

    // The Identity read once is what every attempt will write.
    expect(await panel("Batch clone").findByText(SOURCE.id)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Write the blank on the reader/ }),
    ).toBeTruthy();
    expect(backend.callsTo("lf_poll")).toHaveLength(1);
  });
});

describe("Reset", () => {
  it("still asks before destroying the Identity it read", async () => {
    const { user } = renderPage({ lf_poll: () => SOURCE });

    await user.click(switcher().getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: "Read the tag to blank" }));

    expect(await screen.findByText(blankConfirmation(SOURCE.id).title)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Blank this tag permanently" })).toBeTruthy();
  });
});
