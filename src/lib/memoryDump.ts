/**
 * A 13.56 MHz tag's memory as a page dump, in the shape the Rust side sends it.
 *
 * The parsing and the formatting are Rust's (`src-tauri/src/memory_dump.rs`),
 * because that is where the verified 1284-byte reply layout lives and where it
 * can be tested against the recorded NTAG215 read without a webview. This module
 * is the wire type plus the few pure sentences the dump view reads, so the words
 * can be tested without a desktop window.
 *
 * A dump interprets nothing. The tag facts it carries are the UID, the read time
 * and the tag type number the info reply reported, which are there so two
 * exports can be told apart and so the evidence is complete. It names no family:
 * a dump has no ATQA/SAK pair to resolve one from, and the memory a MIFARE
 * Classic needs sector authentication to read is memory this Reader cannot read
 * at all.
 */

/** Which tag a dump came from. */
export interface DumpTag {
  /** The tag's UID as hex bytes: `04 43 8A 01 22 09 03`. */
  uid: string;
  /** The tag type number the `0x0083` info reply reported. Kept as a number so
   *  the dump never claims a family it has not resolved. */
  tagType: number;
  /** When the memory was read, ISO 8601. */
  capturedAt: string;
}

/** One row of the dump: four pages, their hex and their ASCII view. */
export interface DumpRow {
  firstPage: number;
  lastPage: number;
  /** Byte offset from the start of tag memory. */
  offset: number;
  /** The 16 bytes as hex, space separated. */
  hex: string;
  /** The same 16 bytes as ASCII, `.` for anything unprintable. */
  ascii: string;
  /** The Reader's state for each page on the row. */
  pageStates: number[];
  /** `ok`, `state 3`, or `states 1 1 3 3`. */
  stateLabel: string;
  /** True only when every byte on the row was read-ok. */
  readable: boolean;
}

/** One tag's memory, as the Reader returned it. */
export interface MemoryDump {
  /** The reply's status dword; a dump only exists for 0. */
  status: number;
  tag: DumpTag;
  /** Pages the payload carries, readable or not. */
  pageCount: number;
  /** Pages whose state says the read succeeded. */
  readablePages: number;
  rows: DumpRow[];
}

/** "000–003": the pages on one row, as a range. */
export function pageRange(row: Pick<DumpRow, "firstPage" | "lastPage">): string {
  const pad = (n: number) => String(n).padStart(3, "0");
  return `${pad(row.firstPage)}–${pad(row.lastPage)}`;
}

/** "0x0010": a byte offset, four hex digits, as the export writes it. */
export function formatOffset(offset: number): string {
  const hex = Math.max(0, Math.trunc(offset))
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `0x${hex}`;
}

/**
 * How much of the tag answered: "135 of 256 pages readable".
 *
 * Readable is the Reader's own state byte, never whether the bytes look like
 * anything. Pages outside the tag's memory are counted, not hidden, which is
 * what makes the number meaningful for a tag of unknown size.
 */
export function describeDump(dump: Pick<MemoryDump, "pageCount" | "readablePages">): string {
  return `${dump.readablePages} of ${dump.pageCount} pages readable`;
}

/** Where an export went, shown in full so the user can find the file. */
export function exportedDumpNote(path: string): string {
  return `Saved to ${path}`;
}
