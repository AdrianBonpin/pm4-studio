/**
 * Erasing a Tag's NDEF content: the confirmation the user reads, and the wording
 * of what came of it.
 *
 * Erasing writes an empty Type 2 NDEF TLV (`03 00 FE`) over the message area. The
 * Tag keeps its UID, its Capability Container and its format, so it stays a Tag
 * that can be written again — it simply carries no Records. That distinction is
 * the whole feature, and the words here are chosen to keep it:
 *
 *   * "erase" / "erased" for clearing content, never "format", "wipe", "reset"
 *     or "unlock";
 *   * never "read-only": erasing does not lock a Tag, and locking is not
 *     reachable over this protocol;
 *   * never "remove protection": a password is a separate operation, and
 *     clearing content neither sets nor clears one.
 *
 * The outcome model lives in Rust (`src-tauri/src/write_outcome.rs` and
 * `src-tauri/src/ntag.rs`) and reaches this module already decided. The rule that
 * matters here: a successful erase is `erased` with its own word, never
 * `verified` — clearing content places no copy, so no Snapshot's confirmed-copy
 * count may move.
 */

import type { EraseResult } from "../types";
import {
  existingRecords,
  pagesLabel,
  recordsLabel,
  type NdefTagView,
} from "./tagWrite";
import { eraseKind, severityOf, toneForSeverity } from "./severity";
import type { WriteNotice } from "./writeOutcome";

/** What erasing the Tag would clear, as the backend read it. Read-only. */
export interface NdefErasePreview {
  /** What the tag holds now, so the confirmation can name what will be lost. */
  tag: NdefTagView | null;
  /** Bytes of the current NDEF message an erase would clear, TLV included. */
  clearsBytes: number;
  /** User pages an erase would write: `03 00 FE` plus the old message's tail. */
  pages: number[];
  capacityBytes: number | null;
  /** True only when an erase would actually proceed. */
  canErase: boolean;
  /** Why it would not proceed: no tag, unreadable, already empty, or no message. */
  refusal: string | null;
}

/** The one verb this feature may use for itself. */
export const ERASE_ACTION_LABEL = "Erase the tag's content";

/** One fact the user must read before the erase is offered. */
export interface EraseFact {
  readonly title: string;
  readonly detail: string;
}

/**
 * The facts the confirmation states. Each one is a consequence the user cannot
 * discover afterwards without having lost content they wanted.
 */
export const ERASE_FACTS: readonly EraseFact[] = [
  {
    title: "The content is gone",
    detail:
      "The tag's NDEF message is overwritten with an empty one. The Records named above cannot be read back from the tag afterwards.",
  },
  {
    title: "The tag stays a tag",
    detail:
      "Erasing clears content, it does not destroy the tag or change its format. The UID, the Capability Container and the memory size are left as they are, so the tag can be written again straight away.",
  },
];

/**
 * What erasing the Tag's content is *not*, in the words the confirmation uses.
 *
 * Two limits of this Reader that a user about to erase a Tag could reasonably
 * expect to trip, so they are stated before the button and not only in the
 * capability limits — one sentence each, because a confirmation for one
 * destructive action should not run to eight paragraphs (spec, "too much text").
 */

/**
 * The denial the ticket requires, stated as plainly as the facts above it.
 * Erasing is not a way to protect a tag, and the app says so before the write is
 * offered rather than after.
 */
export const ERASE_IS_NOT_READ_ONLY =
  "Erasing does not make this tag read-only and does not lock it: locking is not possible with this Reader, so the tag can be written again immediately.";

export const ERASE_IS_NOT_PASSWORD_REMOVAL =
  "It does not remove password protection: a password this Reader cannot set is one it cannot clear, so a password-protected tag stays unrecoverable.";

/** The confirmation, ready to render. */
export interface EraseConfirmation {
  /** UID of the tag the erase would apply to, as the user saw it read. */
  readonly uid: string;
  /** Heading: names the tag and the action. */
  readonly title: string;
  /** What will be lost, in the tag's own Records where they can be decoded. */
  readonly sentence: string;
  /** Where the erase writes, so the extent is concrete. */
  readonly where: string;
  readonly action: string;
  readonly facts: readonly EraseFact[];
  readonly notReadOnly: string;
  readonly notPasswordRemoval: string;
}

/**
 * The sentence naming what an erase would clear. This is the point of the
 * confirmation: the user consents to losing something specific, not to
 * "erasing the tag".
 */
export function eraseSentence(preview: NdefErasePreview): string {
  if (!preview.tag) {
    return preview.refusal ?? "No 13.56 MHz tag is in the field.";
  }
  const existing = preview.tag.existing;
  if (existing.state === "empty") {
    return "The tag already holds no Records, so there is nothing to erase.";
  }
  if (existing.state === "unreadable") {
    return `Erasing clears content on the tag that this app could not read${
      existing.reason ? ` (${existing.reason})` : ""
    }, so what it holds may not be listed in full.`;
  }
  const records = existingRecords(existing);
  const what =
    records === null
      ? `a message this build cannot decode (${existing.bytes} ${
          existing.bytes === 1 ? "byte" : "bytes"
        })`
      : recordsLabel(records);
  return `Erasing removes what the tag holds now: ${what}.`;
}

/** Where the erase writes, in pages, so the extent is concrete rather than vague. */
export function eraseWhere(preview: NdefErasePreview): string {
  if (preview.pages.length === 0) {
    return "Nothing to write.";
  }
  const bytes =
    preview.clearsBytes === 0
      ? ""
      : `, ${preview.clearsBytes} ${preview.clearsBytes === 1 ? "byte" : "bytes"} cleared`;
  return (
    `It writes ${pagesLabel(preview.pages)}${bytes}: an empty NDEF message over the content ` +
    "that is there now. Pages 0 to 3 — the UID, lock bytes and Capability Container — are never written."
  );
}

/**
 * Build the confirmation for one read Tag.
 *
 * It takes what the backend read rather than a tag identity, so the caller
 * cannot confirm something it did not read; and the backend reads the Tag again
 * immediately before erasing, so the confirmation can never be applied to a
 * different tag in the field.
 */
export function eraseConfirmation(preview: NdefErasePreview): EraseConfirmation {
  const uid = preview.tag?.uid ?? "no tag";
  return {
    uid,
    title: `Erase the content of tag ${uid}?`,
    sentence: eraseSentence(preview),
    where: eraseWhere(preview),
    action: ERASE_ACTION_LABEL,
    facts: ERASE_FACTS,
    notReadOnly: ERASE_IS_NOT_READ_ONLY,
    notPasswordRemoval: ERASE_IS_NOT_PASSWORD_REMOVAL,
  };
}

/**
 * What to tell the user about one erase, in the words of its actual outcome.
 *
 * `erased` is its own word, never "verified": the tag is present with no
 * Records, which is a definite result and not a copy of anything. An erase whose
 * read-back could not be read is "unknown" with instructions, because the tag may
 * already be clean and discarding it would be the wrong move.
 */
export function eraseNotice(result: EraseResult): WriteNotice {
  // The severity is the seam's, so the notice beside the result cannot be
  // drawn in a calmer tone than the sound the same result made (ADR 0008).
  const tone = toneForSeverity(severityOf(eraseKind(result.outcome)));
  const bytes =
    result.clearedBytes === 0
      ? ""
      : ` It cleared ${result.clearedBytes} ${result.clearedBytes === 1 ? "byte" : "bytes"} of NDEF content.`;
  switch (result.outcome) {
    case "erased":
      return {
        tone,
        text:
          "Erased — the tag reads back as present with no Records. Its UID, Capability " +
          "Container and capacity are unchanged, so it is ready to be written again." +
          bytes +
          " Erasing clears content rather than copying anything, so no Snapshot's " +
          "confirmed-copy count moved.",
      };
    case "refused":
      return {
        tone,
        text: `Not erased: ${result.message ?? "the erase was not attempted"}.`,
      };
    case "unverified":
      return {
        tone,
        text:
          "Unknown: the erase was sent but the tag did not read back, so what it holds " +
          "cannot be confirmed. Read the tag on 13.56 MHz to see whether it carries no " +
          "Records before erasing or writing it again." +
          bytes,
      };
    case "failed": {
      // "Still readable" is only said when a read followed the erase. A failure
      // that never reached the tag has nothing to say about what it holds.
      const readable = result.after !== null ? " The tag is still readable." : "";
      return {
        tone,
        text: `Not erased. ${
          result.message ?? "The erase did not take, so the tag still holds its content."
        }${readable}`,
      };
    }
  }
}

/**
 * How the erase's extent reads in a result line: "pages 4–16 (13 pages)".
 * Exported so the UI and the tests word it the same way.
 */
export function erasedPagesLabel(result: EraseResult): string {
  return pagesLabel(result.acceptedPages);
}
