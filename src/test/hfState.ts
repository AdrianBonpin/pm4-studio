/**
 * A 13.56 MHz Tag, as the page receives one, for the page's own tests.
 *
 * The capture is the NTAG215 from `docs/PROTOCOL.md` — the reply measured off the
 * hardware — and the records read beside it is what the second transaction
 * returns. Both pages of 13.56 MHz work (the Read mode and the Memory mode) are
 * held against the same Tag, so a test that moves between them is looking at one
 * reading rather than two fixtures that happen to agree.
 */

import { encodeNdefMessage, textRecord, urlRecord, type NdefRecord } from "../lib/ndef";
import { bytesToHex, hexToBytes } from "../lib/tagWrite";
import type { MemoryDump } from "../lib/memoryDump";
import type { TagNdef, TagRecordsRead } from "../lib/tagRecords";
import type { HfCard } from "../types";

/** An NTAG215 latched and reported: a 7-byte UID, ATQA 0x0044, SAK 0x00. */
export const NTAG_CAPTURE: HfCard = {
  payload: [
    0x01, 0x01,
    0x04, 0x43, 0x8a, 0x01, 0x22, 0x09, 0x03, 0x1d, 0x00, 0x20,
    0x07,
    0x44, 0x00,
    0x00,
    0x02,
    0x00, 0x00,
  ],
};

export const NTAG_UID = "04 43 8A 01 22 09 03";

/** The message the Tag holds: two Records, in this order. */
export const MESSAGE: NdefRecord[] = [
  textRecord("en", "hello"),
  urlRecord("https://devgo.studio"),
];

/** A memory dump with no rows: the page's tests assert identity, not pages. */
export function dump(uid: string): MemoryDump {
  return {
    status: 0,
    tag: { uid, tagType: 0x02, capturedAt: "2026-11-22T10:00:00.000Z" },
    pageCount: 256,
    readablePages: 34,
    rows: [],
  };
}

/** What `ntag_records_read` answers for this Tag. */
export function recordsRead(
  patch: Partial<TagNdef> = {},
  uid = NTAG_UID,
  records: NdefRecord[] = MESSAGE,
): TagRecordsRead {
  const hex = bytesToHex(encodeNdefMessage(records));
  return {
    dump: dump(uid),
    ndef: {
      outcome: "message",
      messageHex: hex,
      messageBytes: hexToBytes(hex).length,
      userMemoryHex: "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE",
      userMemoryBytes: 496,
      capacityBytes: 496,
      userPages: 124,
      capabilityContainerHex: "E1 10 3E 00",
      reason: null,
      ...patch,
    },
  };
}
