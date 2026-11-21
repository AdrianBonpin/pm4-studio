/**
 * One Read on 13.56 MHz — the identity half and the message half, as one value.
 *
 * A tap is one thing the user did, and it takes two device transactions: the
 * poll (`0x0069`) that names the Tag, then the memory read (`0x0081`) that holds
 * its NDEF message. Either can fail, and either can come back in a shape this
 * build cannot read. This module is where the two halves are joined, so the page
 * renders one value and reports one outcome rather than keeping two independent
 * pieces of state that can disagree.
 *
 * Three rules produce every state below, and they are the reason this is a
 * module with a test suite rather than a few branches in the page:
 *
 * 1. **Nothing is hidden and nothing is dressed up as complete.** A poll that
 *    decoded stays on screen when the message read fails, next to the reason the
 *    Records are missing. The state says which half is which, so the readout
 *    cannot render a complete-looking identity block and silently omit a message.
 * 2. **A second transaction only counts if it described this Tag.** The message
 *    read is matched to the poll by UID (`uidMatchesMemory`). A read of another
 *    Tag contributes nothing — not its Records, not its Capability Container's
 *    capacity, not its NDEF status.
 * 3. **NDEF formatting is never taken from the poll.** It comes from the
 *    container the message read carried, or it stays unknown. A family that has
 *    no NFC Forum tag type is *said* to be not NDEF capable in words; the
 *    formatted field is still a fact about a memory read that did not happen.
 *
 * The audible half is derived from the same value (`hfReadOutcome`): a read that
 * fetched everything it went for is one `done` chirp, and a read that got part of
 * it is `needs-you`. There is exactly one outcome per read, because there is
 * exactly one value and one mapping.
 */

import { decodeNdefMessage, recordByteLength, recordProblem } from "./ndef";
import { recordKindLabel, recordSummary, type DraftRecord } from "./drafts";
import {
  capacityForReading,
  decodeHfPayload,
  ndefStatusFor,
  uidMatchesMemory,
  type HfReading,
  type NdefStatus,
} from "./hfDecoder";
import { loadTagRecords, type TagLoad, type TagLoadKind, type TagRecordsRead } from "./tagRecords";
import type { HfCard } from "../types";
import { hexToBytes } from "./tagWrite";
import { outcomes, type Outcome } from "./outcome";

/**
 * How long a Record's row summary may be, in characters.
 *
 * A row is scanned, not read: a Text Record holding a paragraph has to stay one
 * line in a table. The full value is still on the Tag and, later, in a Draft.
 */
export const RECORD_SUMMARY_MAX = 72;

/**
 * What the message half of the read did. The page produces this from the second
 * transaction; `assembleHfRead` turns it into a readout.
 */
export type HfRecordsAttempt =
  /** No message read was made, by design (family, decode) or because there was
   *  no Tag to read. */
  | { readonly state: "not-attempted" }
  /** The message read returned. It still has to describe this Tag. */
  | { readonly state: "read"; readonly read: TagRecordsRead }
  /** The message read was attempted and threw. `reason` is its own words. */
  | { readonly state: "failed"; readonly reason: string };

/**
 * Every way the message half can end, including the ways it ends without a
 * message.
 *
 * The successful ones are findings rather than omissions — a Tag that holds no
 * NDEF TLV has been read completely, and saying so is the answer. The rest are
 * the cases this ticket exists for: something was read, the rest was not, and the
 * readout says which and why.
 */
export type HfMessageState =
  /** The Tag's message decoded. `rows` follows. */
  | "records"
  /** NDEF formatted, with a message of zero bytes. */
  | "empty-message"
  /** NDEF formatted, with no NDEF TLV in user memory. */
  | "no-ndef-tlv"
  /** The Capability Container page is not a Type 2 one. */
  | "not-formatted"
  /** The message's bytes are not a message this build can decode. */
  | "undecodable"
  /** The NDEF area could not be parsed at all. */
  | "unreadable"
  /** The card family implements no NFC Forum tag type, so no read was tried. */
  | "not-ndef-capable"
  /** The poll reply itself could not be decoded, so there was no Tag to read. */
  | "undecoded-reply"
  /** The poll decoded and the message read failed. The identity survived. */
  | "read-failed"
  /** The message read came back for a different Tag and was discarded. */
  | "other-tag"
  /** Nothing was latched, so nothing was read. */
  | "nothing-latched";

/** One Record, as a row: what it is, what it says, how big it is, whether it holds up. */
export interface HfRecordRow {
  /** 1-based position in the Tag's own order. */
  readonly position: number;
  /** The Record's kind, e.g. `URL`. */
  readonly kind: string;
  /** A short single-line summary, never longer than `RECORD_SUMMARY_MAX`. */
  readonly summary: string;
  /** Bytes the Record occupies in the message the Tag holds, or null when the
   *  wire bytes could not be re-read. */
  readonly bytes: number | null;
  /** True when this build can encode the Record again. */
  readonly valid: boolean;
  /** Why it cannot, when it cannot. */
  readonly problem: string | null;
}

/** The message half of a read, whether or not there is a message. */
export interface HfMessage {
  readonly state: HfMessageState;
  /** What this is, in one sentence. Never empty. */
  readonly note: string;
  /** Why there is no message, when there is none: the Tag's own reason, or the
   *  failure's words. Null when `state` is `records`. */
  readonly reason: string | null;
  /** The Records, in the Tag's order. Empty for every state but `records`. */
  readonly records: readonly DraftRecord[];
  /** The rows those Records produce. Empty for every state but `records`. */
  readonly rows: readonly HfRecordRow[];
  /** Bytes the message occupies, or null when no message was read. */
  readonly bytes: number | null;
  /** The message itself, space-separated hex, or null. */
  readonly messageHex: string | null;
}

/** One tap's whole result: the poll, the message, and what the two settle. */
export interface HfRead {
  /** The poll, or null when nothing was latched. */
  readonly reading: HfReading | null;
  readonly message: HfMessage;
  /** Capacity in bytes: the published table where the pair determines it,
   *  otherwise the Tag's Capability Container, otherwise null. */
  readonly capacityBytes: number | null;
  /** NDEF formatting, settled by a container and by nothing else. */
  readonly ndef: NdefStatus;
  /** The memory read this value used, when one described this Tag. */
  readonly memory: TagRecordsRead | null;
}

/**
 * Whether a message read can work on this Tag at all.
 *
 * It needs a decoded poll (so there is a UID to match the read against) and a
 * family that implements an NFC Forum tag type. A MIFARE Classic implements
 * none, so a Type 2 container read is not something to offer and then fail.
 */
export function readsMessage(reading: HfReading): boolean {
  return reading.state === "decoded" && reading.cardType.nfcForumTagType !== null;
}

/**
 * One read's two device transactions, as functions, so the sequencing lives here
 * rather than in each caller.
 *
 * `poll` is the `0x0069` poll and may throw when the Reader itself fails — that
 * failure is the caller's to report, because it is the Reader and not the Tag.
 * `records` is the `0x0081` memory read that follows a decodable poll of a family
 * that can carry a message; it is only called for such a Tag, and its failure is
 * folded into the read as a missing message rather than thrown.
 */
export interface HfReadSource {
  readonly poll: () => Promise<HfCard | null>;
  readonly records: () => Promise<TagRecordsRead>;
}

/**
 * Take one read: poll, then read the message the poll makes possible.
 *
 * Every panel that reads a 13.56 MHz Tag — Read, Copy's source and destination —
 * goes through this, so no two of them can disagree about the order, about when
 * the message read is offered, or about what a failed one means.
 */
export async function readHfOnce(source: HfReadSource): Promise<HfRead> {
  const card = await source.poll();
  const reading = card === null ? null : decodeHfPayload(card.payload);
  let attempt: HfRecordsAttempt = { state: "not-attempted" };

  if (reading !== null && readsMessage(reading)) {
    try {
      attempt = { state: "read", read: await source.records() };
    } catch (error) {
      attempt = { state: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return assembleHfRead(reading, attempt);
}

/**
 * Join one poll and whatever followed it into the value the page renders.
 *
 * Total by construction: every combination of a reading and an attempt produces
 * a state, including the combinations a correct caller would never produce (a
 * capable family with no attempt is reported as a failed read rather than as a
 * silent success).
 */
export function assembleHfRead(
  reading: HfReading | null,
  attempt: HfRecordsAttempt,
): HfRead {
  if (reading === null) {
    return {
      reading: null,
      message: message({
        state: "nothing-latched",
        note: "No Tag was latched in the field, so nothing was read.",
        reason: null,
      }),
      capacityBytes: null,
      ndef: unknownFormatting(
        "Nothing was read, so whether a Tag here is NDEF formatted is unknown.",
      ),
      memory: null,
    };
  }

  if (reading.state === "raw") {
    return {
      reading,
      message: message({
        state: "undecoded-reply",
        note:
          "The poll reply could not be decoded, so there is no UID to read a message for and " +
          "no message read was attempted.",
        reason: reading.detail,
      }),
      capacityBytes: null,
      ndef: unknownFormatting(
        "The reply could not be decoded, so whether this Tag is NDEF formatted is unknown.",
      ),
      memory: null,
    };
  }

  if (reading.cardType.nfcForumTagType === null) {
    return {
      reading,
      message: message({
        state: "not-ndef-capable",
        note:
          `${reading.cardType.family} implements no NFC Forum tag type, so no NDEF message can ` +
          "be read from it with this Reader. No message read was attempted.",
        reason: null,
      }),
      // The pair still determines the size of a fixed-size family.
      capacityBytes: capacityForReading(reading.cardType, null),
      ndef: unknownFormatting(
        `NDEF formatting needs a Type 2 container, and ${reading.cardType.family} provides none: ` +
          "this card type is not NDEF capable, so there is no container to read.",
      ),
      memory: null,
    };
  }

  switch (attempt.state) {
    case "not-attempted":
      // A correct caller reads the message for a capable family. Reaching here
      // means something skipped it, and the honest report is that the Records
      // were not read — never that there are none.
      return {
        reading,
        message: message({
          state: "read-failed",
          note:
            "The poll decoded, but no message read was made, so this Tag's Records are missing " +
            "rather than absent.",
          reason: "the message read was not attempted",
        }),
        capacityBytes: capacityForReading(reading.cardType, null),
        ndef: unknownFormatting(
          "Whether this Tag is NDEF formatted is unknown: no message read settled it.",
        ),
        memory: null,
      };

    case "failed":
      return {
        reading,
        message: message({
          state: "read-failed",
          note:
            "The poll decoded, but the Tag's message could not be read: " +
            `${attempt.reason}. Its Records are missing rather than absent.`,
          reason: attempt.reason,
        }),
        capacityBytes: capacityForReading(reading.cardType, null),
        ndef: unknownFormatting(
          "Whether this Tag is NDEF formatted is still unknown: the message read that would " +
            "have settled it did not complete.",
        ),
        memory: null,
      };

    case "read": {
      const read = attempt.read;
      if (!uidMatchesMemory(reading.uid, read.dump.tag.uid)) {
        return {
          reading,
          message: message({
            state: "other-tag",
            note:
              "The message read that followed described a different Tag, so it was not applied " +
              "to this reading. These Records are missing rather than another Tag's.",
            reason: `the read described ${read.dump.tag.uid}, not ${reading.uid}`,
          }),
          // Not even capacity: that container belongs to another Tag.
          capacityBytes: capacityForReading(reading.cardType, null),
          ndef: unknownFormatting(
            "Whether this Tag is NDEF formatted is still unknown: the read that came back was " +
              "of another Tag, so it settled nothing here.",
          ),
          memory: null,
        };
      }

      return {
        reading,
        message: messageFromLoad(loadTagRecords(read), read),
        capacityBytes: capacityForReading(reading.cardType, read),
        // The container is the only thing that answers this.
        ndef: ndefStatusFor(read.ndef.outcome),
        memory: read,
      };
    }
  }
}

/**
 * The one outcome a read reports.
 *
 * A read that fetched everything it went for sounds one `done` chirp, including
 * when the whole answer is "this family holds no NDEF" or "the message is
 * empty" — those are complete answers. A read that got part of what it went for
 * sounds `needs-you`, and it is the same outcome that carries the reason, so the
 * message and the sound cannot disagree.
 */
export function hfReadOutcome(read: HfRead): Outcome {
  const { reading, message: half } = read;

  if (reading === null) return outcomes.nothingLatched("hf-read");

  if (reading.state === "raw") {
    return outcomes.hfReadIncomplete(null, reading.detail);
  }

  const identity = reading.uid;

  switch (half.state) {
    case "undecoded-reply":
    case "read-failed":
    case "other-tag":
    case "undecodable":
    case "unreadable":
      return outcomes.hfReadIncomplete(
        identity,
        `${half.note}${half.reason === null ? "" : ` ${half.reason}`}`,
      );
    case "records":
    case "empty-message":
    case "no-ndef-tlv":
    case "not-formatted":
    case "not-ndef-capable":
      return outcomes.hfRead(identity, heldSummary(half, reading.cardType.family));
    case "nothing-latched":
      // Unreachable once a reading exists; kept so the switch stays total.
      return outcomes.nothingLatched("hf-read");
  }
}

/** What the message half turned out to be, for the outcome's one line. */
function heldSummary(half: HfMessage, family: string): string {
  switch (half.state) {
    case "records": {
      const count = half.rows.length;
      return `${count} ${count === 1 ? "Record" : "Records"}`;
    }
    case "empty-message":
      return "an empty NDEF message";
    case "no-ndef-tlv":
      return "no NDEF message";
    case "not-formatted":
      return "not NDEF formatted";
    case "not-ndef-capable":
      return `no NDEF, because ${family} has no NFC Forum tag type`;
    default:
      return "the message could not be read";
  }
}

/** A read whose container settled nothing. */
function unknownFormatting(note: string): NdefStatus {
  return { formatted: null, note };
}

/** A message half with no Records, built from a state and its words. */
function message(half: {
  state: HfMessageState;
  note: string;
  reason: string | null;
}): HfMessage {
  return {
    ...half,
    records: [],
    rows: [],
    bytes: null,
    messageHex: null,
  };
}

/** The message half a Tag's own Type 2 structure produced. */
function messageFromLoad(load: TagLoad, read: TagRecordsRead): HfMessage {
  const state = stateOf(load.kind);
  if (state !== "records") {
    return {
      state,
      note: noteFor(state, read),
      reason: load.detail,
      records: [],
      rows: [],
      bytes: load.bytes,
      messageHex: load.messageHex === "" ? null : load.messageHex,
    };
  }
  const rows = rowsFor(load, load.messageHex);
  const count = rows.length;
  return {
    state: "records",
    note: `${count} ${count === 1 ? "Record" : "Records"} in ${load.bytes} ${
      load.bytes === 1 ? "byte" : "bytes"
    }, in the order the Tag holds them.`,
    reason: null,
    records: load.records,
    rows,
    bytes: load.bytes,
    messageHex: load.messageHex,
  };
}

/** `TagLoad`'s vocabulary on this readout's: two names for "no Records". */
function stateOf(kind: TagLoadKind): HfMessageState {
  switch (kind) {
    case "records":
      return "records";
    case "emptyMessage":
    case "zeroRecords":
      return "empty-message";
    case "noNdefTlv":
      return "no-ndef-tlv";
    case "notFormatted":
      return "not-formatted";
    case "undecodable":
      return "undecodable";
    case "unreadable":
      return "unreadable";
    default: {
      // A backend that grew a load outcome this build has not been taught is
      // reported as unreadable rather than as an empty Tag.
      return "unreadable";
    }
  }
}

/** The readout's own sentence for a message that is not there, and why. */
function noteFor(state: HfMessageState, read: TagRecordsRead): string {
  switch (state) {
    case "empty-message":
      return "The Tag is NDEF formatted and holds an empty message, so it carries no Records.";
    case "no-ndef-tlv":
      return "The Tag is NDEF formatted, but its user memory holds no NDEF TLV, so it carries no message.";
    case "not-formatted":
      return "Page 3 of the Tag is not a Type 2 Capability Container, so the Tag is not NDEF formatted.";
    case "undecodable":
      return "The Tag's message is not one this build can decode, so no Records are listed.";
    case "unreadable":
      return "The Tag's NDEF area could not be parsed, so what it holds is unknown.";
    default:
      return read.ndef.reason ?? "The Tag holds no message this build could read.";
  }
}

/**
 * One row per Record, in order.
 *
 * The size is the bytes the Record occupies **in the message the Tag holds**, read
 * back from the wire rather than re-encoded, so an invalid Record still shows the
 * space it takes. Validity is a separate answer: whether this build can encode the
 * same Record again, which is what a later write or copy would depend on.
 */
function rowsFor(load: TagLoad, messageHex: string): HfRecordRow[] {
  let wire: ReturnType<typeof decodeNdefMessage> | null = null;
  try {
    wire = decodeNdefMessage(hexToBytes(messageHex));
  } catch {
    // `loadTagRecords` already decoded this message; if it somehow will not
    // decode twice, the rows still carry kind, summary and validity, and the
    // size is the one field left unknown rather than guessed.
    wire = null;
  }
  return load.records.map((record, at) => {
    const problem = recordProblem(record);
    const onWire = wire === null ? undefined : wire[at];
    return {
      position: at + 1,
      kind: recordKindLabel(record),
      summary: shortenSummary(recordSummary(record)),
      bytes: onWire === undefined ? null : recordByteLength(onWire),
      valid: problem === null,
      problem,
    };
  });
}

/** A Record's value on one line: whitespace collapsed, and cut at
 * `RECORD_SUMMARY_MAX` characters with an ellipsis. A paragraph stays a row. */
export function shortenSummary(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= RECORD_SUMMARY_MAX) return flat;
  return `${flat.slice(0, RECORD_SUMMARY_MAX - 1)}…`;
}
