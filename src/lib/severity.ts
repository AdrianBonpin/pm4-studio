/**
 * The seam's tables: the closed discriminator set, one severity per
 * discriminator, the signal a severity becomes, and the tone it wears on screen.
 *
 * These live here rather than inside `lib/outcome.ts` for one reason. The wording
 * modules — `lib/writeOutcome`, `lib/tagWrite`, `lib/blankTag`, `lib/eraseTag`,
 * `lib/batchClone` — both word a result and render a notice beside it, and ADR
 * 0008 says severity is chosen in one place. If they could not read the severity
 * from the seam, they would have to decide a second one, and the second one drifts
 * (it did: a refusal was worded *warn* while the seam sounded three chirps for it).
 * So the tables sit below both, `outcome.ts` imports them and re-exports them, and
 * a wording module asks what severity the seam chose instead of guessing.
 *
 * The four severities are the alphabet's four symbols (ADR 0009, spec's "audible
 * alphabet" table), and nothing here invents a fifth:
 *
 * | Severity | Symbol | Meaning |
 * |---|---|---|
 * | `success` | one chirp | completed and confirmed good |
 * | `warning` | two chirps | completed, but the result needs checking |
 * | `error` | three chirps | failed, refused, or nothing was changed |
 * | `info` | silence | said on screen only; nothing to act on, or a state rather than a result |
 *
 * Nothing in this module touches a Reader, a store or a component.
 */

import type {
  BatchAttemptOutcome,
  BatchAttemptResult,
  BlankResult,
  EraseResult,
  RefusalCause,
  WriteOutcome,
} from "../types";
import type { NoticeTone } from "./noticeTone";
import type { SignalSymbol } from "./signal";

/** How much attention one outcome deserves. Chosen by the kind, never by a caller. */
export type Severity = "info" | "success" | "warning" | "error";

/**
 * What an operation did, as a closed set. A new kind is a deliberate edit here,
 * not a sentence invented at a call site.
 */
export type OutcomeKind =
  /** A Tag was read; the read is the whole result. */
  | "read"
  /** A read that finished but whose result wants checking: it got part of what it
   *  went for, and says why the rest is missing. Distinct from `read` because the
   *  sound has to be (ADR 0009), and distinct from `failed` because something was
   *  obtained and is on screen. */
  | "read-incomplete"
  /** There was no Tag in the field. Nothing happened, and that is not an error. */
  | "nothing-latched"
  /** A read was kept in the library: the Snapshot is on disk. */
  | "saved"
  /**
   * The read was already in the library, so nothing was added. Informational and
   * silent: a repeat read is not a fault, and it did not change anything. It is
   * still said, because a save that vanishes without a word looks like a save that
   * failed.
   */
  | "already-saved"
  /** A write whose read-back proved it. */
  | "verified"
  /** A Reset that left no Identity on the Tag. */
  | "blanked"
  /** A readout's message became a Draft. About this machine's library, not the
   *  Tag: a Draft is authored here and no Tag was written to. */
  | "drafted"
  /** An erase that cleared the Tag's NDEF content. */
  | "erased"
  /** Saved data was cleared from this machine, by the one action allowed to.
   *  About this app's storage, never about a Tag: erasing a Tag is `erased`. */
  | "data-cleared"
  /** Sent, but the read-back could not confirm it. The Tag's state is unknown. */
  | "unverified"
  /** Stopped before anything was sent: the guard, the tag or the frame refused. */
  | "refused"
  /**
   * Nothing was written because the Tag in the write position already presents
   * the Identity being written. ADR 0001's second refusal, named for what it is:
   * the Tag read perfectly well, so nowhere needs reseating — the answer is a
   * *different* Tag, almost always the original taken off the Reader.
   *
   * It is a refusal, so it is **attention**: three chirps and the LED held, because
   * the spec's alphabet gives that symbol to "failed, refused, or the tag will not
   * accept the write; nothing changed". It was two chirps once, on the reasoning
   * that "this is the wrong tag" is friendlier than "something failed" — but that
   * made a refusal sound like *completed, result needs checking*, which is the one
   * thing a refusal is not, and in a batch it made a skip indistinguishable from an
   * unknown write by ear.
   */
  | "skipped"
  /**
   * Nothing was written because nothing could be read in the write position.
   * ADR 0001's first refusal, and its own outcome rather than the generic one:
   * the fix is to seat a Tag that reads, which is not the fix for a Tag that
   * reads fine and is the wrong Tag.
   */
  | "unreadable"
  /** Attempted and did not work. */
  | "failed"
  /** A Reset this Tag will not accept writes for; nothing changed. */
  | "reset-refused"
  /** Refused because the running build sends only non-changing commands. */
  | "refused-by-build"
  /**
   * No Reader attached **at rest**.
   *
   * A **state**, not the result of an operation: an unplugged Reader is the normal
   * condition of an app whose hardware is optional (`hooks/useReader` says so, and
   * `deviceFailureNotice("absent").tone` has always been the quiet one). So it is
   * said on screen — with the plug-in remedy, the reconnect control and the
   * dismiss — and it is **silent**. The spec's silent symbol is "nothing happened:
   * no tag latched, nothing to act on — not an error", which is exactly this: the
   * launch produced nothing, and the beeper that would sound the alarm is on the
   * Reader that is not there. Reported as a warning it chirped twice on every
   * launch, which is not news.
   *
   * Only `outcome.readerState` produces this kind. The same absence arriving from a
   * running operation is `reader-gone`.
   */
  | "reader-absent"
  /**
   * The Reader went away **while an operation was running**: the app was talking
   * to it, and it stopped being there, so that operation did not complete.
   *
   * Attention, not silence, and the difference is the whole reason this kind is
   * separate from `reader-absent`: a state that was true before the operation is
   * not news, but an operation the user started and lost is. It takes the
   * alphabet's attention symbol — three chirps and the LED held — because silence
   * here would say *nothing happened* about something that did. The message does
   * not go on to claim the Tag is unchanged: an interrupted write is exactly the
   * case where nobody can say what reached the chip, so it says to check the Tag.
   */
  | "reader-gone"
  /** Another process holds the Reader. A fault: one holder at a time, and the
   *  user has to close the other process. */
  | "reader-claimed"
  /**
   * The Reader stopped answering until it is physically replugged.
   *
   * Also a state, but not a quiet one: the hardware is present and broken, only a
   * replug clears it, and every operation attempted meanwhile fails. That is
   * "failed, nothing changed", so it is attention — one symbol per distinct
   * failure, not a burst: `App.tsx` reports a given message once.
   */
  | "reader-wedged"
  /** The Reader failed in a way none of the above name. */
  | "reader-failure"
  /** A stored preference changed. Informational: says something, sounds nothing. */
  | "announcement"
  /**
   * The beeper test was pressed in Settings. An operation the user started — it
   * sounds, and it says what was sent rather than what was heard.
   */
  | "beep-test"
  /**
   * The LED-off frame (`0x0055`) was sent from Settings → Diagnostics.
   *
   * It is an operation the user started and it reports like one, but it is **not**
   * a beep — `0x0055` releases the LED and chirps nothing (ADR 0009, and an
   * earlier build had the two frames backwards) — so it must not make a sound. It
   * is informational and therefore silent: said on screen, nothing sounded, which
   * is the spec's one way for a reported outcome to have no signal. Reporting it
   * with the beep test's kind would chirp a "done" for a command that does not
   * chirp.
   */
  | "led-off";

/** Every discriminator, for the exhaustiveness tests and for documentation. */
export const ALL_OUTCOME_KINDS: readonly OutcomeKind[] = [
  "read",
  "read-incomplete",
  "nothing-latched",
  "saved",
  "already-saved",
  "verified",
  "blanked",
  "drafted",
  "erased",
  "data-cleared",
  "unverified",
  "refused",
  "failed",
  "skipped",
  "unreadable",
  "reset-refused",
  "refused-by-build",
  "reader-absent",
  "reader-gone",
  "reader-claimed",
  "reader-wedged",
  "reader-failure",
  "announcement",
  "beep-test",
  "led-off",
];

/**
 * The one table that decides severity. Changing a row moves every message and
 * every sound of that kind at once, and moves the tone the notice is drawn in with
 * them — which is the point: there is no call site, and no wording module, to hunt
 * down.
 */
const SEVERITY_OF: Record<OutcomeKind, Severity> = {
  read: "success",
  "read-incomplete": "warning",
  "nothing-latched": "info",
  saved: "success",
  "already-saved": "info",
  verified: "success",
  blanked: "success",
  drafted: "success",
  erased: "success",
  "data-cleared": "success",
  unverified: "warning",
  refused: "error",
  failed: "error",
  skipped: "error",
  unreadable: "error",
  "reset-refused": "error",
  "refused-by-build": "error",
  "reader-absent": "info",
  "reader-gone": "error",
  "reader-claimed": "error",
  "reader-wedged": "error",
  "reader-failure": "error",
  announcement: "info",
  "beep-test": "success",
  "led-off": "info",
};

/** The severity of one discriminator. */
export function severityOf(kind: OutcomeKind): Severity {
  return SEVERITY_OF[kind];
}

/**
 * The symbol a severity produces. This is the whole mapping, and it is one-way:
 * a success is one chirp, a warning is two, an error is three, and only an
 * informational outcome is silent. Four symbols, no fifth (ADR 0009).
 */
export function signalFor(severity: Severity): SignalSymbol {
  switch (severity) {
    case "success":
      return "done";
    case "warning":
      return "needs-you";
    case "error":
      return "attention";
    case "info":
      return "silent";
  }
}

/**
 * The tone a severity is drawn in.
 *
 * A tone is a severity seen by the interface, so it is derived here rather than
 * chosen at the site that draws the notice: that is what keeps an amber inline
 * notice from contradicting a three-chirp sound. `muted` is the informational ink
 * — the tone for "this is said, and it is not news".
 */
export function toneForSeverity(severity: Severity): NoticeTone {
  switch (severity) {
    case "success":
      return "ok";
    case "warning":
      return "warn";
    case "error":
      return "err";
    case "info":
      return "muted";
  }
}

/**
 * The discriminator a refusal gets from the condition the guard reported.
 *
 * `null` — no cause established — stays on the generic refusal, which is an
 * error: so does a cause the app has never heard of, because softening an
 * unknown refusal into a skip would tell the user the wrong Tag is the only
 * problem when nobody established that.
 */
export function refusalKind(cause: RefusalCause | null): OutcomeKind {
  if (cause === "already-carries") return "skipped";
  if (cause === "unreadable") return "unreadable";
  return "refused";
}

/**
 * The discriminator a 125 kHz copy write gets.
 *
 * `already-carries` is the guard's refusal and is named as a skip, with the same
 * severity a refusal has; `blanked` and `erased` are things a copy cannot do, so
 * they are reported as a failure rather than as a success nobody would believe.
 */
export function copyWriteKind(
  outcome: WriteOutcome,
  cause: RefusalCause | null,
): OutcomeKind {
  switch (outcome) {
    case "verified":
      return "verified";
    case "refused":
      return refusalKind(cause);
    case "unverified":
      return "unverified";
    case "failed":
    case "blanked":
    case "erased":
      return "failed";
  }
}

/**
 * The discriminator a whole-NDEF-message write gets. A Draft or a Snapshot write
 * cannot blank or erase a Tag, so either is a bug reported as a failure.
 */
export function ndefWriteKind(outcome: WriteOutcome): OutcomeKind {
  switch (outcome) {
    case "verified":
      return "verified";
    case "refused":
      return "refused";
    case "unverified":
      return "unverified";
    case "failed":
    case "blanked":
    case "erased":
      return "failed";
  }
}

/** The discriminator one Reset gets. `willNotAcceptWrites` is its own finding
 *  about the Tag (ADR 0007), not a failure of the attempt. */
export function blankKind(outcome: BlankResult["outcome"]): OutcomeKind {
  switch (outcome) {
    case "blanked":
      return "blanked";
    case "refused":
      return "refused";
    case "unverified":
      return "unverified";
    case "failed":
      return "failed";
    case "willNotAcceptWrites":
      return "reset-refused";
  }
}

/** The discriminator one NDEF erase gets. */
export function eraseKind(outcome: EraseResult["outcome"]): OutcomeKind {
  switch (outcome) {
    case "erased":
      return "erased";
    case "refused":
      return "refused";
    case "unverified":
      return "unverified";
    case "failed":
      return "failed";
  }
}

/**
 * The discriminator one batch attempt gets.
 *
 * The attempt's own vocabulary decides first, because `skipped` is the batch's
 * word for a Tag that already carries the Identity — the same condition the
 * single-clone guard learns only from the cause. A `refused` attempt is split by
 * its cause so an unreadable write position is named as one.
 */
export function attemptKind(result: BatchAttemptResult): OutcomeKind {
  const byOutcome: Record<BatchAttemptOutcome, OutcomeKind> = {
    verified: "verified",
    skipped: "skipped",
    unverified: "unverified",
    failed: "failed",
    refused: refusalKind(result.refusalCause),
  };
  return byOutcome[result.outcome];
}
