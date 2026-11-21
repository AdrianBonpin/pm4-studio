// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { BlankTag } from "./BlankTag";
import { fakeBackend, renderUi } from "../test/dom";
import { blankConfirmation } from "../lib/blankTag";
import type { BlankResult, LfCard } from "../types";

/**
 * Gate 5 of 8: blanking a Tag's Identity.
 *
 * Blanking destroys the Identity the Tag carries, so the flow reads the Tag
 * first and then asks: the confirmation names that Identity and is passed back
 * into the write, so the Rust guard can refuse a Tag that is not the one the
 * user consented to. `lf_blank` is the confirmation's button.
 */

const CARD: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

const BLANKED: BlankResult = {
  customer: CARD.customer,
  data32: CARD.data32,
  outcome: "blanked",
  blanked: true,
  stillIdentifies: null,
  message: null,
};

/** The heading the confirmation gives the Identity it is about to destroy. */
const TITLE = blankConfirmation(CARD.id).title;

/** Read the Tag and stop with its confirmation on screen. */
async function upToConfirmation() {
  const backend = fakeBackend({
    lf_poll: () => CARD,
    lf_blank: () => BLANKED,
  });
  const { user } = renderUi(
    <BlankTag connected onChirp={() => {}} onDeviceError={() => {}} />,
  );

  await user.click(screen.getByRole("button", { name: "Read the tag to blank" }));
  await screen.findByText(TITLE);

  return { backend, user };
}

describe("blanking a Tag", () => {
  it("asks first, and keeping the tag as it is blanks nothing", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: "Keep the tag as it is" }));

    expect(backend.callsTo("lf_blank")).toHaveLength(0);
    expect(screen.queryByText(TITLE)).toBeNull();
    // The flow is back at its start, with nothing destroyed.
    expect(screen.getByRole("button", { name: "Read the tag to blank" })).toBeTruthy();
  });

  it("blanks the Identity that was read when confirmed", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: "Blank this tag permanently" }));

    await waitFor(() => {
      expect(backend.callsTo("lf_blank")).toHaveLength(1);
    });
    // The Identity the confirmation named, sent as the guard's argument.
    expect(backend.callsTo("lf_blank")[0]?.args).toEqual({
      customer: CARD.customer,
      data32: CARD.data32,
    });
  });
});
