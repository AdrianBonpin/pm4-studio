import { describe, expect, it } from "vitest";
import { encodeNdefMessage, textRecord, urlRecord } from "./ndef";
import { decodeHfPayload } from "./hfDecoder";
import {
  assembleHfRead,
  type HfMessage,
  type HfMessageState,
  type HfRead,
  type HfRecordsAttempt,
} from "./hfRead";
import {
  hfSnapshotSave,
  recordsToSave,
  savedRecordsLabel,
  snapshotRecords,
} from "./hfSnapshot";
import type { DraftRecord } from "./drafts";
import { bytesToHex } from "./tagWrite";
import type { MemoryDump } from "./memoryDump";
import type { TagNdef, TagRecordsRead } from "./tagRecords";

/**
 * Ticket 09 — saving a 13.56 MHz read.
 *
 * This module is the seam between what a tap produced (`./hfRead`) and what the
 * library file keeps (`src-tauri/src/library.rs`). The persistence itself is
 * proven in Rust against a temp directory; what is proven here is the mapping —
 * that a decoded read is saved whole, that an undecoded one is saved at all, and
 * that "no Records" and "not read" stay different values on the way to disk.
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

/** A pair no published table assigns: there is nothing to name. */
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

const MESSAGE = [textRecord("en", "hello"), urlRecord("https://devgo.studio")];

function dump(uid: string): MemoryDump {
  return {
    status: 0,
    tag: { uid, tagType: 0x02, capturedAt: "2026-11-22T10:00:00.000Z" },
    pageCount: 256,
    readablePages: 34,
    rows: [],
  };
}

function recordsRead(patch: Partial<TagNdef> = {}): TagRecordsRead {
  const hex = bytesToHex(encodeNdefMessage(MESSAGE));
  return {
    dump: dump(NTAG_UID),
    ndef: {
      outcome: "message",
      messageHex: hex,
      messageBytes: MESSAGE.length,
      userMemoryHex: "",
      userMemoryBytes: 496,
      capacityBytes: 496,
      userPages: 124,
      capabilityContainerHex: "E1 10 3E 00",
      reason: null,
      ...patch,
    },
  };
}

function read(
  capture: readonly number[] = NTAG_CAPTURE,
  attempt: HfRecordsAttempt = attemptWith(recordsRead()),
): HfRead {
  return assembleHfRead(decodeHfPayload(capture), attempt);
}

function attemptWith(read: TagRecordsRead): { state: "read"; read: TagRecordsRead } {
  return { state: "read", read };
}

describe("what a saved 13.56 MHz read holds", () => {
  it("keeps the identity, the family, the capacity, the NDEF status, the raw reply and the Records", () => {
    const save = hfSnapshotSave(read());
    expect(save).not.toBeNull();

    expect(save).toEqual({
      uid: NTAG_UID,
      raw: bytesToHex(NTAG_CAPTURE),
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
  });

  it("keeps the Records in the order the Tag holds them", () => {
    const save = hfSnapshotSave(read());
    expect(save?.records?.map((record) => record.kind)).toEqual(["text", "url"]);
  });

  it("has nothing to save when the poll did not decode", () => {
    // There is no UID, so there is no Snapshot to name. Saving the bytes alone
    // would store something that reads as a Tag and is not one.
    expect(hfSnapshotSave(read(UNKNOWN_PAIR, { state: "not-attempted" }))).toBeNull();
  });

  it("has nothing to save when nothing was latched", () => {
    expect(hfSnapshotSave(assembleHfRead(null, { state: "not-attempted" }))).toBeNull();
  });

  it("saves a Tag whose family cannot hold NDEF, with no Records", () => {
    // A complete answer, not a missing one: the family implements no NFC Forum
    // tag type, so it holds no NDEF message and the list is empty.
    const classic = [
      0x01, 0x01,
      0x31, 0xf3, 0x0e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x04,
      0x04, 0x00,
      0x08,
      0x01,
      0x10, 0x00,
    ];
    const save = hfSnapshotSave(read(classic, { state: "not-attempted" }));

    expect(save?.cardType).toBe("MIFARE Classic 1K");
    expect(save?.records).toEqual([]);
  });
});

describe("no Records, and not read, are different values", () => {
  it("saves an empty list for a Tag that was read and holds nothing", () => {
    const empty = assembleHfRead(decodeHfPayload(NTAG_CAPTURE), attemptWith(
      recordsRead({ outcome: "empty", messageHex: "", messageBytes: 0 }),
    ));
    expect(hfSnapshotSave(empty)?.records).toEqual([]);
  });

  it("saves no list for a message that was never read", () => {
    // The poll decoded and the message read failed. The identity is worth
    // keeping; the Records are unknown, which is not the same as none.
    const failed = assembleHfRead(decodeHfPayload(NTAG_CAPTURE), {
      state: "failed",
      reason: "the Reader stopped answering",
    });
    expect(hfSnapshotSave(failed)?.records).toBeNull();
  });

  it("saves no list for a message that came back for another Tag", () => {
    const other = assembleHfRead(
      decodeHfPayload(NTAG_CAPTURE),
      attemptWith({ ...recordsRead(), dump: dump("DE AD BE EF") }),
    );
    expect(hfSnapshotSave(other)?.records).toBeNull();
  });

  it("answers every message state, and only a read one may be an empty list", () => {
    // The table, state by state: the four complete answers save an empty list,
    // and every state in which nothing was settled saves nothing at all.
    const cases: [HfMessageState, DraftRecord[] | null][] = [
      ["records", []],
      ["empty-message", []],
      ["no-ndef-tlv", []],
      ["not-formatted", []],
      ["not-ndef-capable", []],
      ["undecodable", null],
      ["unreadable", null],
      ["read-failed", null],
      ["other-tag", null],
      ["undecoded-reply", null],
      ["nothing-latched", null],
    ];
    for (const [state, expected] of cases) {
      expect(recordsToSave(half(state)), state).toEqual(expected);
    }
  });
});

describe("the Records a stored Snapshot holds", () => {
  const base = {
    name: "Office door",
    note: "",
    capturedAt: "2026-11-21T09:30:00.000Z",
    writeCount: 0,
  } as const;

  it("is null for a 125 kHz Snapshot, which has no message at all", () => {
    expect(
      snapshotRecords({
        ...base,
        id: "55 00 84 82 12",
        kind: "LF",
        identity: { customer: 0x55, data32: 0x0084_8212, facility: 132, card: 33298, raw: "" },
      }),
    ).toBeNull();
  });

  it("is null when the file recorded no list, and [] when it recorded an empty one", () => {
    const legacy = { ...base, id: "04 A2 2B 3A 5C 6D 81", kind: "HF" as const };
    expect(
      snapshotRecords({ ...legacy, hf: { uid: "04 A2 2B 3A 5C 6D 81", raw: "01 01" } }),
    ).toBeNull();
    expect(
      snapshotRecords({
        ...legacy,
        hf: { uid: "04 A2 2B 3A 5C 6D 81", raw: "01 01", records: [] },
      }),
    ).toEqual([]);
  });

  it("is the list itself when one was recorded", () => {
    const records: DraftRecord[] = [{ kind: "url", fields: { url: "https://devgo.studio" } }];
    expect(
      snapshotRecords({
        ...base,
        id: "04 A2 2B 3A 5C 6D 80",
        kind: "HF",
        hf: { uid: "04 A2 2B 3A 5C 6D 80", raw: "01 01", records },
      }),
    ).toEqual(records);
  });
});

describe("what a Snapshot's Records are, in words", () => {
  it("distinguishes none from not recorded", () => {
    expect(savedRecordsLabel([])).toBe("none");
    expect(savedRecordsLabel(null)).toBe("not recorded");
    expect(savedRecordsLabel(undefined)).toBe("not recorded");
    const text: DraftRecord = { kind: "text", fields: { language: "en", text: "hello" } };
    expect(savedRecordsLabel([text, text])).toBe("2 Records");
    expect(savedRecordsLabel([text])).toBe("1 Record");
  });
});

/** A message half in one state, carrying nothing: the state is the whole point. */
function half(state: HfMessageState): HfMessage {
  return {
    state,
    note: "what this state means, in a sentence",
    reason: null,
    records: [],
    rows: [],
    bytes: null,
    messageHex: null,
  };
}
