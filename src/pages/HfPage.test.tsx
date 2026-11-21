// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { HfPage } from "./HfPage";
import { fakeBackend, renderUi } from "../test/dom";
import { MESSAGE, NTAG_CAPTURE, NTAG_UID, recordsRead } from "../test/hfState";
import { libraryState, libraryView } from "../test/libraryState";
import { encodeNdefMessage, type NdefRecord } from "../lib/ndef";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { bytesToHex } from "../lib/tagWrite";
import type { HfSnapshotSave } from "../lib/hfSnapshot";
import type { SaveResult } from "../lib/library";
import type { HfCard } from "../types";

/**
 * Ticket 08 — one Read on 13.56 MHz fetches the identity and the message.
 *
 * These are the page's tests, so what is asserted is what is on screen: the one
 * action, the rows, and the honest partial result. The only thing faked is the
 * Tauri IPC boundary, which is where the webview stops and Rust begins; the poll
 * itself arrives as the `onPoll` prop the shell hands the page.
 *
 * Ticket 14 moved the Read into a mode: it is the first of the workspace's modes,
 * and these tests render it as the mode that is showing. The workspace itself —
 * its switch, its other modes and the password panel's absence — is held in
 * `HfPage.workspace.test.tsx`.
 *
 * The audible half is asserted through `subscribeSignals`, because "exactly one
 * outcome, and it distinguishes read-fully from read-but-check" is a claim about
 * the symbol the user hears, not about a callback having been called.
 */

const CLASSIC_CAPTURE: HfCard = {
  payload: [
    0x01, 0x01,
    0x31, 0xf3, 0x0e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x04,
    0x04, 0x00,
    0x08,
    0x01,
    0x10, 0x00,
  ],
};

const UNKNOWN_CAPTURE: HfCard = {
  payload: [
    0x01, 0x01,
    0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x04,
    0x11, 0x22,
    0x5a,
    0x01,
    0x00, 0x00,
  ],
};

/** Collect what the audible half is told, for one test. */
function hearSignals(): { symbols: SignalSymbol[]; stop: () => void } {
  const symbols: SignalSymbol[] = [];
  const stop = subscribeSignals((symbol) => symbols.push(symbol));
  return { symbols, stop };
}

/** Render the page, listen to the audible half, and press the one Read action. */
async function readTag(
  card: HfCard | null,
  answers: Parameters<typeof fakeBackend>[0] = {},
) {
  const backend = fakeBackend(answers);
  const { symbols, stop } = hearSignals();
  const { user } = renderUi(
    <HfPage
      connected
      mode="read"
      onModeChange={() => {}}
      onPoll={async () => card}
      library={libraryState()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Read tag" }));
  return { backend, user, symbols, stop };
}

/** The Read mode only: the Memory mode repeats the UID by design. */
function readout() {
  const section = screen.getByText("Read a tag").closest("section");
  if (section === null) throw new Error("the Read section is not on screen");
  return within(section as HTMLElement);
}

/** A labelled Field's value, so "yes" is the NDEF row's and not a row's validity. */
function field(label: string): string {
  const span = readout().getByText(label);
  const value = span.parentElement?.querySelectorAll("span")[1];
  return value?.textContent ?? "";
}

/** The body rows of the Records table, in the Tag's order. */
function recordRows(): string[][] {
  return screen
    .getAllByRole("row")
    .filter((row) => row.querySelectorAll("td").length > 0)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent ?? ""));
}

describe("one Read on a fully readable Tag", () => {
  it("performs both transactions and presents a single readout", async () => {
    const { backend, symbols, stop } = await readTag(NTAG_CAPTURE, {
      ntag_records_read: () => recordsRead(),
    });

    await readout().findByText(NTAG_UID);
    expect(field("Card type")).toBe("MIFARE Ultralight / NTAG21x");
    expect(field("Capacity")).toBe("496 bytes");
    expect(field("NDEF formatted")).toBe("yes");
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("https://devgo.studio")).toBeTruthy();

    // Exactly one message read, and exactly one outcome.
    expect(backend.callsTo("ntag_records_read")).toHaveLength(1);
    expect(symbols).toEqual(["done"]);
    stop();
  });

  it("carries kind, summary, encoded size and validity on each row, in the Tag's order", async () => {
    await readTag(NTAG_CAPTURE, { ntag_records_read: () => recordsRead() });
    await readout().findByText(NTAG_UID);

    const rows = recordRows();
    expect(rows).toHaveLength(2);
    // Position, kind, summary, size in bytes, validity.
    expect(rows[0]).toEqual([
      "1",
      "Text",
      "hello",
      `${encodeNdefMessage([MESSAGE[0]!]).length} B`,
      "yes",
    ]);
    expect(rows[1]).toEqual([
      "2",
      "URL",
      "https://devgo.studio",
      `${encodeNdefMessage([MESSAGE[1]!]).length} B`,
      "yes",
    ]);
  });

  it("marks a Record that decodes but cannot be encoded again", async () => {
    // A MIME Record whose media type has no "/": readable, not re-encodable.
    const odd: NdefRecord[] = [{ tnf: 0x02, type: [0x78], payload: [0x01, 0x02] }];
    await readTag(NTAG_CAPTURE, {
      ntag_records_read: () => recordsRead({}, NTAG_UID, odd),
    });
    await readout().findByText(NTAG_UID);

    expect(recordRows()[0]?.[4]).toBe("no");
    expect(screen.getByText(/Record 1 cannot be encoded again by this build/)).toBeTruthy();
  });
});

describe("a Tag whose family cannot hold NDEF", () => {
  it("says so, gives the table's capacity, offers no message read, and sounds done", async () => {
    const { backend, symbols, stop } = await readTag(CLASSIC_CAPTURE);

    await screen.findByText("MIFARE Classic 1K");
    expect(field("Capacity")).toBe("1024 bytes");
    expect(screen.getByText("not NDEF capable")).toBeTruthy();
    expect(screen.getByText(/implements no NFC Forum tag type/)).toBeTruthy();
    // NDEF formatting is a fact about a memory read, and there was none.
    expect(readout().queryByText("NDEF formatted")).toBeNull();
    // Offering a transaction that cannot work is what this ticket removes.
    expect(backend.callsTo("ntag_records_read")).toHaveLength(0);
    // The read answered the whole question, so it is not a warning.
    expect(symbols).toEqual(["done"]);
    stop();
  });
});

describe("a reply that cannot be decoded", () => {
  it("shows the raw bytes and the reason, and offers no message read", async () => {
    const { backend, symbols, stop } = await readTag(UNKNOWN_CAPTURE);

    await screen.findByText("Not decoded");
    expect(screen.getByText("unknown card type")).toBeTruthy();
    expect(screen.getByText(/ATQA 11 22 with SAK 5A matches no published/)).toBeTruthy();
    expect(screen.getByText(/No message read was attempted/)).toBeTruthy();
    expect(screen.getByText(/DE AD BE EF/)).toBeTruthy();
    expect(backend.callsTo("ntag_records_read")).toHaveLength(0);
    // A raw fallback is not a success sound (user story 34).
    expect(symbols).toEqual(["needs-you"]);
    stop();
  });
});

describe("a poll that succeeds with a Records read that fails", () => {
  it("keeps the identity it did get and says why the Records are absent", async () => {
    const { backend, symbols, stop } = await readTag(NTAG_CAPTURE, {
      ntag_records_read: () => {
        throw new Error("the Reader stopped answering during the memory read");
      },
    });

    // The identity half is still there...
    await readout().findByText(NTAG_UID);
    expect(field("Card type")).toBe("MIFARE Ultralight / NTAG21x");
    // ...and the message half says what is missing and why, twice: the badge and
    // the sentence, so neither can be read as a complete result.
    expect(screen.getByText("records not read")).toBeTruthy();
    expect(
      screen.getByText(/could not be read: the Reader stopped answering during the memory read/),
    ).toBeTruthy();
    // NDEF formatting is not claimed from the poll, and the table withholds
    // capacity for this family, so neither is invented.
    expect(readout().queryByText("NDEF formatted")).toBeNull();
    expect(field("Capacity")).toBe("not determined");
    expect(symbols).toEqual(["needs-you"]);
    expect(backend.callsTo("ntag_records_read")).toHaveLength(1);
    stop();
  });
});

describe("a message read of a different Tag", () => {
  it("never attaches itself to this reading", async () => {
    const { symbols, stop } = await readTag(NTAG_CAPTURE, {
      ntag_records_read: () => recordsRead({}, "DE AD BE EF"),
    });

    await screen.findByText("different tag");
    expect(screen.getByText(/described a different Tag/)).toBeTruthy();
    // The other Tag's container supplied nothing: no Records, no capacity.
    expect(screen.queryByText("hello")).toBeNull();
    expect(field("Capacity")).toBe("not determined");
    expect(symbols).toEqual(["needs-you"]);
    stop();
  });
});

describe("an empty field", () => {
  it("reports nothing latched, and stays silent", async () => {
    const { backend, symbols, stop } = await readTag(null);

    await waitFor(() => expect(screen.getByText("No tag in the field.")).toBeTruthy());
    expect(backend.callsTo("ntag_records_read")).toHaveLength(0);
    expect(symbols).toEqual([]);
    stop();
  });
});

describe("a Tag that holds no message", () => {
  it("is a complete read, and says the message is empty", async () => {
    const { symbols, stop } = await readTag(NTAG_CAPTURE, {
      ntag_records_read: () =>
        recordsRead({ outcome: "empty", messageHex: "", messageBytes: 0 }),
    });

    await screen.findByText("empty message");
    expect(field("NDEF formatted")).toBe("yes");
    expect(symbols).toEqual(["done"]);
    stop();
  });
});

/**
 * Ticket 09 — keeping the read.
 *
 * Saving is its own operation with its own outcome: a read can succeed and the
 * library file still refuse to be written, and a repeat read is a third answer
 * again. What is saved is the whole reading, not the half that happens to be on
 * screen first.
 */
describe("keeping a 13.56 MHz read in the library", () => {
  const SAVED = {
    id: "04 43 8A 01 22 09 03",
    name: "Snapshot 1",
    note: "",
    kind: "HF" as const,
    capturedAt: "2026-11-22T10:00:00.000Z",
    writeCount: 0,
    hf: { uid: NTAG_UID, raw: "00 01 02" },
  };

  async function readInto(saveHf: (read: HfSnapshotSave) => Promise<SaveResult | null>) {
    fakeBackend({ ntag_records_read: () => recordsRead() });
    const { symbols, stop } = hearSignals();
    const library = libraryState({ saveHf });
    const { user } = renderUi(
      <HfPage
        connected
        mode="read"
        onModeChange={() => {}}
        onPoll={async () => NTAG_CAPTURE}
        library={library}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Read tag" }));
    await readout().findByText(NTAG_UID);
    return { user, symbols, stop };
  }

  it("saves the whole read in one action, and says so", async () => {
    const saveHf = vi.fn(async (_read: HfSnapshotSave) =>
      ({ outcome: "added", library: libraryView([SAVED]), snapshot: SAVED }) as SaveResult,
    );
    const { user, symbols, stop } = await readInto(saveHf);

    await user.click(screen.getByRole("button", { name: "Save to library" }));

    await waitFor(() => expect(saveHf).toHaveBeenCalledTimes(1));
    const sent = saveHf.mock.calls[0]?.[0];
    expect(sent).toEqual({
      uid: NTAG_UID,
      raw: bytesToHex(NTAG_CAPTURE.payload),
      atqa: "44 00",
      sak: "00",
      cardType: "MIFARE Ultralight / NTAG21x",
      capacityBytes: 496,
      ndefFormatted: true,
      records: [
        { kind: "text", fields: { language: "en", text: "hello" } },
        { kind: "url", fields: { url: "https://devgo.studio" } },
      ],
    });

    // One action, one outcome: the line beside the readout and the sound agree.
    await screen.findByText("Saved to the library as Snapshot 1.");
    expect(symbols).toEqual(["done", "done"]);
    stop();
  });

  it("reports a repeat read as already saved, silently and without adding it twice", async () => {
    const saveHf = vi.fn(async (_read: HfSnapshotSave) =>
      ({ outcome: "duplicate", library: libraryView([SAVED]), snapshot: SAVED }) as SaveResult,
    );
    const { user, symbols, stop } = await readInto(saveHf);

    await user.click(screen.getByRole("button", { name: "Save to library" }));

    await screen.findByText("Already in the library as Snapshot 1.");
    // A repeat is informational: it changed nothing, so it sounds nothing
    // (ADR 0009). The read that preceded it still did.
    expect(symbols).toEqual(["done"]);
    stop();
  });

  it("reports a refused file, and never claims the read was saved", async () => {
    const saveHf = vi.fn(async (_read: HfSnapshotSave) =>
      ({
        outcome: "refused",
        library: {
          ...libraryView([]),
          problem: {
            kind: "newerVersion",
            message: "This library was written by a newer version of PM4 Studio.",
            detail: null,
          },
        },
        snapshot: null,
      }) as SaveResult,
    );
    const { user, symbols, stop } = await readInto(saveHf);

    await user.click(screen.getByRole("button", { name: "Save to library" }));

    await screen.findByText(/newer version of PM4 Studio/);
    expect(screen.queryByText(/^Saved to the library/)).toBeNull();
    expect(symbols[symbols.length - 1]).toBe("attention");
    stop();
  });

  it("offers the save only once something has been decoded", async () => {
    fakeBackend({});
    const { user } = renderUi(
      <HfPage
        connected
        mode="read"
        onModeChange={() => {}}
        onPoll={async () => UNKNOWN_CAPTURE}
        library={libraryState()}
      />,
    );

    const before = screen.getByRole("button", { name: "Save to library" }) as HTMLButtonElement;
    expect(before.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Read tag" }));
    await screen.findByText("Not decoded");

    // The bytes are on screen, but there is no UID to name a Snapshot with.
    expect(
      (screen.getByRole("button", { name: "Save to library" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
