/**
 * Loading a Tag's Records into a Draft — the read half of read-edit-rewrite.
 *
 * A Tag's user memory holds a Type 2 TLV (`03 <len> <message> FE`), and the
 * message inside it is NDEF. `src-tauri/src/tag_records.rs` does the outer
 * layer against the verified `0x0081` reply and reports what the TLV structure
 * was; this module does the inner layer, with the same codec that writes a
 * Draft (`./ndef`), so a Record read and a Record written can never disagree
 * about a byte.
 *
 * The one decision that lives here rather than in Rust: **whether a Draft may
 * be built at all**. A message that decodes only in part must not become a
 * Draft, because a Draft holding four of five Records looks complete and would
 * be written back as if it were — silently deleting whatever this build could
 * not read. Every way a Tag can fail to yield Records therefore has its own
 * named outcome with its own sentence, and each one falls back to the raw bytes
 * instead of to a half-populated Draft:
 *
 *   - the tag is not NDEF formatted (page 3 is not a Capability Container)
 *   - the tag is formatted but holds no NDEF TLV
 *   - the NDEF TLV is empty (`03 00`), i.e. a message of zero bytes
 *   - the TLV does not parse, or claims more bytes than the tag holds
 *   - a page of user memory was not read, so the area is incomplete
 *   - the message decodes to zero Records
 *   - the message holds a Record this build cannot decode
 *
 * Nothing here writes to a Tag. The read that precedes it sends the info and
 * memory-read commands only; writing the edited Draft back is `./tagWrite`,
 * which is ticket 18's path and the only writer.
 */

import { NdefError, decodeRecords } from "./ndef";
import { recordKindLabel, recordSummary } from "./drafts";
import { hexToBytes, recordsLabel } from "./tagWrite";
import type { DraftRecord } from "./drafts";
import type { DumpRow, MemoryDump } from "./memoryDump";
import { formatOffset, pageRange } from "./memoryDump";

/** The page-state byte the Reader reports for a page it read. */
const PAGE_STATE_READ_OK = 1;

/**
 * What one Tag's Type 2 NDEF structure turned out to be. Mirrors
 * `tag_records::TagNdef` on the Rust side, which owns the byte layout.
 */
export type TagNdefOutcome =
  | "message"
  | "empty"
  | "missing"
  | "notFormatted"
  | "unreadable";

export interface TagNdef {
  outcome: TagNdefOutcome;
  /** The NDEF message, space-separated hex. Empty unless `outcome` is message. */
  messageHex: string;
  messageBytes: number;
  /** The user memory the TLV was read from, hex. */
  userMemoryHex: string;
  userMemoryBytes: number;
  /** User memory from the Type 2 Capability Container. */
  capacityBytes: number | null;
  userPages: number | null;
  /** Page 3 as read: the Capability Container, or what sits there instead. */
  capabilityContainerHex: string;
  /** Why there is no message to load, when there is none. */
  reason: string | null;
}

/** One Tag as the read command returned it: the bytes, and what they mean. */
export interface TagRecordsRead {
  dump: MemoryDump;
  ndef: TagNdef;
}

/** Every honest outcome of trying to load a Tag's Records into a Draft. */
export type TagLoadKind =
  | "records"
  | "emptyMessage"
  | "noNdefTlv"
  | "notFormatted"
  | "unreadable"
  | "undecodable"
  | "zeroRecords";

/** What one read produced, and whether the raw bytes are the best view of it. */
export interface TagLoad {
  kind: TagLoadKind;
  /** The Records, in the Tag's order. Empty for every kind but `records`. */
  records: DraftRecord[];
  /** The message the Records were decoded from, hex. */
  messageHex: string;
  /** Bytes the message occupies. */
  bytes: number;
  /** What this outcome is, in one sentence the user can act on. */
  detail: string;
  /** True when no Draft was made and the raw bytes should be shown instead. */
  raw: boolean;
}

/** What a Draft is, said where a read could be mistaken for a Snapshot. */
export const LOAD_MAKES_A_DRAFT_NOTE =
  "A read like this creates a Draft, never a Snapshot. A Snapshot of the same tag in the Library is a record of a read and is left exactly as it is.";

/** What the read does to the Tag, which is nothing. */
export const LOAD_READ_ONLY_NOTE =
  "Reading a tag to load its Records sends its info and memory-read commands only, so the tag is never changed by being loaded. Writing the edited Draft back is a separate step, and it replaces the whole message.";

/**
 * Turn one read into either a Draft's worth of Records or a named reason there
 * is none.
 *
 * This is where a Tag's bytes stop being bytes. It is pure, so the recorded
 * NTAG215 read in docs/PROTOCOL.md is a complete test: no hardware, no Reader.
 */
export function loadTagRecords(read: TagRecordsRead): TagLoad {
  const ndef = read.ndef;
  const base = {
    messageHex: ndef.messageHex,
    bytes: ndef.messageBytes,
  };

  switch (ndef.outcome) {
    case "message": {
      // A message of zero bytes decodes to zero Records: the same fact as an
      // empty NDEF TLV, reached from the other side. It is named rather than
      // handed to the codec, because "no bytes, so no NDEF message" is an
      // error the user cannot act on and this is not an error.
      if (ndef.messageBytes === 0 || ndef.messageHex.trim().length === 0) {
        return {
          ...base,
          kind: "zeroRecords",
          records: [],
          detail:
            "The tag holds a message of zero bytes, so it decodes to zero Records and there is " +
            "nothing to load into a Draft.",
          raw: true,
        };
      }
      let records: DraftRecord[];
      try {
        records = decodeRecords(hexToBytes(ndef.messageHex));
      } catch (error) {
        return {
          ...base,
          kind: "undecodable",
          records: [],
          detail:
            `The tag's message could not be decoded, so nothing was loaded: ${reasonOf(error)}. ` +
            "A Draft holding only the Records this build could read would silently drop the rest, " +
            "so the tag is shown raw instead.",
          raw: true,
        };
      }
      if (records.length === 0) {
        return {
          ...base,
          kind: "zeroRecords",
          records: [],
          detail:
            "The tag's message decoded to zero Records, so there is nothing to load into a Draft.",
          raw: true,
        };
      }      return {
        ...base,
        kind: "records",
        records,
        detail: `Loaded ${recordsLabel(records)}.`,
        raw: false,
      };
    }
    case "empty":
      return {
        ...base,
        kind: "emptyMessage",
        records: [],
        detail:
          "The tag is NDEF formatted and holds an empty message (an NDEF TLV of length zero), " +
          "so it has zero Records and there is nothing to load.",
        raw: false,
      };
    case "missing":
      return {
        ...base,
        kind: "noNdefTlv",
        records: [],
        detail:
          "The tag is NDEF formatted but its user memory holds no NDEF TLV, so it carries no " +
          "message and there is nothing to load.",
        raw: false,
      };
    case "notFormatted":
      return {
        ...base,
        kind: "notFormatted",
        records: [],
        detail: `The tag is not NDEF formatted, so there is no message to read: ${
          ndef.reason ?? "page 3 does not hold a Type 2 Capability Container"
        }.`,
        raw: true,
      };
    case "unreadable":
      return {
        ...base,
        kind: "unreadable",
        records: [],
        detail: `This build could not read the tag's message: ${
          ndef.reason ?? "the NDEF TLV does not parse"
        }. Nothing was loaded.`,
        raw: true,
      };
    default: {
      // A backend that grew an outcome this build has not been taught cannot
      // silently become a Draft: it is reported as unreadable, with its bytes.
      const unknown = (ndef as { outcome?: string }).outcome ?? "unknown";
      return {
        ...base,
        kind: "unreadable",
        records: [],
        detail: `This build does not understand the read outcome "${unknown}", so nothing was loaded.`,
        raw: true,
      };
    }
  }
}

/** A Draft's name for the Tag its Records came from. */
export function draftNameForTag(dump: MemoryDump): string {
  const uid = dump.tag.uid.trim();
  return uid.length > 0 ? `Tag ${uid}` : "Tag";
}

/**
 * The rows worth showing when a decode falls back to raw bytes: every row up to
 * the last one the Reader actually read.
 *
 * Showing the whole 256-page table would bury the tag's content in pages that
 * are outside its memory, so the unread tail is trimmed. Nothing inside the
 * read range is trimmed, including rows with a bad page state: a hole in the
 * read is exactly what a user needs to see.
 */
export function rawRows(dump: MemoryDump): DumpRow[] {
  let lastRead = -1;
  dump.rows.forEach((row, at) => {
    if (row.pageStates.some((state) => state === PAGE_STATE_READ_OK)) lastRead = at;
  });
  return lastRead < 0 ? [] : dump.rows.slice(0, lastRead + 1);
}

/** One raw row's cells, so the fallback view and the dump read the same way. */
export function rawRowCells(row: DumpRow): {
  pages: string;
  offset: string;
  hex: string;
  ascii: string;
  state: string;
} {
  return {
    pages: pageRange(row),
    offset: formatOffset(row.offset),
    hex: row.hex,
    ascii: row.ascii,
    state: row.stateLabel,
  };
}

/** One Record as the confirmation lists it: its kind and its value. */
export function recordLine(record: DraftRecord): string {
  const value = recordSummary(record);
  return value.length > 0
    ? `${recordKindLabel(record)}: ${value}`
    : `${recordKindLabel(record)} (empty)`;
}

/** The error's own words, so a decode failure is quoted rather than summarised. */
function reasonOf(error: unknown): string {
  return error instanceof NdefError ? error.message : String(error);
}
