// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { EraseNdef } from "./EraseNdef";
import { fakeBackend, renderUi } from "../test/dom";
import { ERASE_ACTION_LABEL, eraseConfirmation, type NdefErasePreview } from "../lib/eraseTag";
import type { EraseResult, NdefTagSnapshot } from "../types";

/**
 * Gate 7 of 8: erasing a 13.56 MHz Tag's NDEF content.
 *
 * Erasing clears the Records the Tag holds, so the flow reads the Tag first and
 * says what it would clear; `hf_ndef_erase` is the confirmation's button. The
 * first step sends the info and memory read commands only.
 */

const TAG: NdefTagSnapshot = {
  uid: "04 A2 24 5A 6C 71 80",
  reportedTagType: 0x02,
  capacityBytes: 144,
  userPages: 36,
  existing: {
    state: "message",
    messageHex: "D1 01 05 55 03 67 6F 6F 67 00 FE",
    bytes: 10,
    reason: null,
  },
};

const PREVIEW: NdefErasePreview = {
  tag: TAG,
  clearsBytes: 10,
  pages: [4, 5],
  capacityBytes: TAG.capacityBytes,
  canErase: true,
  refusal: null,
};

const ERASED: EraseResult = {
  outcome: "erased",
  message: null,
  before: TAG,
  after: { ...TAG, existing: { state: "empty", messageHex: null, bytes: 0, reason: null } },
  capacityBytes: TAG.capacityBytes,
  clearedBytes: 10,
  erasePages: [4, 5],
  acceptedPages: [4, 5],
  identityIntact: true,
  writtenHex: "03 00 FE",
};

/** The heading the confirmation gives the content it is about to clear. */
const TITLE = eraseConfirmation(PREVIEW).title;

/** Check the Tag and stop with the confirmation on screen. */
async function upToConfirmation() {
  const backend = fakeBackend({
    hf_ndef_erase_preview: () => PREVIEW,
    hf_ndef_erase: () => ERASED,
  });
  const { user } = renderUi(<EraseNdef connected />);

  await user.click(screen.getByRole("button", { name: "Check tag" }));
  await screen.findByText(TITLE);

  return { backend, user };
}

describe("erasing a Tag's content", () => {
  it("asks first, and keeping the content erases nothing", async () => {
    const { backend, user } = await upToConfirmation();

    // Checking the Tag read it; nothing has been cleared.
    expect(backend.callsTo("hf_ndef_erase")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Keep the content" }));

    expect(backend.callsTo("hf_ndef_erase")).toHaveLength(0);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByRole("button", { name: "Check tag" })).toBeTruthy();
  });

  it("erases when the confirmation is confirmed", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: ERASE_ACTION_LABEL }));

    await waitFor(() => {
      expect(backend.callsTo("hf_ndef_erase")).toHaveLength(1);
    });
  });
});

/**
 * Ticket 18: a refusal is a notice that keeps its words and its dismiss control.
 *
 * It used to be an amber rule down the left edge of a box with the reason inside
 * it and a "Dismiss" button underneath. The rule is gone; the word that says
 * which case this is, the shape beside it and the way out of the state are not,
 * and the control is driven rather than read out of the markup.
 */
describe("a tag an erase would be refused on", () => {
  const REFUSAL = "the tag is read-only";

  it("says so in words, and is dismissed from the notice itself", async () => {
    const backend = fakeBackend({
      hf_ndef_erase_preview: () => ({ ...PREVIEW, canErase: false, refusal: REFUSAL }),
    });
    const { user, container } = renderUi(<EraseNdef connected />);

    await user.click(screen.getByRole("button", { name: "Check tag" }));

    // The severity in words, not only in hue, and the reason beneath it.
    expect(await screen.findByText("Not erased")).toBeTruthy();
    expect(screen.getByText(new RegExp(REFUSAL))).toBeTruthy();
    // The shape that says it again, so the tone survives colour blindness.
    expect(container.querySelector('[data-tone="warn"] svg')).toBeTruthy();
    // Nothing was erased to find out.
    expect(backend.callsTo("hf_ndef_erase")).toHaveLength(0);

    // And the notice names what it dismisses.
    await user.click(screen.getByRole("button", { name: "Dismiss: Not erased" }));

    expect(screen.queryByText("Not erased")).toBeNull();
    expect(backend.callsTo("hf_ndef_erase")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Check tag" })).toBeTruthy();
  });
});
