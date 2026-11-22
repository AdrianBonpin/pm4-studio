/**
 * How a write outcome is shown, and how a Snapshot's count is worded.
 *
 * A Snapshot's count is CONFIRMED COPIES, not attempts: it rises only for a
 * write whose read-back matched. A refusal, a transmission failure, and a write
 * whose read-back could not confirm it are all reported as what they are, and
 * none of them is worded as a copy. The same rule is enforced in the store
 * (`src-tauri/src/library.rs`), so the two cannot drift silently.
 */

import type { RefusalCause, WriteOutcome, WriteResult } from "../types";
import { copyWriteKind, severityOf, toneForSeverity } from "./severity";
import type { NoticeTone } from "./noticeTone";

/** Only a verified read-back is a confirmed copy; nothing else counts. */
export function countsAsConfirmedCopy(outcome: WriteOutcome): boolean {
  // A cleared or destroyed write is deliberately not in this list: both replace an
  // Identity on a Tag rather than putting one on another.
  return outcome === "verified";
}

/**
 * "3 confirmed copies" — never a bare number, which a user would read as "I
 * tried three times". Zero is spelled out for the same reason.
 */
export function confirmedCopiesLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "No confirmed copies";
  const n = Math.floor(count);
  return n === 1 ? "1 confirmed copy" : `${n} confirmed copies`;
}

/** Shown wherever a count appears: what it takes for one to be added. */
export const CONFIRMED_COPIES_HINT =
  "A confirmed copy is a Tag whose read-back proved it carries what was written — this Identity on 125 kHz, these Records on 13.56 MHz. A refused, unverified, or failed write adds nothing to the count.";

/**
 * A notice about one write result: the words, and the tone the seam's severity
 * wears.
 *
 * The tone is **not** chosen here. `lib/outcome` decides what a write came to (a
 * verified write, an unverified one, a skip, an unreadable refusal, a failure) and
 * `lib/severity` holds the one table that turns that into a severity. This module
 * reads the answer, so an inline "Skipped: …" cannot be drawn in a calmer tone
 * than the sound the same result made — which is what happened while both places
 * derived a severity from the same refusal cause (ADR 0008).
 */
export interface WriteNotice {
  tone: NoticeTone;
  text: string;
}

/** The count sentence for an outcome, or "" when the library holds no such Snapshot. */
function countSentence(result: WriteResult, outcome: WriteOutcome): string {
  if (result.confirmedCopies === null) {
    return " No Snapshot in the library carries this Identity, so there is no count to keep.";
  }
  const label = confirmedCopiesLabel(result.confirmedCopies);
  // Only a verified write is a copy. Clearing and destroying replace an Identity,
  // so even a successful one leaves the count exactly where it was.
  if (outcome === "verified") {
    return ` The library now lists ${label} of it.`;
  }
  return ` Unchanged: ${label}.`;
}

/**
 * What to tell the user about one write, in the words of its actual outcome.
 * An unconfirmed write is "unknown", not success and not a definitive failure.
 */
export function writeNotice(result: WriteResult): WriteNotice {
  // The severity is the seam's, read from the kind this result gets there. The
  // two cannot disagree because there is one answer, computed in one place.
  const tone = toneForSeverity(
    severityOf(copyWriteKind(result.outcome, refusalCauseOf(result))),
  );
  return { tone, text: writeSentence(result) };
}

/** The sentence for one write result, in the words of what it actually came to. */
function writeSentence(result: WriteResult): string {
  switch (result.outcome) {
    case "verified":
      return (
        `Verified — the tag reads ${result.readback?.id ?? "the identity you wrote"}.` +
        countSentence(result, "verified")
      );
    case "refused":
      // A refusal is the guard stopping the write before anything was sent, and
      // ADR 0001 gives it two conditions with two different fixes. They are
      // worded apart here, because a user told to "seat a tag that reads" when
      // the real answer is "this is the original, swap it" is being sent to fix
      // the wrong problem. The reason itself is the guard's own sentence, never a
      // second copy of it.
      return refusalSentence(result);
    case "unverified":
      return (
        "Unknown: the write was sent but the tag did not read back, so it is not counted. " +
        "Read the tag on the reader to find out what it holds." +
        countSentence(result, "unverified")
      );
    case "failed":
      return (
        `Not written: the write could not be sent${
          result.message ? ` (${result.message})` : ""
        }.` + countSentence(result, "failed")
      );
    case "cleared":
    case "destroyed":
      // Clear and Destroy have their own notices and their own wording; see
      // `lib/clearTag.ts`. A copy write never reports either, so reaching here is a
      // bug worth naming rather than a result worth wording.
      return (
        "Unexpected outcome: this write reported a cleared or destroyed tag, which a copy " +
        "cannot do. Clear and Destroy have their own notices; nothing was counted here."
      );
    case "erased":
      // Erasing NDEF content has its own notice and its own word; see
      // `lib/eraseTag.ts`. A 125 kHz copy cannot clear an NDEF message, so this
      // is a bug worth naming rather than a result worth wording.
      return (
        "Unexpected outcome: this write reported an erased tag, which a copy cannot do. " +
        "Erasing NDEF content has its own notice; nothing was counted here."
      );
  }
}

/**
 * The two conditions ADR 0001 can refuse on, as a sentence each.
 *
 * `null` is "a refusal whose cause nobody established" — an older reply, or a
 * shape that should not exist. It keeps the unreadable wording's shape (an
 * error, not a skip), because the fail-safe direction is to send the user to
 * look at the Tag rather than to tell them nothing is wrong.
 */
function refusalSentence(result: WriteResult): string {
  const reason = result.message ?? "the reader refused the write";
  const cause = refusalCauseOf(result);
  // "Skipped" is the word for ADR 0001's second condition, and the difference
  // between it and "Not written" is the *fix*, not the severity: both are
  // refusals, and both sound attention (spec's alphabet table).
  const lead = cause === "already-carries" ? "Skipped" : "Not written";
  return `${lead}: ${reason}` + countSentence(result, "refused");
}

/**
 * Which of the guard's two conditions stopped this write, or `null`.
 *
 * Only a refused write can carry a cause; anything that was transmitted reports
 * `null` whatever field a caller passes, so a transmitted write can never be
 * reclassified into a refusal by a stray value.
 */
export function refusalCauseOf(result: WriteResult): RefusalCause | null {
  if (result.outcome !== "refused") return null;
  return result.refusalCause ?? null;
}
