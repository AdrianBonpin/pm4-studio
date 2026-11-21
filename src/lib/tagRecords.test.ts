import { describe, expect, it } from "vitest";
import { encodeNdefMessage, textRecord, urlRecord } from "./ndef";
import {
  draftNameForTag,
  loadTagRecords,
  rawRows,
  recordLine,
  type TagNdef,
  type TagNdefOutcome,
  type TagRecordsRead,
} from "./tagRecords";
import { bytesToHex, draftMessageHex } from "./tagWrite";
import type { DumpRow, MemoryDump } from "./memoryDump";

/**
 * Ticket 22 — loading a Tag's Records into a Draft.
 *
 * The read this is tested against is the one recorded in docs/PROTOCOL.md: an
 * NTAG215 whose pages 4..8 hold `03 11 D1 01 0D 55 04 "devgo.studio" FE`, a URL
 * Record for https://devgo.studio. Those bytes are transcribed here, not
 * captured from this code, so the test is evidence rather than a mirror.
 *
 * The failure mode under test is the quiet one: a Draft that holds the Records
 * this build could decode and silently drops the rest. Every case below either
 * produces all of the Records or produces no Draft at all.
 */

/** The recorded Type 2 TLV: `03 <len> <message> FE`, pages 4..8. */
const RECORDED_TLV =
  "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE";
/** The message it wraps: a well-known URL Record, URI prefix 04 = https://. */
const RECORDED_MESSAGE = "D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F";
const UID = "04 43 8A 01 22 09 03";
const CAPTURED_AT = "2026-11-21T09:30:00.000Z";

function ndef(patch: Partial<TagNdef> = {}): TagNdef {
  return {
    outcome: "message",
    messageHex: RECORDED_MESSAGE,
    messageBytes: 0x11,
    userMemoryHex: RECORDED_TLV,
    userMemoryBytes: 496,
    capacityBytes: 496,
    userPages: 124,
    capabilityContainerHex: "E1 10 3E 00",
    reason: null,
    ...patch,
  };
}

function dumpRow(firstPage: number, states: number[]): DumpRow {
  return {
    firstPage,
    lastPage: firstPage + states.length - 1,
    offset: firstPage * 4,
    hex: "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ascii: "................",
    pageStates: states,
    stateLabel: states.every((state) => state === 1) ? "ok" : `state ${states[0]}`,
    readable: states.every((state) => state === 1),
  };
}

function dump(rows: DumpRow[] = [dumpRow(0, [1, 1, 1, 1])]): MemoryDump {
  return {
    status: 0,
    tag: { uid: UID, tagType: 5, capturedAt: CAPTURED_AT },
    pageCount: 256,
    readablePages: rows.filter((row) => row.readable).length * 4,
    rows,
  };
}

function read(patch: Partial<TagNdef> = {}, rows?: DumpRow[]): TagRecordsRead {
  return { dump: dump(rows), ndef: ndef(patch) };
}

describe("the recorded NTAG215 read", () => {
  it("loads its one Record, in the tag's order, as a Draft", () => {
    const load = loadTagRecords(read());

    expect(load.kind).toBe("records");
    expect(load.records).toEqual([{ kind: "url", fields: { url: "https://devgo.studio" } }]);
    expect(load.bytes).toBe(0x11);
    expect(load.messageHex).toBe(RECORDED_MESSAGE);
    expect(load.detail).toBe("Loaded 1 Record: URL https://devgo.studio.");
    expect(load.raw).toBe(false);
  });

  it("gives back the tag's own message when the loaded Draft is encoded again", () => {
    // The read-edit-rewrite loop with nothing edited: what a write would send
    // must be the bytes the Tag already holds, to the byte.
    const load = loadTagRecords(read());

    expect(draftMessageHex(load.records)).toBe(RECORDED_MESSAGE);
  });

  it("names the Draft after the tag it came from", () => {
    expect(draftNameForTag(dump())).toBe(`Tag ${UID}`);
    expect(draftNameForTag({ ...dump(), tag: { ...dump().tag, uid: "  " } })).toBe("Tag");
  });
});

describe("order and fields", () => {
  it("keeps every Record and its position through a read", () => {
    // Two Records of two kinds, encoded as one message: a URL then a Text.
    const message = encodeNdefMessage([
      urlRecord("https://devgo.studio"),
      textRecord("en", "hello"),
    ]);
    const load = loadTagRecords(
      read({ messageHex: bytesToHex(message), messageBytes: message.length }),
    );

    expect(load.kind).toBe("records");
    expect(load.records).toEqual([
      { kind: "url", fields: { url: "https://devgo.studio" } },
      { kind: "text", fields: { language: "en", text: "hello" } },
    ]);
    expect(load.records.map((record) => record.kind)).toEqual(["url", "text"]);
    expect(load.detail).toBe("Loaded 2 Records, starting with URL https://devgo.studio.");
  });

  it("lists a Record's kind and value for the confirmation", () => {
    expect(recordLine({ kind: "url", fields: { url: "https://devgo.studio" } })).toBe(
      "URL: https://devgo.studio",
    );
    expect(recordLine({ kind: "text", fields: { language: "en", text: "" } })).toBe(
      "Text (empty)",
    );
  });
});

describe("a tag whose Records cannot be decoded", () => {
  it("falls back to raw bytes rather than a half-populated Draft", () => {
    // D3 = MB|ME|SR, TNF 0x03 (Absolute URI): a valid NDEF Record whose payload
    // form this build deliberately does not represent.
    const load = loadTagRecords(
      read({ messageHex: "D3 01 04 05 68 74 74 70", messageBytes: 9 }),
    );

    expect(load.kind).toBe("undecodable");
    expect(load.records).toEqual([]);
    expect(load.raw).toBe(true);
    expect(load.messageHex).toBe("D3 01 04 05 68 74 74 70");
    expect(load.detail).toContain("TNF 0x03");
    expect(load.detail).toContain("nothing was loaded");
  });

  it("keeps none of the Records it could read when one of them cannot be decoded", () => {
    // The failure mode worth naming: a URL Record this build reads fine,
    // followed by one it cannot. Half a message must never look like a Draft.
    const half =
      "91 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F" + // URL, ME clear
      " 53 01 04 05 68 74 74 70"; // Absolute URI, ME set
    const load = loadTagRecords(read({ messageHex: half, messageBytes: 26 }));

    expect(load.kind).toBe("undecodable");
    expect(load.records).toEqual([]);
    expect(load.detail).toContain("silently drop the rest");
  });

  it("treats an outcome this build has not been taught as unreadable, not empty", () => {
    const load = loadTagRecords(read({ outcome: "brandNew" as TagNdefOutcome }));

    expect(load.kind).toBe("unreadable");
    expect(load.records).toEqual([]);
    expect(load.raw).toBe(true);
    expect(load.detail).toContain("brandNew");
  });
});

describe("the edge cases, each with its own answer", () => {
  it("an empty NDEF TLV is an empty message, not a failure", () => {
    const load = loadTagRecords(
      read({
        outcome: "empty",
        messageHex: "",
        messageBytes: 0,
        userMemoryHex: "03 00 FE 00",
        reason: "the NDEF TLV is empty",
      }),
    );

    expect(load.kind).toBe("emptyMessage");
    expect(load.records).toEqual([]);
    expect(load.detail).toContain("zero Records");
    expect(load.detail).toContain("nothing to load");
  });

  it("no NDEF TLV at all is said plainly, and is not the same as an empty message", () => {
    const load = loadTagRecords(read({ outcome: "missing", messageHex: "", messageBytes: 0 }));

    expect(load.kind).toBe("noNdefTlv");
    expect(load.kind).not.toBe("emptyMessage");
    expect(load.records).toEqual([]);
    expect(load.detail).toContain("no NDEF TLV");
  });

  it("a tag that is not NDEF formatted says so and shows its raw bytes", () => {
    const load = loadTagRecords(
      read({
        outcome: "notFormatted",
        messageHex: "",
        messageBytes: 0,
        userMemoryHex: "",
        userMemoryBytes: 0,
        capacityBytes: null,
        userPages: null,
        capabilityContainerHex: "00 00 00 00",
        reason: "page 3 holds 00 00 00 00 instead of a Type 2 Capability Container",
      }),
    );

    expect(load.kind).toBe("notFormatted");
    expect(load.raw).toBe(true);
    expect(load.detail).toContain("not NDEF formatted");
    expect(load.detail).toContain("00 00 00 00");
  });

  it("a truncated TLV quotes the reason rather than guessing at the message", () => {
    const load = loadTagRecords(
      read({
        outcome: "unreadable",
        messageHex: "",
        messageBytes: 0,
        reason: "the NDEF TLV declares 496 message bytes and only 491 remain",
      }),
    );

    expect(load.kind).toBe("unreadable");
    expect(load.records).toEqual([]);
    expect(load.raw).toBe(true);
    expect(load.detail).toContain("declares 496 message bytes");
    expect(load.detail).toContain("Nothing was loaded");
  });

  it("a message that decodes to zero Records is its own outcome", () => {
    // The empty-message case reached from the other side: a tag that reports a
    // message whose bytes are zero. It is named, not run through the codec,
    // whose "no bytes, so no NDEF message" error would read as a failure.
    const load = loadTagRecords(read({ messageHex: "", messageBytes: 0 }));

    expect(load.kind).toBe("zeroRecords");
    expect(load.records).toEqual([]);
    expect(load.raw).toBe(true);
    expect(load.detail).toContain("zero Records");
    expect(load.detail).toContain("nothing to load");
  });
});

describe("the raw fallback view", () => {
  it("shows every row the Reader read, and trims the pages outside the tag", () => {
    const rows = [
      dumpRow(0, [1, 1, 1, 1]),
      dumpRow(4, [1, 1, 1, 1]),
      dumpRow(8, [1, 1, 3, 3]),
      dumpRow(252, [3, 3, 3, 3]),
    ];
    expect(rawRows(dump(rows)).map((row) => row.firstPage)).toEqual([0, 4, 8]);
  });

  it("has nothing to show when no page was read", () => {
    expect(rawRows(dump([dumpRow(0, [3, 3, 3, 3])]))).toEqual([]);
  });
});
