import { describe, expect, it } from "vitest";
import { encodeNdefMessage, textRecord, urlRecord, type NdefRecord } from "./ndef";
import { decodeHfPayload, ndefField, type HfReading } from "./hfDecoder";
import { ALL_OUTCOME_KINDS, signalOf } from "./outcome";
import {
  assembleHfRead,
  hfReadOutcome,
  readsMessage,
  RECORD_SUMMARY_MAX,
  type HfRead,
} from "./hfRead";
import { hexToBytes, bytesToHex } from "./tagWrite";
import type { MemoryDump } from "./memoryDump";
import type { TagNdef, TagRecordsRead } from "./tagRecords";

/**
 * Ticket 08 — one Read on 13.56 MHz fetches the identity and the message.
 *
 * The two device transactions are separate and either can fail, so the cases
 * that matter most here are the ones where they disagree: a poll that decoded
 * and a message read that did not. What is asserted is not that the readout
 * looks complete, but that it never claims to be when it is not.
 *
 * The poll captures are the measured ones from ticket 06 (MIFARE Classic 1K,
 * UID 31 F3 0E 0A; NTAG215, UID 04 43 8A 01 22 09 03), transcribed from the
 * spec rather than from this build. The message is built with the NDEF codec,
 * which is the same codec the write path uses, so a Record's encoded size here
 * is a size this app can actually write.
 */

/** NTAG215, UID `04 43 8A 01 22 09 03`; ATQA 0x0044, SAK 0x00. */
const NTAG_CAPTURE = [
  0x01, 0x01,
  0x04, 0x43, 0x8a, 0x01, 0x22, 0x09, 0x03, 0x1d, 0x00, 0x20,
  0x07,
  0x44, 0x00,
  0x00,
  0x02,
  0x00, 0x00,
];

/** MIFARE Classic 1K, UID `31 F3 0E 0A`; ATQA 0x0004, SAK 0x08. */
const CLASSIC_CAPTURE = [
  0x01, 0x01,
  0x31, 0xf3, 0x0e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04,
  0x04, 0x00,
  0x08,
  0x01,
  0x10, 0x00,
];

/** A pair no published table assigns: ATQA 0x2211, SAK 0x5A. */
const UNKNOWN_PAIR = [
  0x01, 0x01,
  0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04,
  0x11, 0x22,
  0x5a,
  0x01,
  0x00, 0x00,
];

const NTAG_UID = "04 43 8A 01 22 09 03";
const CLASSIC_UID = "31 F3 0E 0A";

/** The recorded Type 2 TLV's message: a URL Record for https://devgo.studio. */
const RECORDED_MESSAGE = "D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F";

function messageHex(records: NdefRecord[]): string {
  return bytesToHex(encodeNdefMessage(records));
}

function decoded(capture: readonly number[]): Extract<HfReading, { state: "decoded" }> {
  const reading = decodeHfPayload(capture);
  if (reading.state !== "decoded") throw new Error(`the fixture did not decode: ${reading.reason}`);
  return reading;
}

function dump(uid: string): MemoryDump {
  return {
    status: 0,
    tag: { uid, tagType: 0x02, capturedAt: "2026-11-22T10:00:00.000Z" },
    pageCount: 256,
    readablePages: 34,
    rows: [],
  };
}

function ndef(patch: Partial<TagNdef> = {}): TagNdef {
  return {
    outcome: "message",
    messageHex: RECORDED_MESSAGE,
    messageBytes: 17,
    userMemoryHex: "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE",
    userMemoryBytes: 496,
    capacityBytes: 496,
    userPages: 124,
    capabilityContainerHex: "E1 10 3E 00",
    reason: null,
    ...patch,
  };
}

function recordsRead(patch: Partial<TagNdef> = {}, uid = NTAG_UID): TagRecordsRead {
  return { dump: dump(uid), ndef: ndef(patch) };
}

/** The whole read, as the page performs it: a poll, then whatever followed. */
function readOf(
  capture: readonly number[] | null,
  attempt: Parameters<typeof assembleHfRead>[1],
): HfRead {
  return assembleHfRead(capture === null ? null : decodeHfPayload(capture), attempt);
}

const NOT_ATTEMPTED = { state: "not-attempted" } as const;

describe("a fully read 13.56 MHz Tag", () => {
  it("reports the UID, card type, capacity, NDEF status and the Records", () => {
    const read = readOf(NTAG_CAPTURE, { state: "read", read: recordsRead() });

    expect(read.reading?.state).toBe("decoded");
    expect(read.reading?.state === "decoded" && read.reading.uid).toBe(NTAG_UID);
    expect(read.reading?.state === "decoded" && read.reading.cardType.family).toBe(
      "MIFARE Ultralight / NTAG21x",
    );
    // The published table withholds capacity for this family, so it comes from
    // the Capability Container the same memory read carried.
    expect(read.capacityBytes).toBe(496);
    expect(read.ndef.formatted).toBe(true);
    expect(ndefField(read.ndef)).toEqual({ label: "NDEF formatted", value: "yes" });
    expect(read.message.state).toBe("records");
    expect(read.message.rows).toHaveLength(1);
    expect(read.message.rows[0]).toMatchObject({
      position: 1,
      kind: "URL",
      summary: "https://devgo.studio",
      valid: true,
      problem: null,
    });
  });

  it("reports one successful outcome, whose symbol is a single chirp", () => {
    const outcome = hfReadOutcome(readOf(NTAG_CAPTURE, { state: "read", read: recordsRead() }));

    expect(outcome.kind).toBe("read");
    expect(outcome.operation).toBe("hf-read");
    expect(outcome.severity).toBe("success");
    expect(signalOf(outcome)).toBe("done");
    expect(outcome.message).toBe(`Read ${NTAG_UID} — 1 Record.`);
  });

  it("lists the Records as rows in the Tag's own order, with size and validity", () => {
    const records = [
      textRecord("en", "hello"),
      urlRecord("https://devgo.studio"),
      textRecord("en", "second"),
    ];
    const message = messageHex(records);
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({ messageHex: message, messageBytes: message.split(" ").length }),
    });

    expect(read.message.state).toBe("records");
    expect(read.message.rows.map((row) => row.position)).toEqual([1, 2, 3]);
    expect(read.message.rows.map((row) => row.kind)).toEqual(["Text", "URL", "Text"]);
    expect(read.message.rows.map((row) => row.summary)).toEqual([
      "hello",
      "https://devgo.studio",
      "second",
    ]);
    // The size is the bytes the Record occupies in the message the Tag holds:
    // header, type length, payload length, type and payload.
    expect(read.message.rows.map((row) => row.bytes)).toEqual(
      records.map((record) => 1 + 1 + 1 + record.type.length + record.payload.length),
    );
    expect(read.message.rows.every((row) => row.valid)).toBe(true);
    expect(read.message.bytes).toBe(encodeNdefMessage(records).length);
  });

  it("shortens a long summary so a row stays a row", () => {
    const long = "x".repeat(RECORD_SUMMARY_MAX * 2);
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({ messageHex: messageHex([textRecord("en", long)]) }),
    });

    const summary = read.message.rows[0]?.summary ?? "";
    expect(summary).toHaveLength(RECORD_SUMMARY_MAX);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("keeps a Record that decodes but cannot be re-encoded, marked invalid, with its wire size", () => {
    // A MIME Record whose media type has no "/": the tag's bytes decode into a
    // Record this build cannot encode again, which is exactly what "validity"
    // is for — and its size still comes from the bytes on the Tag.
    const wire: NdefRecord[] = [
      { tnf: 0x02, type: [0x78], payload: [0x01, 0x02] },
    ];
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({ messageHex: messageHex(wire) }),
    });

    expect(read.message.state).toBe("records");
    expect(read.message.rows[0]?.valid).toBe(false);
    expect(read.message.rows[0]?.problem).toContain("media type");
    expect(read.message.rows[0]?.bytes).toBe(1 + 1 + 1 + 1 + 2);
  });

  it("treats a formatted Tag holding no message as a complete read", () => {
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({ outcome: "empty", messageHex: "", messageBytes: 0 }),
    });

    expect(read.message.state).toBe("empty-message");
    expect(read.message.rows).toEqual([]);
    expect(read.ndef.formatted).toBe(true);
    expect(signalOf(hfReadOutcome(read))).toBe("done");
  });

  it("reports an unformatted Tag from its container, not from the poll", () => {
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({
        outcome: "notFormatted",
        messageHex: "",
        messageBytes: 0,
        reason: "page 3 is not a Type 2 Capability Container",
      }),
    });

    expect(read.message.state).toBe("not-formatted");
    expect(read.ndef.formatted).toBe(false);
    expect(ndefField(read.ndef)).toEqual({ label: "NDEF formatted", value: "no" });
    expect(hfReadOutcome(read).kind).toBe("read");
  });
});

describe("a Tag whose family cannot hold NDEF", () => {
  it("says so, gives the capacity the pair determines, and attempts no message read", () => {
    const reading = decoded(CLASSIC_CAPTURE);
    expect(readsMessage(reading)).toBe(false);

    const read = readOf(CLASSIC_CAPTURE, NOT_ATTEMPTED);

    expect(read.reading?.state === "decoded" && read.reading.uid).toBe(CLASSIC_UID);
    expect(read.message.state).toBe("not-ndef-capable");
    expect(read.message.rows).toEqual([]);
    expect(read.message.note).toContain("no NFC Forum tag type");
    // Capacity comes from the published table where the pair determines it.
    expect(read.capacityBytes).toBe(1024);
  });

  it("never derives NDEF formatting from the poll", () => {
    const read = readOf(CLASSIC_CAPTURE, NOT_ATTEMPTED);

    // The family cannot hold NDEF, but that is said in words; the formatted
    // field is a property of a memory read and there was none.
    expect(read.ndef.formatted).toBeNull();
    expect(ndefField(read.ndef)).toBeNull();
    expect(read.ndef.note).toContain("MIFARE Classic 1K");
  });

  it("is still a complete read, so it sounds done", () => {
    const outcome = hfReadOutcome(readOf(CLASSIC_CAPTURE, NOT_ATTEMPTED));
    expect(outcome.severity).toBe("success");
    expect(signalOf(outcome)).toBe("done");
  });
});

describe("a reply that cannot be decoded", () => {
  it("shows the raw bytes and the reason, and attempts no message read", () => {
    const read = readOf(UNKNOWN_PAIR, NOT_ATTEMPTED);

    expect(read.reading?.state).toBe("raw");
    expect(read.reading?.raw.length).toBeGreaterThan(0);
    expect(read.message.state).toBe("undecoded-reply");
    expect(read.message.rows).toEqual([]);
    expect(read.message.rows.length).toBe(0);
    expect(read.capacityBytes).toBeNull();
    expect(read.ndef.formatted).toBeNull();
  });

  it("sounds needs-you rather than done", () => {
    const outcome = hfReadOutcome(readOf(UNKNOWN_PAIR, NOT_ATTEMPTED));
    expect(outcome.kind).toBe("read-incomplete");
    expect(outcome.severity).toBe("warning");
    expect(signalOf(outcome)).toBe("needs-you");
    expect(outcome.detail).toContain("ATQA");
  });
});

describe("a poll that succeeds with a Records read that fails", () => {
  it("keeps the identity it did get and says why the Records are absent", () => {
    const read = readOf(NTAG_CAPTURE, {
      state: "failed",
      reason: "the Reader stopped answering during the memory read",
    });

    // The identity half is exactly what it was: the poll did happen.
    expect(read.reading?.state === "decoded" && read.reading.uid).toBe(NTAG_UID);
    expect(read.reading?.state === "decoded" && read.reading.cardType.family).toBe(
      "MIFARE Ultralight / NTAG21x",
    );
    // Nothing is dressed up as fetched.
    expect(read.message.state).toBe("read-failed");
    expect(read.message.rows).toEqual([]);
    expect(read.message.reason).toBe("the Reader stopped answering during the memory read");
    expect(read.message.note).toContain("Reader stopped answering");
    expect(read.ndef.formatted).toBeNull();
    // The table withholds capacity for this family and there was no container.
    expect(read.capacityBytes).toBeNull();
  });

  it("sounds needs-you, and the message still names the Tag that was read", () => {
    const outcome = hfReadOutcome(
      readOf(NTAG_CAPTURE, { state: "failed", reason: "the memory read timed out" }),
    );

    expect(outcome.kind).toBe("read-incomplete");
    expect(outcome.severity).toBe("warning");
    expect(signalOf(outcome)).toBe("needs-you");
    expect(outcome.message).toContain(NTAG_UID);
    expect(outcome.detail).toContain("memory read timed out");
  });

  it("still reports the capacity the pair determines, when it determines one", () => {
    const read = assembleHfRead(decoded(CLASSIC_CAPTURE), { state: "not-attempted" });
    expect(read.message.state).toBe("not-ndef-capable");

    // A family the table withholds capacity for, with a failed read, says
    // "not determined" rather than guessing from the family.
    const failed = readOf(NTAG_CAPTURE, { state: "failed", reason: "no answer" });
    expect(failed.capacityBytes).toBeNull();
  });
});

describe("a memory read of a different Tag", () => {
  it("never attaches itself to this reading", () => {
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({}, "DE AD BE EF"),
    });

    expect(read.message.state).toBe("other-tag");
    expect(read.message.rows).toEqual([]);
    expect(read.memory).toBeNull();
    // Not even the other Tag's Capability Container may supply a capacity.
    expect(read.capacityBytes).toBeNull();
    // And it must not settle NDEF formatting for this Tag.
    expect(read.ndef.formatted).toBeNull();
  });

  it("reports a warning, because the Records a user expects are not there", () => {
    const outcome = hfReadOutcome(
      readOf(NTAG_CAPTURE, { state: "read", read: recordsRead({}, "DE AD BE EF") }),
    );
    expect(outcome.kind).toBe("read-incomplete");
    expect(signalOf(outcome)).toBe("needs-you");
  });
});

describe("nothing latched", () => {
  it("reports one informational outcome, which is silent", () => {
    const read = assembleHfRead(null, NOT_ATTEMPTED);

    expect(read.reading).toBeNull();
    expect(read.message.state).toBe("nothing-latched");
    expect(read.capacityBytes).toBeNull();
    expect(read.ndef.formatted).toBeNull();

    const outcome = hfReadOutcome(read);
    expect(outcome.kind).toBe("nothing-latched");
    expect(signalOf(outcome)).toBe("silent");
  });
});

describe("a message this build cannot decode", () => {
  it("is a warning with the raw bytes, never a complete read", () => {
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({
        messageHex: "FF FF",
        messageBytes: 2,
        reason: null,
      }),
    });

    expect(read.message.state).toBe("undecodable");
    expect(read.message.rows).toEqual([]);
    expect(read.message.reason).not.toBeNull();
    expect(signalOf(hfReadOutcome(read))).toBe("needs-you");
    // The container was read, so NDEF formatting is still known.
    expect(read.ndef.formatted).toBe(true);
  });

  it("reports an unparseable NDEF area as unreadable, and unknown formatting", () => {
    const read = readOf(NTAG_CAPTURE, {
      state: "read",
      read: recordsRead({ outcome: "unreadable", messageHex: "", messageBytes: 0 }),
    });

    expect(read.message.state).toBe("unreadable");
    expect(read.ndef.formatted).toBeNull();
    expect(hfReadOutcome(read).kind).toBe("read-incomplete");
  });
});

describe("the operation reports exactly one outcome", () => {
  const CASES: Array<[string, HfRead]> = [
    ["fully read", readOf(NTAG_CAPTURE, { state: "read", read: recordsRead() })],
    ["classic", readOf(CLASSIC_CAPTURE, NOT_ATTEMPTED)],
    ["raw reply", readOf(UNKNOWN_PAIR, NOT_ATTEMPTED)],
    ["records read failed", readOf(NTAG_CAPTURE, { state: "failed", reason: "gone" })],
    ["other tag", readOf(NTAG_CAPTURE, { state: "read", read: recordsRead({}, "DE AD BE EF") })],
    ["nothing latched", assembleHfRead(null, NOT_ATTEMPTED)],
  ];

  it.each(CASES)("names a known kind for a %s read", (_label, read) => {
    const outcome = hfReadOutcome(read);
    expect(ALL_OUTCOME_KINDS).toContain(outcome.kind);
    expect(outcome.operation).toBe("hf-read");
    expect(outcome.message.trim().length).toBeGreaterThan(0);
  });

  it("only ever distinguishes read-fully from read-but-check", () => {
    const okay = CASES.filter(([label]) => label === "fully read" || label === "classic");
    const check = CASES.filter(([label]) => !["fully read", "classic", "nothing latched"].includes(label));

    for (const [, read] of okay) expect(signalOf(hfReadOutcome(read))).toBe("done");
    for (const [, read] of check) expect(signalOf(hfReadOutcome(read))).toBe("needs-you");
  });

  it("reads the message only for a decoded family with an NFC Forum type", () => {
    expect(readsMessage(decoded(NTAG_CAPTURE))).toBe(true);
    expect(readsMessage(decoded(CLASSIC_CAPTURE))).toBe(false);
    const raw = decodeHfPayload(UNKNOWN_PAIR);
    expect(readsMessage(raw)).toBe(false);
  });

  it("reads the recorded message the way the tag holds it", () => {
    const read = readOf(NTAG_CAPTURE, { state: "read", read: recordsRead() });
    expect(read.message.messageHex).toBe(RECORDED_MESSAGE);
    expect(hexToBytes(read.message.messageHex ?? "")).toHaveLength(17);
  });
});
