// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
    expect(container.querySelector(".bg-warn\\/5")).toBeTruthy();

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
