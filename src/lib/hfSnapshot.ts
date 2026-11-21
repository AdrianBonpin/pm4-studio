/**
 * Saving a 13.56 MHz read: the bridge from the readout to the library file.
 *
 * `./hfRead` owns what one tap produced; `src-tauri/src/library.rs` owns the file
 * that keeps it. This module is the one place the two meet, so the webview never
 * assembles a persisted shape at a call site and the store never has to interpret
 * a reading.
 *
 * Two rules decide everything here:
 *
 * 1. **A decoded read is saved whole.** The UID, the raw reply, the ATQA and SAK,
 *    the family they resolved to, the capacity and the NDEF status all travel
 *    together, because a Snapshot is the record of one read and half a record is
 *    a different claim. An undecoded reply has no Tag identity to keep, so there
 *    is nothing to save and the page says so instead of saving a shape that would
 *    read as a Tag.
 * 2. **"No Records" and "not read" stay different.** A message half that was read
 *    and holds nothing saves an empty list; a message half that was never read,
 *    came back for another Tag, or could not be decoded saves nothing at all. The
 *    pane then shows *not recorded* rather than *none*, which is the difference
 *    between a fact and a guess.
 *
 * Nothing here touches a Tag or a file: this is the value the store is asked to
 * keep, and it is pure so the mapping can be tested without either.
 */

import { hexBytes } from "./hfDecoder";
import type { HfMessage, HfRead } from "./hfRead";
import type { DraftRecord } from "./drafts";
import type { Snapshot } from "./library";

/**
 * One 13.56 MHz read in the shape the library file keeps it.
 *
 * The field names are the file's (`src-tauri/src/library.rs` deserialises this
 * straight into `HfFields`), so there is one definition of the persisted shape
 * and no translation layer that could disagree with it.
 */
export interface HfSnapshotSave {
  uid: string;
  raw: string;
  atqa: string;
  sak: string;
  cardType: string;
  capacityBytes: number | null;
  ndefFormatted: boolean | null;
  /** `null` means the message was not read: absent, never an empty list. */
  records: DraftRecord[] | null;
}

/**
 * The read as the store should keep it, or `null` when there is no read to keep.
 *
 * `null` is only ever "nothing was decoded": no Tag was latched, or the reply
 * could not be decoded, so there is no UID to name a Snapshot with. Everything
 * else — including a poll whose message read failed — is a reading worth keeping,
 * and the missing half is recorded as missing.
 */
export function hfSnapshotSave(read: HfRead): HfSnapshotSave | null {
  const reading = read.reading;
  if (reading === null || reading.state !== "decoded") return null;

  return {
    uid: reading.uid,
    raw: reading.raw,
    atqa: hexBytes(reading.atqa),
    sak: hexBytes([reading.sak]),
    cardType: reading.cardType.family,
    capacityBytes: read.capacityBytes,
    ndefFormatted: read.ndef.formatted,
    records: recordsToSave(read.message),
  };
}

/**
 * What the message half settled, as the list a Snapshot holds — or `null` when
 * nothing was settled.
 *
 * Four states are complete answers with no Records in them: an empty message, a
 * Tag with no NDEF TLV, a Tag that is not NDEF formatted, and a family that
 * implements no NFC Forum tag type. Those save `[]`, because the read answered
 * the question. A message that was not read, came back for a different Tag, or
 * is not one this build can decode answers nothing, and saves `null`.
 */
export function recordsToSave(message: HfMessage): DraftRecord[] | null {
  switch (message.state) {
    case "records":
      // Copied, so a later edit of the readout's value cannot reach the value
      // handed to the store.
      return [...message.records];
    case "empty-message":
    case "no-ndef-tlv":
    case "not-formatted":
    case "not-ndef-capable":
      return [];
    case "undecodable":
    case "unreadable":
    case "read-failed":
    case "other-tag":
    case "undecoded-reply":
    case "nothing-latched":
      return null;
  }
}

/**
 * The Records one stored Snapshot holds, or `null` when its file records none.
 *
 * `null` covers both "a 125 kHz Snapshot, which has no message at all" and "a
 * 13.56 MHz Snapshot whose Records were never recorded": neither holds a list,
 * and neither is an empty message. `[]` is reserved for the Snapshot that was
 * read and held nothing.
 */
export function snapshotRecords(snapshot: Snapshot): DraftRecord[] | null {
  if (snapshot.kind !== "HF") return null;
  return snapshot.hf?.records ?? null;
}

/**
 * What a Snapshot's Records are, in the words the pane shows.
 *
 * The three answers are deliberately different: a recorded empty list is
 * `none`, records nobody recorded are `not recorded`, and a list says how many.
 * Rendering `not recorded` as `none` would claim a Tag holds nothing when all
 * that is true is that this build never fetched it.
 */
export function savedRecordsLabel(records: readonly DraftRecord[] | null | undefined): string {
  if (records === null || records === undefined) return "not recorded";
  if (records.length === 0) return "none";
  return `${records.length} ${records.length === 1 ? "Record" : "Records"}`;
}
