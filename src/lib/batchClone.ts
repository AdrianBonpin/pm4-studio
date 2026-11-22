/**
 * Batch Clone: one source Identity held, then written to successive Blanks.
 *
 * A **Clone** copies one Tag's Identity onto a **Blank** (GLOSSARY). The
 * several-people case is that Clone repeated: the original is read **once**, the
 * Identity is held here, and every later attempt writes it again without reading
 * the source a second time.
 *
 * The device side is `src-tauri/src/batch.rs`. This module is the webview half:
 * the run's state, the counting, and the words each attempt is reported in. It
 * decides nothing about whether a write may happen — ADR 0001's guard owns that,
 * per attempt — and it must never soften what came back.
 *
 * # Three rules this module exists to keep
 *
 *   * **Every attempt reports itself.** Five outcomes (`verified`, `skipped`,
 *     `unverified`, `refused`, `failed`) are reported one attempt at a time. A
 *     refusal on one attempt does not end the run, and there is no aggregate
 *     "the batch worked" verdict to hide it behind.
 *   * **Only a verified attempt is a copy.** `confirmedCopies` counts verified
 *     attempts and nothing else, the same rule as `writeOutcome.ts` and the Rust
 *     store.
 *   * **Two identical Blanks cannot be told apart.** The Reader reports an
 *     Identity, not a chip serial, so nothing here can distinguish a Blank that
 *     was never written from one that was written a minute ago and put back.
 *     That is why an attempt whose Tag already presents the Identity is
 *     `skipped` rather than counted, and why the run says every attempt needs a
 *     fresh Tag on the Reader.
 */

import type { BatchAttemptOutcome, BatchAttemptResult, LfCard } from "../types";
import { NOTICE_TONE_CLASS } from "./noticeTone";
import { attemptKind, severityOf, toneForSeverity } from "./severity";
import { confirmedCopiesLabel, countsAsConfirmedCopy, type WriteNotice } from "./writeOutcome";

/** How many attempts of each kind a run has produced. */
export interface BatchCounts {
  verified: number;
  skipped: number;
  refused: number;
  unverified: number;
  failed: number;
  /** Total attempts, whatever they turned out to be. */
  attempts: number;
}

export const EMPTY_BATCH_COUNTS: BatchCounts = {
  verified: 0,
  skipped: 0,
  refused: 0,
  unverified: 0,
  failed: 0,
  attempts: 0,
};

/**
 * One run: the Tag whose Identity is being copied, and what each attempt came to.
 *
 * `source` is the reading taken once at the start. It is held, never re-read: the
 * whole point of a batch is that the original does not have to be tapped again
 * between Blanks.
 */
export interface BatchRun {
  readonly source: LfCard;
  readonly attempts: readonly BatchAttemptResult[];
}

export function startBatch(source: LfCard): BatchRun {
  return { source, attempts: [] };
}

export function recordAttempt(run: BatchRun, result: BatchAttemptResult): BatchRun {
  return { source: run.source, attempts: [...run.attempts, result] };
}

/**
 * The arguments one attempt is sent with.
 *
 * These come from the held source reading, never from anything read mid-run, so
 * an attempt cannot write a different Identity because a Tag happened to be
 * swapped in at the wrong moment.
 */
export function attemptRequest(run: BatchRun): { customer: number; data32: number } {
  return { customer: run.source.customer, data32: run.source.data32 };
}

/** The Identity text the run is copying, for headings and messages. */
export function sourceIdentity(run: BatchRun): string {
  return run.source.id;
}

/**
 * The batch's counting rule, expressed through the copy path's so the two cannot
 * drift.
 *
 * `skipped` is not a `WriteOutcome` at all — it is the batch's own name for a
 * guard refusal on a Tag that already carries the Identity — so it is excluded
 * before the copy rule sees it. That is what makes it structurally impossible for
 * a skip to raise a count.
 */
export function attemptCountsAsConfirmedCopy(outcome: BatchAttemptOutcome): boolean {
  return outcome === "skipped" ? false : countsAsConfirmedCopy(outcome);
}

/** Per-kind totals: each attempt is counted once, under its own outcome. */
export function batchCounts(results: readonly BatchAttemptResult[]): BatchCounts {
  const counts: BatchCounts = { ...EMPTY_BATCH_COUNTS, attempts: results.length };
  for (const result of results) {
    counts[result.outcome] += 1;
  }
  return counts;
}

/**
 * Confirmed copies made by this run: verified attempts and nothing else.
 *
 * A `skipped` attempt is excluded by construction, which is what stops a Tag
 * left in the Reader from being counted twice.
 */
export function runConfirmedCopies(run: BatchRun): number {
  return run.attempts.filter((attempt) => attemptCountsAsConfirmedCopy(attempt.outcome)).length;
}

/** True when at least one attempt was confirmed: something exists to show. */
export function hasVerifiedAttempt(run: BatchRun): boolean {
  return run.attempts.some((attempt) => attempt.outcome === "verified");
}

/**
 * The fact a batch cannot work around: the Reader names an Identity, not a chip.
 *
 * Shown before the run starts and again beside the results, because it is the
 * assumption a user is most likely to make wrongly — that the app can tell one
 * Blank from another.
 */
export const IDENTICAL_BLANKS_LIMIT =
  "Two blanks that look alike cannot be told apart. The reader reports an identity, not a chip, so a blank you have already written looks exactly like one you have not. Each attempt reads whatever tag is on the reader: put a fresh blank on it before each write.";

/**
 * The same fact as an instruction, for beside the write button: an attempt reads
 * the Tag that is there now, so the previous one has to come off first.
 */
export const FRESH_TAG_PER_ATTEMPT =
  "Each attempt needs a fresh tag. Take the original off the reader before the first attempt, and each written tag off before the next: a tag that already carries this identity is skipped, not written.";

/**
 * What happens if a written Tag stays in place, stated before it happens so a
 * skip reads as expected rather than as a failure.
 */
export const SKIP_IS_NOT_A_COPY =
  "If a tag that already carries this identity is left on the reader, the attempt is skipped: nothing is written, and it is not counted as another copy. That is the guard refusing a write to the original tag, which is the case that has locked a chip.";

/** One fact the user must read before the first attempt is offered. */
export interface BatchFact {
  readonly title: string;
  readonly detail: string;
}

/** The facts the batch states before the first attempt. */
export const BATCH_FACTS: readonly BatchFact[] = [
  {
    title: "One tag per attempt",
    detail: `${FRESH_TAG_PER_ATTEMPT} ${IDENTICAL_BLANKS_LIMIT}`,
  },
  {
    title: "A skipped attempt was not written",
    detail: SKIP_IS_NOT_A_COPY,
  },
  {
    title: "Only a verified attempt counts",
    detail:
      "A confirmed copy is a tag whose read-back proved it carries this identity. A skipped, refused, unknown, or failed attempt adds nothing to the count.",
  },
];

/** The count sentence for one attempt, or "" when no Snapshot carries it. */
function countSentence(result: BatchAttemptResult): string {
  if (result.confirmedCopies === null) {
    return " No Snapshot in the library carries this identity, so there is no count to keep.";
  }
  const label = confirmedCopiesLabel(result.confirmedCopies);
  return result.outcome === "verified"
    ? ` The library now lists ${label} of it.`
    : ` Unchanged: ${label}.`;
}

/**
 * What to tell the user about one attempt, in the words of its actual outcome.
 *
 * `skipped` is worded as its own result: the tag already carries the identity, so
 * nothing was written and nothing was counted. It is deliberately not worded as
 * a copy, and never as a fault in the tag that the user has to fix by re-seating
 * a tag that is already correct — though it is a *refusal*, so it sounds and is
 * drawn like one (attention, spec's alphabet table): "that fob is fine", "that
 * tag was never read" and "that write is unknown" have to be three different
 * things to hear.
 */
export function attemptNotice(result: BatchAttemptResult): WriteNotice {
  return {
    tone: toneForSeverity(severityOf(attemptKind(result))),
    text: attemptSentence(result),
  };
}

/** The sentence for one attempt, in the words of what it actually came to. */
function attemptSentence(result: BatchAttemptResult): string {
  switch (result.outcome) {
    case "verified":
      return (
        `Verified — the tag reads ${result.readback?.id ?? "the identity you wrote"}.` +
        countSentence(result)
      );
    case "skipped":
      return (
        (result.message ??
          "this tag already carries the identity being written, so nothing was written.") +
        " Not counted as another copy." +
        countSentence(result)
      );
    case "unverified":
      return (
        "Unknown: " +
        (result.message ?? "the write was sent but the tag did not read back") +
        countSentence(result)
      );
    case "refused":
      return `Not written: ${result.message ?? "the reader refused the write"}` + countSentence(result);
    case "failed":
      return (
        `Not written: the write could not be sent${
          result.message ? ` (${result.message})` : ""
        }.` + countSentence(result)
      );
  }
}

/** Short label for one attempt in the run's list. */
export const OUTCOME_LABEL: Record<BatchAttemptOutcome, string> = {
  verified: "Verified",
  skipped: "Skipped",
  unverified: "Unknown",
  refused: "Refused",
  failed: "Failed",
};

/**
 * The ink of one attempt in the run's list.
 *
 * Read from the one tone table rather than naming a colour here, and from the
 * severity the seam gives the kind that attempt becomes — so a skipped tag is
 * drawn the same colour every other refusal is, and no colour is named twice.
 */
export const OUTCOME_TONE_CLASS: Record<BatchAttemptOutcome, string> = {
  verified: NOTICE_TONE_CLASS.ok,
  skipped: NOTICE_TONE_CLASS.err,
  unverified: NOTICE_TONE_CLASS.warn,
  refused: NOTICE_TONE_CLASS.err,
  failed: NOTICE_TONE_CLASS.err,
};

/**
 * The run's progress in one sentence, every kind counted separately so nothing
 * is hidden inside "some attempts failed".
 */
export function summarySentence(run: BatchRun): string {
  const counts = batchCounts(run.attempts);
  if (counts.attempts === 0) {
    return "No attempts yet. Put a blank on the reader and write it.";
  }
  const lead = `${counts.attempts} ${counts.attempts === 1 ? "attempt" : "attempts"}`;
  const kinds: string[] = [];
  if (counts.verified > 0) kinds.push(`${counts.verified} verified`);
  if (counts.skipped > 0) kinds.push(`${counts.skipped} skipped`);
  if (counts.unverified > 0) kinds.push(`${counts.unverified} unknown`);
  if (counts.refused > 0) kinds.push(`${counts.refused} refused`);
  if (counts.failed > 0) kinds.push(`${counts.failed} failed`);
  const list = kinds.length > 0 ? `: ${kinds.join(", ")}` : "";
  return `${lead}${list}. ${confirmedCopiesLabel(runConfirmedCopies(run))} made by this run.`;
}
