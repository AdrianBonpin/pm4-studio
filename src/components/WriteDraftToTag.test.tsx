// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { WriteDraftToTag } from "./WriteDraftToTag";
import { fakeBackend, renderUi } from "../test/dom";
import { draftMessageHex, type NdefPreview, type NdefWriteResult } from "../lib/tagWrite";
import type { Draft, DraftRecord } from "../lib/drafts";
import type { NdefTagSnapshot } from "../types";

/**
 * Gate 6 of 8: writing a Draft to a 13.56 MHz Tag.
 *
 * A write replaces what the Tag holds and nothing is appended, so the flow reads
 * the Tag first ("Check tag") and reports what the write would replace; only then
 * is there a confirmation, and `hf_ndef_write` is its button. "Check tag" sends
 * the read commands and asks the backend what a write would do — it never writes.
 */

const RECORDS: DraftRecord[] = [{ kind: "text", fields: { language: "en", text: "Loading bay" } }];

const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: new Date().toISOString(),
  records: RECORDS,
};

/** The Tag on the reader, carrying a message this write would replace. */
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

const PREVIEW: NdefPreview = {
  tag: TAG,
  requiredBytes: draftMessageHex(RECORDS).split(" ").length,
  capacityBytes: TAG.capacityBytes,
  fits: true,
  refusal: null,
};

const WRITTEN: NdefWriteResult = {
  outcome: "verified",
  message: null,
  before: TAG,
  after: { ...TAG, existing: { state: "message", messageHex: null, bytes: 20, reason: null } },
  capacityBytes: TAG.capacityBytes,
  requiredBytes: PREVIEW.requiredBytes,
  wrotePages: [4],
  acceptedPages: [4],
};

/** The exact message hex the component hands the backend. */
const MESSAGE_HEX = draftMessageHex(RECORDS);

/** Check the Tag and stop with the confirmation on screen. */
async function upToConfirmation() {
  const backend = fakeBackend({
    hf_ndef_preview: () => PREVIEW,
    hf_ndef_write: () => WRITTEN,
  });
  const { user } = renderUi(<WriteDraftToTag records={DRAFT.records} connected />);

  await user.click(screen.getByRole("button", { name: "Check tag" }));
  await screen.findByText("Replace the message on the tag with this Draft?");

  return { backend, user };
}

describe("writing a Draft to a Tag", () => {
  it("asks first, and cancelling writes nothing", async () => {
    const { backend, user } = await upToConfirmation();

    // Checking the Tag read it and asked what a write would do; it wrote nothing.
    expect(backend.callsTo("hf_ndef_write")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(backend.callsTo("hf_ndef_write")).toHaveLength(0);
    expect(screen.queryByText("Replace the message on the tag with this Draft?")).toBeNull();
    // Back to the state where only a check is offered.
    expect(screen.getByRole("button", { name: "Check tag" })).toBeTruthy();
  });

  it("writes the Draft's message when confirmed", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: "Write to tag" }));

    await waitFor(() => {
      expect(backend.callsTo("hf_ndef_write")).toHaveLength(1);
    });
    // The one NDEF message the Draft encodes to, which is what was confirmed.
    // A Draft names no Snapshot: it is attached to no Tag, so the write has no
    // copy to count and says so explicitly.
    expect(backend.callsTo("hf_ndef_write")[0]?.args).toEqual({
      messageHex: MESSAGE_HEX,
      snapshotId: null,
    });
  });
});
