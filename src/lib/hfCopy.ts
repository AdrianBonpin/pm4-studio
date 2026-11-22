/**
 * Copy — a whole NDEF message from one 13.56 MHz Tag to another.
 *
 * Copy is a first-class operation and it is **not** a Clone. A Clone is confirmed
 * by comparing an Identity on 125 kHz; a Copy is confirmed by comparing a whole
 * message, and the two keep different names, different words and a different
 * verification. This module is the Copy guard the specification names: a decision
 * in, a decision out, with no device involved, so every branch is reachable in a
 * test without a Reader or a Tag.
 *
 * The flow it guards, in the order the user does it:
 *
 *   1. read the source message and hold it;
 *   2. require the source to be removed, observing that **no tag is latched**
 *      before anything else happens — the source must not be in the write
 *      position when the destination is written;
 *   3. read the destination's current message, so what will be replaced can be
 *      named, with its size;
 *   4. weigh the message against the destination's known capacity, and refuse
 *      before writing when it does not fit;
 *   5. write, read the message back, and compare the decoded Records in order
 *      together with the total encoded length;
 *   6. report one outcome, which sounds.
 *
 * Three rules are load-bearing and are the reason this is a module with a test
 * suite rather than a handful of branches in a panel:
 *
 * **A refusal names which condition fired.** The conditions are the closed set in
 * `CopyRefusalCondition`; no call site invents a sentence. Where the hardware
 * cannot distinguish two of them — a read-only destination and a
 * password-protected one look identical while the password commands are
 * unavailable — the guard reports the **merged** condition and says it cannot
 * tell them apart, rather than picking one.
 *
 * **An unknown fit is never assumed and never a flat refusal.** When the
 * destination's capacity cannot be determined the guard states that the fit is
 * unknown and proceeds only on an explicit acknowledgement. Refusing outright
 * would make Copy unusable on the common NTAG case, and assuming a fit is the
 * silent-truncation failure this work exists to remove.
 *
 * **The comparison is on the decoded Records, not on bytes.** A Tag may
 * legitimately re-encode an equal message — a different URI abbreviation, a
 * different ID field — and a byte comparison would report a correct copy as a
 * failure, which is the one outcome worse than an honest unknown. The total
 * encoded length is compared too, from the decoded Records on both sides, so the
 * check never depends on how a particular Tag framed the bytes.
 *
 * A note on the name: `./copyGuard` is the **copywriting** guard (GLOSSARY.md's
 * retired vocabulary in user-facing text). This module is the Copy operation's
 * guard. They are unrelated, and both names are honest.
 */

import { encodeRecords, recordsByteLength } from "./ndef";
import { outcomes, type Outcome } from "./outcome";
import { bytesToHex, existingRecords, type NdefWriteResult } from "./tagWrite";
import type { HfRead, HfMessageState } from "./hfRead";
import type { HfReading } from "./hfDecoder";
import type { DraftRecord } from "./drafts";
import type { NdefTagSnapshot } from "../types";

// ---------------------------------------------------------------------------
// the two primitives that did not exist yet
// ---------------------------------------------------------------------------

/**
 * "Observed no tag latched" — the field, as one poll saw it.
 *
 * A poll that returns no Tag and a poll whose reply says nothing is latched are
 * the same observation; a poll that latched *something* is not, even when that
 * something's reply could not be decoded, because the source might be the Tag
 * that is still sitting there. `uid` is null only in that last case: a Tag is
 * latched and its reply could not be decoded, so it cannot be named.
 *
 * This is the primitive the source-removal step stands on. It is derived here,
 * purely, so the flow cannot quietly treat "I could not decode the reply" as
 * "nothing is there".
 */
export interface CopyFieldObservation {
  readonly latched: { readonly uid: string | null } | null;
}

/** What one poll says about the field, in the removal step's terms. */
export function observeField(reading: HfReading | null): CopyFieldObservation {
  if (reading === null) return { latched: null };
  if (reading.state === "decoded") return { latched: { uid: reading.uid } };
  // A raw reply still proves something is in the field, except when the reply's
  // own validity flag says nothing is latched. That one reason is the only raw
  // reply that can mean an empty field.
  if (reading.reason === "not-latched") return { latched: null };
  return { latched: { uid: null } };
}

/**
 * One held message: the Records in order, and the message as the Tag held it.
 *
 * `messageHex` is the message itself, not the TLV around it. It is what the
 * write path sends, and what the comparison's decoded Records come from.
 */
export interface CopyMessage {
  readonly uid: string;
  readonly records: readonly DraftRecord[];
  /** The NDEF message, space-separated hex. */
  readonly messageHex: string;
}

/** A message encoded from Records the way this build's codec encodes them. */
export function copyMessage(uid: string, records: readonly DraftRecord[]): CopyMessage {
  return { uid, records, messageHex: bytesToHex(encodeRecords(records)) };
}

/**
 * The bytes a message would occupy on a Type 2 Tag: the message plus its TLV
 * header and terminator (`03 <len> … FE`), which is what the write path sizes.
 *
 * The number is the same one the backend's plan weighs, so a guard that says it
 * fits and a write that refuses cannot disagree about what "fits" counts.
 */
export function requiredBytes(message: CopyMessage): number {
  const bytes = messageBytes(message);
  return bytes + (bytes < 255 ? 3 : 5);
}

/** The bytes one message holds. */
export function messageBytes(message: CopyMessage): number {
  const hex = message.messageHex.trim();
  return hex === "" ? 0 : hex.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// the comparison
// ---------------------------------------------------------------------------

/** How two messages compare, with each half reported so a failure can name one. */
export interface CopyComparison {
  /** Both halves agree: the same Records in order and the same total length. */
  readonly equal: boolean;
  /** The decoded Records match one for one, in the same order. */
  readonly sameRecords: boolean;
  /** Records on each side, so "3 against 2" is sayable. */
  readonly sourceRecords: number;
  readonly readbackRecords: number;
  /** The total encoded length of each side's decoded Records. */
  readonly sourceBytes: number;
  readonly readbackBytes: number;
}

/**
 * Compare a held message with what a Tag read back.
 *
 * **Decoded Records in order, plus the total encoded length — never raw bytes.**
 * A Tag may store an equal message in its own encoding: the same Records with a
 * different URI abbreviation, a different Record ID, a different short/long
 * header choice. Comparing the bytes on the wire would call that a failed copy,
 * and a false failure about the one operation that destroys content is worse than
 * saying the result is unknown. So both sides are decoded first, and the length
 * compared is the length the decoded Records encode to.
 */
export function compareMessages(
  source: CopyMessage,
  readback: CopyMessage,
): CopyComparison {
  const sameCount = source.records.length === readback.records.length;
  const sameRecords =
    sameCount &&
    source.records.every((record, at) => sameRecord(record, readback.records[at]!));
  const sourceBytes = encodedLength(source.records);
  const readbackBytes = encodedLength(readback.records);
  return {
    equal: sameRecords && sourceBytes === readbackBytes,
    sameRecords,
    sourceRecords: source.records.length,
    readbackRecords: readback.records.length,
    sourceBytes,
    readbackBytes,
  };
}

/** Whether one operation's two messages are the same message. */
export function messagesEqual(source: CopyMessage, readback: CopyMessage): boolean {
  return compareMessages(source, readback).equal;
}

/** Two decoded Records are the same Record when their kind and every field agree. */
function sameRecord(a: DraftRecord, b: DraftRecord): boolean {
  return canonical(a) === canonical(b);
}

/**
 * A value's canonical text: keys sorted, so two Records built in a different
 * order are the same Record and a Record that differs in one field is not.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${fields.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The bytes the decoded Records encode to. */
function encodedLength(records: readonly DraftRecord[]): number {
  return recordsByteLength(records);
}

// ---------------------------------------------------------------------------
// what the guard is asked
// ---------------------------------------------------------------------------

/** The destination as the flow read it. */
export interface CopyDestination {
  /** The UID of the destination, or null when its reply could not be decoded. */
  readonly uid: string | null;
  /** True when a Tag was latched, decoded or not. */
  readonly latched: boolean;
  /**
   * What the read found the destination holding, in the read half's own states.
   *
   * This is `HfRead`'s `HfMessageState` copied across, not a summary of it. The
   * distinction between **read fine and holds nothing** (`empty-message`, a
   * zero-length NDEF TLV or a message of zero bytes; `no-ndef-tlv`, NDEF
   * formatted with no TLV yet) and **could not be read** (`unreadable`,
   * `undecodable`, `read-failed`, `undecoded-reply`, `other-tag`, …) is already
   * drawn there, and collapsing the two into "no message" is the defect this
   * field exists to prevent. `copyDestination` copies it, so no second mapping
   * can drift from the read's.
   */
  readonly holds: HfMessageState;
  /** What the destination holds now, when its message could be read. */
  readonly message: CopyMessage | null;
  /** Why there is no message, when there is none. The Tag's own reason. */
  readonly problem: string | null;
  /** Known capacity in bytes, or null when neither the card type nor the CC settled it. */
  readonly capacityBytes: number | null;
}

/** What the write itself produced, in the backend's classification. */
export interface CopyWriteEvidence {
  readonly outcome: "verified" | "unverified" | "refused" | "failed";
  /** The backend's own words for a refusal or a failure. */
  readonly reason: string | null;
  /** The message the destination read back as, when it read back at all. */
  readonly readback: CopyMessage | null;
}

/** One question the flow puts to the guard. */
export type CopyInput =
  /** The source is held; has it been taken off the Reader? */
  | { readonly step: "source-removed"; readonly source: CopyMessage; readonly field: CopyFieldObservation }
  /** A destination is in the field; may the copy be offered? */
  | {
      readonly step: "destination";
      readonly source: CopyMessage;
      readonly destination: CopyDestination;
      readonly acknowledgedUnknownFit: boolean;
    }
  /** The write was attempted; what did it do? */
  | {
      readonly step: "write";
      readonly source: CopyMessage;
      /** What the destination held before the write, when it was read. */
      readonly previous: CopyMessage | null;
      readonly evidence: CopyWriteEvidence;
    };

/** How the message weighs against the destination. */
export type CopyFit =
  | { readonly kind: "known"; readonly requiredBytes: number; readonly capacityBytes: number }
  | { readonly kind: "unknown"; readonly requiredBytes: number };

/** Every condition Copy refuses for. Each one is named, never invented at a site. */
export type CopyRefusalCondition =
  /** A Tag was latched when the source's removal was checked. */
  | "source-not-removed"
  /** The destination's own message could not be read. */
  | "destination-unreadable"
  /**
   * The destination is not NDEF formatted, so it cannot take a message. Its own
   * condition rather than `destination-unreadable`: the read succeeded and said
   * exactly that, and formatting a Tag is an operation this build does not do.
   */
  | "destination-not-formatted"
  /** The destination already holds this exact message, so there is nothing to copy. */
  | "destination-identical"
  /** The destination's known capacity cannot hold the message. */
  | "message-too-large"
  /** The capacity is unknown and the user has not acknowledged the unknown fit. */
  | "fit-unknown-unacknowledged"
  /**
   * The destination would not accept the write, and this Reader cannot tell a
   * read-only Tag from a password-protected one. The merged condition, reported
   * as merged rather than guessed at.
   */
  | "destination-protected"
  /** The backend stopped the write before it was sent, for its own named reason. */
  | "destination-refused";

/** One refusal: which condition fired, and the words for it. */
export interface CopyRefusal {
  readonly condition: CopyRefusalCondition;
  /** One sentence naming the condition. Never empty. */
  readonly message: string;
  /** The facts behind it — the numbers, the reason, the caveat. */
  readonly detail: string;
}

/** The answer to one question. */
export type CopyDecision =
  /** Go on, with how the message weighs when that step weighs it. */
  | { readonly kind: "proceed"; readonly fit: CopyFit | null }
  /** The field was empty. Nothing happened, which is not an error. */
  | { readonly kind: "nothing-latched"; readonly message: string; readonly detail: string }
  /** The copy was refused before it changed anything. */
  | { readonly kind: "refused"; readonly refusal: CopyRefusal }
  /** A write was sent. `verification` says whether the read-back proved it. */
  | {
      readonly kind: "result";
      readonly verification: "verified" | "unverified";
      readonly message: string;
      readonly detail: string | null;
    }
  /** A write was attempted and never reached the device. */
  | { readonly kind: "failed"; readonly message: string; readonly detail: string };

/** The one entry point: one question in, one decision out. */
export function copyDecision(input: CopyInput): CopyDecision {
  switch (input.step) {
    case "source-removed":
      return sourceRemoved(input.source, input.field);
    case "destination":
      return destinationDecision(input.source, input.destination, input.acknowledgedUnknownFit);
    case "write":
      return writeDecision(input.source, input.previous, input.evidence);
  }
}

/**
 * Has the source been taken off the Reader?
 *
 * "No tag is latched" is the condition. An empty field proceeds; anything else is
 * a refusal, including a Tag whose reply could not be decoded, because the one
 * thing this step must never do is let the source be written over.
 */
function sourceRemoved(source: CopyMessage, field: CopyFieldObservation): CopyDecision {
  const latched = field.latched;
  if (latched === null) return { kind: "proceed", fit: null };

  if (latched.uid !== null && latched.uid === source.uid) {
    return {
      kind: "refused",
      refusal: {
        condition: "source-not-removed",
        message: "Not copied: the source tag is still in the field.",
        detail:
          `The tag latched is ${source.uid}, which is the source. Take it off the Reader ` +
          "before checking the field again — the message is held, so nothing about it is lost " +
          "by waiting.",
      },
    };
  }

  if (latched.uid !== null) {
    return {
      kind: "refused",
      refusal: {
        condition: "source-not-removed",
        message: "Not copied: a tag is latched, so the source's removal was not observed.",
        detail:
          `The field holds ${latched.uid}, which is not the source. Take every tag off the ` +
          "Reader and check the field again before putting the destination on.",
      },
    };
  }

  return {
    kind: "refused",
    refusal: {
      condition: "source-not-removed",
      message: "Not copied: a tag is latched, so the source's removal was not observed.",
      detail:
        "Its reply could not be decoded, so which tag it is could not be named. Take every " +
        "tag off the Reader and check the field again.",
    },
  };
}

/**
 * May the copy be offered to this destination?
 *
 * The order matters: a destination that cannot be read cannot have its message
 * named, so nothing may be written over it; a destination that already holds the
 * message has nothing to copy; and the source itself in the write position is the
 * removal step failing a second time, which is why it is checked by UID as well
 * as by message.
 *
 * **A destination that read fine and holds nothing is a proceed.** Zero Records
 * are replaced, so there is no message to name, nothing that could be identical
 * to the source, and nothing anyone could lose by writing. It is the ordinary
 * destination for a Copy, and it is told apart from a failed read by the read
 * half's own state (`holdsNothing`), never by matching a sentence. Capacity is
 * still weighed, so an empty destination that is too small refuses for its size.
 *
 * An unformatted destination is neither of those: the read succeeded and said
 * the Tag is not NDEF formatted, which this build cannot fix and cannot write
 * around — the write path sizes itself from the Capability Container the Tag does
 * not have — so it refuses with its own condition rather than as a failed read.
 */
function destinationDecision(
  source: CopyMessage,
  destination: CopyDestination,
  acknowledgedUnknownFit: boolean,
): CopyDecision {
  if (!destination.latched && destination.problem === null) {
    return {
      kind: "nothing-latched",
      message: "No tag in the field.",
      detail:
        "The source message is still held, and no tag has been written. Put the destination " +
        "on the Reader and read it when you are ready.",
    };
  }

  if (destination.uid !== null && destination.uid === source.uid) {
    return {
      kind: "refused",
      refusal: {
        condition: "source-not-removed",
        message: "Not copied: the source tag is in the write position.",
        detail:
          `The destination reads as ${destination.uid}, which is the source that was already ` +
          "read. Take it off and put the destination tag on the Reader.",
      },
    };
  }

  if (destination.holds === "not-formatted") {
    return {
      kind: "refused",
      refusal: {
        condition: "destination-not-formatted",
        message: "Not copied: this tag is not NDEF formatted, so it cannot take a message.",
        detail:
          `${destination.problem ?? "Page 3 is not a Type 2 Capability Container."} Formatting ` +
          "a tag is a separate operation that this app does not do, and a write is sized from " +
          "the tag's Capability Container. There is none here, so nothing could be sized or " +
          "written. Nothing was written: use a tag that is already NDEF formatted.",
      },
    };
  }

  if (destination.message === null && !holdsNothing(destination)) {
    return {
      kind: "refused",
      refusal: {
        condition: "destination-unreadable",
        message:
          "Not copied: the destination's message could not be read, so nothing is replaced.",
        detail:
          `${destination.problem ?? "The Tag did not answer a memory read."} A write replaces ` +
          "the whole message, and writing over a message this app could not read would " +
          "destroy content nobody named. Nothing was written.",
      },
    };
  }

  // A destination that holds nothing has no message that could be identical to
  // the source: zero Records against the source's own count is not a copy.
  if (destination.message !== null && messagesEqual(source, destination.message)) {
    return {
      kind: "refused",
      refusal: {
        condition: "destination-identical",
        message: "Not copied: the destination already holds this message.",
        detail:
          `Both tags hold the same ${describeRecords(source.records)}. There is nothing to ` +
          "copy. If that is a surprise, the source may be back in the write position — take " +
          "it off and check the field again.",
      },
    };
  }

  const required = requiredBytes(source);
  const capacity = destination.capacityBytes;

  if (capacity !== null && required > capacity) {
    return {
      kind: "refused",
      refusal: {
        condition: "message-too-large",
        message:
          `Not copied: the message needs ${required} bytes and this destination's capacity ` +
          `is ${capacity} bytes.`,
        detail:
          `A write replaces the whole message rather than part of it, so nothing was written ` +
          "and a partial write cannot happen. Use a larger destination tag, or a shorter " +
          "message.",
      },
    };
  }

  if (capacity === null) {
    if (!acknowledgedUnknownFit) {
      return {
        kind: "refused",
        refusal: {
          condition: "fit-unknown-unacknowledged",
          message:
            "Not copied yet: the destination's capacity could not be determined, so whether " +
            `the message fits is unknown. It needs ${required} bytes.`,
          detail:
            "The capacity comes either from the card type or from the tag's Capability " +
            "Container, and neither settled it here. Acknowledge the unknown fit to write " +
            "anyway — this app will not assume the message fits, and it will not refuse a tag " +
            "it simply could not measure.",
        },
      };
    }
    return { kind: "proceed", fit: { kind: "unknown", requiredBytes: required } };
  }

  return { kind: "proceed", fit: { kind: "known", requiredBytes: required, capacityBytes: capacity } };
}

/**
 * Whether the destination was read completely and holds no Records.
 *
 * The two states are the read half's, not this module's: `empty-message` is an
 * NDEF formatted Tag whose message is zero bytes (a zero-length NDEF TLV, and the
 * same fact reached as a message that decodes to zero Records), and `no-ndef-tlv`
 * is an NDEF formatted Tag whose user memory carries no TLV yet. Both answered
 * every command the read sent, so both are findings rather than failures, and
 * both are the ordinary destination for a Copy. Every other state without a
 * message is a read that did not finish or did not apply to this Tag, which stays
 * a refusal.
 *
 * The `message === null` half of the conjunction is the read's own statement that
 * there are no Records; a value claiming both a message and an empty state is not
 * a destination this guard will call empty.
 */
function holdsNothing(destination: CopyDestination): boolean {
  if (destination.message !== null) return false;
  return destination.holds === "empty-message" || destination.holds === "no-ndef-tlv";
}

/**
 * What did the write do?
 *
 * A backend `verified` is the stronger evidence — it compared the bytes it wrote.
 * The comparison here is what promotes a byte-level miss to a **verified** copy
 * when the destination re-encoded an equal message, and it is what tells a
 * destination that refused the write apart from one that merely did not read back.
 */
function writeDecision(
  source: CopyMessage,
  previous: CopyMessage | null,
  evidence: CopyWriteEvidence,
): CopyDecision {
  switch (evidence.outcome) {
    case "verified": {
      // The backend byte-matched what it wrote, which is stronger evidence than
      // a decode. The comparison is still run on a read-back that is here, and if
      // the two ever disagree the honest answer is that this build cannot confirm
      // it — never a "verified" the decoded Records contradict.
      const readback = evidence.readback;
      if (readback !== null && !messagesEqual(source, readback)) {
        return {
          kind: "result",
          verification: "unverified",
          message:
            "Not verified: the write was reported as matching, but the decoded Records it " +
            "reads back as are not the ones that were written.",
          detail:
            `It reads back as ${describeRecords(readback.records)}, ` +
            `${encodedLength(readback.records)} bytes, against ${describeRecords(
              source.records,
            )}, ${encodedLength(source.records)} bytes. Read the tag on 13.56 MHz before ` +
            "trusting what it holds.",
        };
      }
      return verifiedDecision(source, readback);
    }
    case "unverified": {
      const readback = evidence.readback;
      if (readback !== null && messagesEqual(source, readback)) {
        return verifiedDecision(source, readback, true);
      }
      if (readback !== null && previous !== null && messagesEqual(previous, readback)) {
        return {
          kind: "refused",
          refusal: {
            condition: "destination-protected",
            message:
              "Not copied: the destination would not accept the write. It is read-only or " +
              "password protected, and this Reader cannot tell the two apart.",
            detail:
              `Tag ${readback.uid} still reads back exactly what it held before the write, so the ` +
              "message is unchanged. A read-only tag and a password-protected one " +
              "produce the same result here, and the Reader has no command that distinguishes " +
              "them. Read the tag on 13.56 MHz to see what it holds before trying again.",
          },
        };
      }
      return {
        kind: "result",
        verification: "unverified",
        message:
          readback === null
            ? "Not verified: the message was sent, but the destination could not be read back."
            : "Not verified: the message was sent, but the destination did not read back as it.",
        detail:
          readback === null
            ? "The tag could not be read back, so what it holds is unknown. Read it on " +
              "13.56 MHz before writing it again."
            : `What it reads back as decodes to ${describeRecords(
                readback.records,
              )}, which is not the message that was written. Read the tag on 13.56 MHz to ` +
              "see what it holds before writing it again.",
      };
    }
    case "refused":
      return {
        kind: "refused",
        refusal: {
          condition: "destination-refused",
          message: `Not copied: the write was refused before it was sent${
            evidence.reason === null ? "" : ` (${evidence.reason})`
          }.`,
          detail:
            "Nothing was written. The write path re-reads the tag before it sends anything, " +
            "so what the destination holds is unchanged.",
        },
      };
    case "failed":
      return {
        kind: "failed",
        message: "Not copied: the write could not be sent.",
        detail:
          `${
            evidence.reason === null ? "The Reader did not answer." : `${evidence.reason}.`
          } Nothing reached the tag, so its contents are unchanged.`,
      };
  }
}

/** A copy the destination's read-back proved, by bytes or by decoded Records. */
function verifiedDecision(
  source: CopyMessage,
  readback: CopyMessage | null,
  reEncoded = false,
): CopyDecision {
  const records = describeRecords(source.records);
  const bytes = encodedLength(source.records);
  return {
    kind: "result",
    verification: "verified",
    message:
      readback === null
        ? `Copied — the write's own read-back matched the message byte for byte: ${records}, ` +
          `${bytes} bytes.`
        : `Copied — tag ${readback.uid} reads back the same ${records} in order and the same ` +
          `${bytes} bytes.`,
    detail:
      readback === null
        ? "The write path compared what it wrote with what the tag held afterwards; no " +
          "second read-back was available here to compare Records from."
        : reEncoded
          ? "The destination stored the message in its own encoding. Copy compares the " +
            "decoded Records in order and the total encoded length, not the bytes, so a " +
            "re-encoded equal message is still a verified copy."
          : null,
  };
}

/**
 * The outcome one decision reports, or null for a step that is not a result.
 *
 * A `proceed` is navigation: nothing happened, so nothing is said and nothing is
 * sounded. A `nothing-latched` is the informational outcome the app already has
 * for an empty field: visible, silent, and not an error.
 */
export function copyOutcome(decision: CopyDecision): Outcome | null {
  switch (decision.kind) {
    case "proceed":
      return null;
    case "nothing-latched":
      return outcomes.nothingLatched("copy", decision.detail);
    case "result":
      return outcomes.copy(decision.verification, decision.message, decision.detail ?? undefined);
    case "refused":
      return outcomes.copy("refused", decision.refusal.message, decision.refusal.detail);
    case "failed":
      return outcomes.copy("failed", decision.message, decision.detail);
  }
}

// ---------------------------------------------------------------------------
// reading the flow's values from what the read and write paths return
// ---------------------------------------------------------------------------

/**
 * The message a read holds, when the read produced one.
 *
 * Null for every read that did not: nothing latched, a reply that could not be
 * decoded, a family that cannot carry a message, or a message this build could
 * not decode. A Copy that started from a partly-read source would be copying
 * whatever this build happened to understand, which is exactly the failure the
 * `records` state exists to rule out.
 */
export function copySource(read: HfRead): CopyMessage | null {
  const reading = read.reading;
  if (reading === null || reading.state !== "decoded") return null;
  if (read.message.state !== "records" || read.message.messageHex === null) return null;
  return { uid: reading.uid, records: read.message.records, messageHex: read.message.messageHex };
}

/**
 * The destination a read describes.
 *
 * A read that latched no Tag is `latched: false`; a Tag that answered but whose
 * message could not be read is `latched: true` with `message: null` and the
 * reason in `problem`. The two must not be confused: one is an empty field and
 * the other is a Tag whose content cannot be named.
 *
 * `holds` is the read's own message state, copied rather than reinterpreted, so a
 * Tag that read fine and holds nothing (`empty-message`, `no-ndef-tlv`) keeps its
 * answer all the way to the guard. A read that fetched nothing because the poll
 * reply was undecodable, the message read failed, or the read described another
 * Tag keeps its own state too, and the guard refuses those instead.
 */
export function copyDestination(read: HfRead): CopyDestination {
  const reading = read.reading;
  if (reading === null) {
    return {
      uid: null,
      latched: false,
      holds: "nothing-latched",
      message: null,
      problem: null,
      capacityBytes: null,
    };
  }
  const uid = reading.state === "decoded" ? reading.uid : null;
  const message =
    uid !== null && read.message.state === "records" && read.message.messageHex !== null
      ? { uid, records: read.message.records, messageHex: read.message.messageHex }
      : null;
  const problem =
    message !== null
      ? null
      : reading.state === "raw"
        ? reading.detail
        : (read.message.reason ?? read.message.note);
  return {
    uid,
    latched: true,
    holds: read.message.state,
    message,
    problem,
    capacityBytes: read.capacityBytes,
  };
}

/** The write's evidence, with its read-back decoded the same way the source was. */
export function copyEvidence(result: NdefWriteResult): CopyWriteEvidence {
  const readback = readbackMessage(result.after);
  switch (result.outcome) {
    case "verified":
      return { outcome: "verified", reason: null, readback };
    case "unverified":
      return { outcome: "unverified", reason: result.message, readback };
    case "refused":
      return { outcome: "refused", reason: result.message, readback };
    case "failed":
      return { outcome: "failed", reason: result.message, readback };
    case "blanked":
    case "erased":
      // An NDEF write replaces a message and can never blank or erase a Tag.
      // Reported as a failure rather than trusted, for the same reason
      // `writeNotice` names it as a bug.
      return {
        outcome: "failed",
        reason:
          result.message ??
          `the write reported ${result.outcome}, which writing an NDEF message cannot produce`,
        readback,
      };
  }
}

/** The message one Tag read back as, when it read back as one. */
function readbackMessage(tag: NdefTagSnapshot | null): CopyMessage | null {
  if (tag === null || tag.existing.messageHex === null) return null;
  const records = existingRecords(tag.existing);
  if (records === null) return null;
  return { uid: tag.uid, records, messageHex: tag.existing.messageHex };
}

/** "2 Records" or "1 Record", the count alone, for a sentence about size. */
function describeRecords(records: readonly DraftRecord[]): string {
  return `${records.length} ${records.length === 1 ? "Record" : "Records"}`;
}
