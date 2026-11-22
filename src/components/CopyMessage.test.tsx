// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { CopyMessage } from "./CopyMessage";
import { fakeBackend, renderUi, type Backend } from "../test/dom";
import { NTAG_CAPTURE, NTAG_UID, recordsRead } from "../test/hfState";
import { encodeNdefMessage, textRecord, urlRecord, type NdefRecord } from "../lib/ndef";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { bytesToHex, type NdefWriteResult } from "../lib/tagWrite";
import type { HfCard, NdefTagSnapshot } from "../types";

/**
 * Ticket 15 — Copy, through the panel the user actually works in.
 *
 * The guard's every branch is tested without a device in `lib/hfCopy.test.ts`.
 * These tests hold the flow that reaches it: the source is read and held, the
 * field is checked for the source's removal, the destination is read before
 * anything is written, and the write happens only from a confirmation that names
 * what will be replaced — then sounds the outcome the comparison decided.
 */

const DESTINATION_UID = "04 A2 24 5A 6C 71 80";

const SOURCE_MESSAGE: NdefRecord[] = [
  textRecord("en", "hello"),
  urlRecord("https://devgo.studio"),
];

const DESTINATION_MESSAGE: NdefRecord[] = [textRecord("en", "loading bay")];

/** A poll reply for a Tag that answers 00 44 / 00, the NTAG family. */
function pollReply(uid: string): HfCard {
  const bytes = uid.split(" ").map((part) => Number.parseInt(part, 16));
  const buffer = [...bytes, ...Array.from({ length: 10 - bytes.length }, () => 0)];
  return {
    payload: [0x01, 0x01, ...buffer, bytes.length, 0x44, 0x00, 0x00, 0x02, 0x00, 0x00],
  };
}

const DESTINATION_CARD = pollReply(DESTINATION_UID);

const SOURCE_HEX = bytesToHex(encodeNdefMessage(SOURCE_MESSAGE));
const DESTINATION_HEX = bytesToHex(encodeNdefMessage(DESTINATION_MESSAGE));
const DESTINATION_BYTES = DESTINATION_HEX.split(" ").length;

/** The destination as a write result reads it back. */
function destinationHolding(messageHex: string): NdefTagSnapshot {
  return {
    uid: DESTINATION_UID,
    reportedTagType: 0x02,
    capacityBytes: 496,
    userPages: 124,
    existing: {
      state: "message",
      messageHex,
      bytes: messageHex.split(" ").length,
      reason: null,
    },
  };
}

function writeResult(
  outcome: NdefWriteResult["outcome"],
  messageHex: string | null,
): NdefWriteResult {
  return {
    outcome,
    message: outcome === "unverified" ? "the write was sent but did not read back" : null,
    before: destinationHolding(DESTINATION_HEX),
    after: messageHex === null ? null : destinationHolding(messageHex),
    capacityBytes: 496,
    requiredBytes: SOURCE_HEX.split(" ").length,
    wrotePages: [4, 5, 6],
    acceptedPages: [4, 5, 6],
  };
}

/** Every symbol the audible half was told, for one mount. */
const heard: { symbols: SignalSymbol[]; stop: () => void }[] = [];

afterEach(() => {
  while (heard.length > 0) heard.pop()?.stop();
});

interface MountOptions {
  /** What the destination reads back with, by default the message it holds now. */
  readonly written?: NdefWriteResult;
}

/**
 * Mount the panel with a field the test drives: `field()` is what one poll
 * latches, and `destinationRead()` is what the message read answers with.
 */
function mount({ written = writeResult("verified", SOURCE_HEX) }: MountOptions = {}) {
  let card: HfCard | null = NTAG_CAPTURE;
  let destinationRead = recordsRead({}, DESTINATION_UID, DESTINATION_MESSAGE);
  let sourceRead = recordsRead();

  const backend: Backend = fakeBackend({
    ntag_records_read: () => {
      const answer = card === null ? sourceRead : card === DESTINATION_CARD ? destinationRead : sourceRead;
      return answer;
    },
    hf_ndef_write: () => written,
  });

  const signals: SignalSymbol[] = [];
  const stop = subscribeSignals((symbol) => signals.push(symbol));
  heard.push({ symbols: signals, stop });

  const ui = renderUi(<CopyMessage connected onPoll={async () => card} />);

  return {
    backend,
    ui,
    signals,
    /** What the next poll latches. */
    field(next: HfCard | null) {
      card = next;
    },
    /** What the destination's message read answers with. */
    destinationHolds(read: ReturnType<typeof recordsRead>) {
      destinationRead = read;
    },
    sourceHolds(read: ReturnType<typeof recordsRead>) {
      sourceRead = read;
    },
  };
}

/** Read the source, take it off, read the destination, and stop at the confirmation. */
async function upToConfirmation(capacityBytes: number | null = 496) {
  const mounted = mount();
  mounted.destinationHolds(recordsRead({ capacityBytes }, DESTINATION_UID, DESTINATION_MESSAGE));

  await mounted.ui.user.click(screen.getByRole("button", { name: "Read source tag" }));
  await screen.findByText("Source message held");

  mounted.field(null);
  await mounted.ui.user.click(screen.getByRole("button", { name: "Check the field" }));
  await screen.findByText(/Nothing is latched/);

  mounted.field(DESTINATION_CARD);
  await mounted.ui.user.click(screen.getByRole("button", { name: "Read destination tag" }));
  // Either the confirmation, or the guard's refusal to offer one.
  await screen.findAllByText(/Replace what tag|Not copied/);

  return mounted;
}

describe("Copy's flow", () => {
  it("holds the source, insists it is removed, names what will be replaced, and verifies the write", async () => {
    const mounted = await upToConfirmation();
    const { backend, ui, signals } = mounted;

    // The confirmation names the destination's current message, with its size,
    // and nothing has been written to get it.
    expect(screen.getByText(new RegExp(`${DESTINATION_BYTES} bytes`))).toBeTruthy();
    expect(screen.getByText(/1 Record: Text loading bay/)).toBeTruthy();
    expect(backend.callsTo("hf_ndef_write")).toHaveLength(0);

    await ui.user.click(screen.getByRole("button", { name: "Copy to this tag" }));

    await waitFor(() => {
      expect(backend.callsTo("hf_ndef_write")).toHaveLength(1);
    });
    // The source's own message is what is written, byte for byte.
    expect(backend.callsTo("hf_ndef_write")[0]?.args.messageHex).toBe(SOURCE_HEX);

    await screen.findByText("Copied");
    expect(signals[signals.length - 1]).toBe("done");
  });

  it("offers a destination that read fine and holds nothing, saying there is nothing to replace", async () => {
    // An NDEF formatted tag holding an empty message is the ordinary destination
    // for a Copy. It must reach the confirmation, and the confirmation must say
    // what is actually there rather than quoting a read complaint.
    const mounted = mount();
    mounted.destinationHolds(
      recordsRead(
        { outcome: "empty", messageHex: "", messageBytes: 0 },
        DESTINATION_UID,
        DESTINATION_MESSAGE,
      ),
    );

    await mounted.ui.user.click(screen.getByRole("button", { name: "Read source tag" }));
    await screen.findByText("Source message held");

    mounted.field(null);
    await mounted.ui.user.click(screen.getByRole("button", { name: "Check the field" }));
    await screen.findByText(/Nothing is latched/);

    mounted.field(DESTINATION_CARD);
    await mounted.ui.user.click(screen.getByRole("button", { name: "Read destination tag" }));

    await screen.findByText(/Replace what tag/);
    expect(screen.getByText(/replacing nothing/)).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
    // Nothing is written before the confirmation, as for any other destination.
    expect(mounted.backend.callsTo("hf_ndef_write")).toHaveLength(0);

    await mounted.ui.user.click(screen.getByRole("button", { name: "Copy to this tag" }));
    await waitFor(() => {
      expect(mounted.backend.callsTo("hf_ndef_write")).toHaveLength(1);
    });
    await screen.findByText("Copied");
    expect(mounted.signals[mounted.signals.length - 1]).toBe("done");
  });

  it("refuses to go on while the source is still in the write position", async () => {
    const mounted = mount();
    await mounted.ui.user.click(screen.getByRole("button", { name: "Read source tag" }));
    await screen.findByText("Source message held");

    // The field still holds the source: the same UID.
    await mounted.ui.user.click(screen.getByRole("button", { name: "Check the field" }));

    await screen.findByText(/the source tag is still in the field/);
    expect(screen.queryByRole("button", { name: "Read destination tag" })).toBeNull();
    expect(mounted.signals[mounted.signals.length - 1]).toBe("attention");
  });

  it("refuses a destination that cannot hold the message, naming both numbers, before anything is written", async () => {
    const mounted = await upToConfirmation(8);

    await screen.findByText("Not copied");
    const needed = SOURCE_HEX.split(" ").length + 3;
    expect(screen.getByText(new RegExp(`needs ${needed} bytes`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`capacity\\s+is 8 bytes`))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy to this tag" })).toBeNull();
    expect(mounted.backend.callsTo("hf_ndef_write")).toHaveLength(0);
  });

  it("states that an undetermined fit is unknown and writes only on an explicit acknowledgement", async () => {
    const mounted = await upToConfirmation(null);

    expect(screen.getByText(/whether the message's \d+ bytes fit is unknown/)).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: "Copy to this tag" });
    expect(copyButton).toHaveProperty("disabled", true);
    expect(mounted.backend.callsTo("hf_ndef_write")).toHaveLength(0);

    await mounted.ui.user.click(screen.getByRole("checkbox", { name: /Write anyway/ }));
    expect(copyButton).toHaveProperty("disabled", false);

    await mounted.ui.user.click(copyButton);
    await waitFor(() => {
      expect(mounted.backend.callsTo("hf_ndef_write")).toHaveLength(1);
    });
  });

  it("reports an empty field plainly and keeps the source held when no destination is placed", async () => {
    const mounted = mount();
    await mounted.ui.user.click(screen.getByRole("button", { name: "Read source tag" }));
    await screen.findByText("Source message held");

    mounted.field(null);
    await mounted.ui.user.click(screen.getByRole("button", { name: "Check the field" }));
    await screen.findByText(/Nothing is latched/);

    // No destination is put on the Reader, and the field is read anyway.
    await mounted.ui.user.click(screen.getByRole("button", { name: "Read destination tag" }));

    await screen.findByText("No tag in the field.");
    // The source message is still held, and nothing was written to anything.
    expect(screen.getByText("Source message held")).toBeTruthy();
    expect(screen.getByText(NTAG_UID)).toBeTruthy();
    expect(mounted.backend.callsTo("hf_ndef_write")).toHaveLength(0);
  });

  it("reports success when the destination re-encoded an equal message, not failure", async () => {
    // The same Records with the whole URI instead of the abbreviation: different
    // bytes, so the backend cannot byte-match it, but the same message.
    const wholeUri = bytesToHex(
      encodeNdefMessage([
        textRecord("en", "hello"),
        { tnf: 0x01, type: [0x55], payload: [0x00, ...ascii("https://devgo.studio")] },
      ]),
    );
    const mounted = await upToConfirmation();
    mounted.backend.answer("hf_ndef_write", () => writeResult("unverified", wholeUri));

    await mounted.ui.user.click(screen.getByRole("button", { name: "Copy to this tag" }));

    await screen.findByText("Copied");
    expect(screen.getByText(/re-encoded/)).toBeTruthy();
    expect(mounted.signals[mounted.signals.length - 1]).toBe("done");
  });

  it("reports an unconfirmed copy as needs-you when the destination did not read back as it", async () => {
    const mounted = await upToConfirmation();
    // Read back as neither the message that was written nor the one it held
    // before: a copy that did not land, rather than a destination that refused.
    const somethingElse = bytesToHex(encodeNdefMessage([textRecord("en", "something else")]));
    mounted.backend.answer("hf_ndef_write", () => writeResult("unverified", somethingElse));

    await mounted.ui.user.click(screen.getByRole("button", { name: "Copy to this tag" }));

    await screen.findByText("Unconfirmed");
    expect(screen.getByText(/did not read back as it/)).toBeTruthy();
    expect(mounted.signals[mounted.signals.length - 1]).toBe("needs-you");
  });
});

/** Printable ASCII as bytes, for the hand-built wire Record above. */
function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}
