/**
 * Writing a Draft to a 13.56 MHz Tag: the words, and the bytes handed over.
 *
 * The decision to write at all is the backend's (`src-tauri/src/ntag.rs`): it
 * reads the Tag first, refuses an empty or oversized message before a write
 * frame exists, and classifies the read-back. This module is the webview side of
 * that contract: it turns a Draft into the message hex the backend writes, and
 * turns what the backend reports into the sentence the user reads.
 *
 * Nothing here is allowed to soften an outcome. A write whose read-back could
 * not confirm it is "unknown", never success and never failure, for the same
 * reason `writeOutcome.ts` says so about the 125 kHz path: the Tag may well be
 * correct and discarding it would be the expensive mistake.
 */

import type { DraftRecord } from "./drafts";
import { recordKindLabel, recordSummary } from "./drafts";
import { encodeRecords, decodeRecords } from "./ndef";
import type { NdefTagSnapshot, WriteOutcome } from "../types";
import { ndefWriteKind, severityOf, toneForSeverity } from "./severity";
import type { WriteNotice } from "./writeOutcome";

/** One Tag as the backend read it. One definition, in `types.ts`, so the write
 *  and erase results cannot drift apart on what a Tag read contains. */
export type NdefTagView = NdefTagSnapshot;

/** The message a Tag carries now, as far as its Type 2 TLV could be read. */
export type ExistingNdef = NdefTagSnapshot["existing"];

/** What writing a Draft would do, before anything is written. */
export interface NdefPreview {
  tag: NdefTagView | null;
  /** Bytes the message would occupy, Type 2 TLV overhead included. */
  requiredBytes: number;
  capacityBytes: number | null;
  /** True only when a write would actually proceed. */
  fits: boolean;
  /** Why it would not proceed: empty Draft, too large, unknown capacity, no Tag. */
  refusal: string | null;
}

/** What one attempted write did. */
export interface NdefWriteResult {
  outcome: WriteOutcome;
  /** Why this write did not land a confirmed copy, when it did not. */
  message: string | null;
  /** What the Tag held before the write, from the read that precedes it. */
  before: NdefTagView | null;
  /** What it read back as afterwards, when it could be re-read. */
  after: NdefTagView | null;
  capacityBytes: number | null;
  requiredBytes: number;
  /** Pages the request asked the firmware to write. */
  wrotePages: number[];
  /** Pages the firmware reported writing. */
  acceptedPages: number[];
  /**
   * Confirmed copies of the Snapshot these Records came from, after the write.
   * `null` when the write named no Snapshot — a Draft is attached to no Tag, so
   * it has no count — or when the library holds no Snapshot under that id.
   */
  confirmedCopies?: number | null;
  /**
   * True only when the confirmed-copy count actually rose, which is exactly one
   * verified write of a Snapshot's Records. False for a Draft and for every
   * outcome that is not a confirmed copy, so a caller reloads the library only
   * when there is something new to read.
   */
  countChanged?: boolean;
  /** Set when the copy count could not be written to the library file. The Tag
   *  was written either way, so this never fails the write. */
  countProblem?: string | null;
}

/** A Draft's Records as the one NDEF message they encode to, in hex. */
export function draftMessageHex(records: readonly DraftRecord[]): string {
  return bytesToHex(encodeRecords(records));
}

/** Bytes as the space-separated uppercase hex the backend parses. */
export function bytesToHex(bytes: readonly number[]): string {
  return bytes.map((byte) => (byte & 0xff).toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/** Hex back to bytes. Throws on an odd number of digits rather than guessing. */
export function hexToBytes(hex: string): number[] {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, "");
  if (cleaned.length % 2 !== 0) {
    throw new Error("a hex string must have an even number of digits");
  }
  const bytes: number[] = [];
  for (let at = 0; at < cleaned.length; at += 2) {
    bytes.push(Number.parseInt(cleaned.slice(at, at + 2), 16));
  }
  return bytes;
}

/** The Records a Tag's current message holds, or null when this build cannot read it. */
export function existingRecords(existing: ExistingNdef): DraftRecord[] | null {
  if (existing.state !== "message" || existing.messageHex === null) return null;
  try {
    return decodeRecords(hexToBytes(existing.messageHex));
  } catch {
    return null;
  }
}

/** "1 Record: URL https://devgo.studio", or "3 Records, starting with Text hello". */
export function recordsLabel(records: readonly DraftRecord[]): string {
  if (records.length === 0) return "no Records";
  const first = records[0]!;
  const one = `${recordKindLabel(first)} ${recordSummary(first)}`.trim();
  return records.length === 1
    ? `1 Record: ${one}`
    : `${records.length} Records, starting with ${one}`;
}

/**
 * The sentence that names what a write would replace, or says the Tag appears
 * empty. This is the whole point of the confirmation: a user consents to losing
 * something specific, not to "overwriting the tag".
 */
export function replacementSentence(preview: NdefPreview): string {
  if (!preview.tag) {
    return preview.refusal ?? "No 13.56 MHz Tag is in the field.";
  }
  const existing = preview.tag.existing;
  if (existing.state === "empty") {
    return "The tag appears empty, so nothing is being replaced.";
  }
  if (existing.state === "unreadable") {
    return `Writing replaces content on the tag that this app could not read${
      existing.reason ? ` (${existing.reason})` : ""
    }.`;
  }
  const records = existingRecords(existing);
  const what =
    records === null
      ? `a message this build cannot decode (${existing.bytes} ${existing.bytes === 1 ? "byte" : "bytes"})`
      : recordsLabel(records);
  return `Writing replaces what the tag holds now: ${what}.`;
}

/** How the message fits, in bytes, or why there is no number to give. */
export function capacitySentence(preview: NdefPreview): string {
  if (preview.capacityBytes === null) {
    return "The tag's capacity could not be read from its Capability Container, so a write would be refused rather than guessed at.";
  }
  return `The message needs ${preview.requiredBytes} of the tag's ${preview.capacityBytes} bytes. A write replaces the whole message; nothing is appended.`;
}

/**
 * The user pages a message of `requiredBytes` occupies, starting at page 4. The
 * confirmation shows this so the size is concrete rather than an abstract count.
 */
export function pageRange(requiredBytes: number): number[] {
  const count = Math.ceil(requiredBytes / 4);
  return Array.from({ length: count }, (_, index) => 4 + index);
}

/** "page 4", "pages 4–16 (13 pages)", or an explicit list when not contiguous. */
export function pagesLabel(pages: readonly number[]): string {
  if (pages.length === 0) return "no pages";
  const sorted = [...pages].sort((a, b) => a - b);
  const contiguous = sorted.every((page, at) => at === 0 || page === sorted[at - 1]! + 1);
  if (!contiguous) return `${sorted.length} pages (${sorted.join(", ")})`;
  if (sorted.length === 1) return `page ${sorted[0]}`;
  return `pages ${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} pages)`;
}

/**
 * What to tell the user about one write. A write that was sent and could not be
 * read back is "unknown" with instructions, because the Tag may hold exactly the
 * right message and discarding it would be the wrong move.
 */
export function writeNotice(result: NdefWriteResult): WriteNotice {
  // The severity is the seam's, so the notice beside the result cannot be
  // drawn in a calmer tone than the sound the same result made (ADR 0008).
  const tone = toneForSeverity(severityOf(ndefWriteKind(result.outcome)));
  const wrote =
    result.wrotePages.length === 0 ? "" : ` One request wrote ${pagesLabel(result.wrotePages)}.`;
  switch (result.outcome) {
    case "verified":
      return {
        tone,
        text: `Verified — the tag reads back this message.${wrote}`,
      };
    case "unverified":
      return {
        tone,
        text:
          "Unknown: the write was sent but the tag did not read back as this message, so its " +
          "contents cannot be confirmed. Read the tag on 13.56 MHz to see what it holds before " +
          "writing it again." +
          wrote,
      };
    case "refused":
      return {
        tone,
        text: `Not written: ${result.message ?? "the write was not attempted"}.`,
      };
    case "failed":
      return {
        tone,
        text: `Not written: the write could not be sent${
          result.message ? ` (${result.message})` : ""
        }. The tag was not changed.`,
      };
    case "blanked":
      // An NDEF write replaces a message and can never blank a Tag. Reaching
      // here is a bug worth naming rather than a result worth wording.
      return {
        tone,
        text:
          "Unexpected outcome: this write reported a blanked tag, which writing an NDEF " +
          "message cannot do. Re-read the tag before trusting what it holds.",
      };
    case "erased":
      // Erasing is its own operation with its own word and its own notice; see
      // `lib/eraseTag.ts`. A Draft write never clears content, so reaching here
      // is a bug worth naming rather than a result worth wording.
      return {
        tone,
        text:
          "Unexpected outcome: this write reported an erased tag, which writing an NDEF " +
          "message cannot do. Re-read the tag before trusting what it holds.",
      };
  }
}
