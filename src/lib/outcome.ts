/**
 * The outcome seam: one typed value per operation, one entry point, two channels.
 *
 * Every operation the user starts ends in exactly one `Outcome`. It is handed to
 * `report`, which fans out to the visible message (the toast store) and to the
 * audible signal (`lib/signal`). Neither channel can be produced without the
 * other, and neither is reachable from a component: the factories below are the
 * only things that build the text, and the severity each kind carries is looked up
 * in `lib/severity` rather than decided here or at a call site (ADR 0008).
 *
 * Three properties this module is built to keep:
 *
 * 1. **The discriminator set is closed.** `OutcomeKind` is a small union derived
 *    from the write-outcome vocabulary this app already had (`WriteOutcome` plus
 *    the blanking and erasing results), the two conditions ADR 0001 can refuse a
 *    write on, the new Reset refusal, the Reader's own failures, and a build
 *    refusal. A new kind is a deliberate edit here, not a sentence invented at a
 *    call site.
 * 2. **Severity belongs to the outcome.** One table (`lib/severity`) maps each
 *    discriminator to one severity; the signal and the tone are both derived from
 *    that severity. So a message cannot be styled as a warning while it sounds
 *    like a failure — and the wording modules, which draw a notice beside the
 *    result, read the same table instead of choosing a severity of their own.
 * 3. **Conditions are not outcomes.** A library file that cannot be written to, a
 *    migration warning, an invalid Record, a pending confirmation: those are
 *    states the user is in, they stay inline, and they have no kind here. An
 *    outcome is something that just happened.
 *
 *    That is also why a condition may carry a tone of its own without going
 *    through this seam: a confirmation waiting on a decision has no result to read
 *    a severity from, so the module that owns the condition picks the ink it is
 *    drawn in (`ReplacementConfirmation.replacementTone`, `lib/password.ts`'s
 *    `noticeTone`). What such a tone may not do is *describe* itself as an
 *    outcome: it is presentation for a condition, it produces no toast and no
 *    sound, and nothing in this module's vocabulary is involved.
 *
 * Background work — connecting, the firmware query, autosave, the poll loop's
 * iterations — reports nothing, by design. The rule is that an operation the user
 * starts ends in exactly one outcome, and `report` is the only way to say one.
 */

import type {
  BatchAttemptResult,
  BuildRefusal,
  ClearResult,
  EraseResult,
  TagOperation,
  WriteResult,
} from "../types";
import type { SaveResult } from "./library";
import { attemptNotice } from "./batchClone";
import {
  ALL_OUTCOME_KINDS,
  attemptKind,
  clearKind,
  copyWriteKind,
  eraseKind,
  ndefWriteKind,
  severityOf,
  signalFor,
  toneForSeverity,
  type OutcomeKind,
  type Severity,
} from "./severity";
import {
  reportsOtherOperation,
  tagOperationNotice,
  WILL_NOT_ACCEPT_WRITES,
} from "./clearTag";
import { describeClearReport, type ClearReport } from "./clearData";
import { BUILD_REFUSAL_DETAIL, BUILD_REFUSAL_LABEL } from "./consoleRefusal";
import { eraseNotice } from "./eraseTag";
import { QUIET_LEVEL_LABEL, type QuietLevel } from "./quietLevel";
import {
  classifyDeviceFailure,
  deviceFailureNotice,
  type DeviceFailure,
} from "./readerIdentity";
import { emitSignal } from "./signal";
import { writeNotice as ndefWriteNotice, type NdefWriteResult } from "./tagWrite";
import { pushToast } from "./toastStore";
import { refusalCauseOf, writeNotice } from "./writeOutcome";
import type { SignalSymbol } from "./signal";

// The discriminator set and the severity tables are re-exported from the one
// module that holds them, so nothing imports a second copy: `lib/severity`.
export { ALL_OUTCOME_KINDS, severityOf, signalFor, toneForSeverity };
export type { OutcomeKind, Severity };

/** The operation an outcome belongs to, so a later success can clear its error. */
export type OutcomeOperation =
  | "read"
  | "hf-read"
  | "library"
  | "write"
  | "copy"
  | "clear"
  | "clone"
  | "batch"
  | "erase"
  /** Turning a reading's message into a Draft: this machine's own file, never a
   *  Tag. */
  | "draft"
  | "console"
  | "reader"
  | "preferences";

/**
 * Every operation, for the enumeration test and for documentation.
 *
 * `src/reporting.test.tsx` drives one real operation per entry and fails when one
 * of them reports nothing. That is what makes coverage a property of the
 * structure: adding an operation means adding it here, and adding it here fails
 * until something reports it.
 */
export const ALL_OUTCOME_OPERATIONS: readonly OutcomeOperation[] = [
  "read",
  "hf-read",
  "library",
  "write",
  "copy",
  "clear",
  "clone",
  "batch",
  "erase",
  "draft",
  "console",
  "reader",
  "preferences",
];

/** A control a message can offer: reconnect the Reader, and so on. */
export interface OutcomeAction {
  /** The button's words. */
  readonly label: string;
  readonly run: () => void;
}

/** One operation's result, as both channels receive it. */
export interface Outcome {
  readonly kind: OutcomeKind;
  readonly operation: OutcomeOperation;
  /** Derived from `kind` by `lib/severity`'s table; never passed in by a caller. */
  readonly severity: Severity;
  readonly message: string;
  readonly detail?: string;
  readonly action?: OutcomeAction;
  /**
   * Called once when the message leaves the screen — dismissed, timed out, or
   * cleared by a later success. Lets the shell clear the state the message was
   * standing in for, without the message owning that state.
   */
  readonly onDismiss?: () => void;
}

/** The signal one outcome produces, derived from its severity alone. */
export function signalOf(outcome: Outcome): SignalSymbol {
  return signalFor(outcome.severity);
}

/**
 * Build an outcome. The severity is read from the table rather than accepted, so
 * no factory can hand a warning the sound of a failure.
 */
function make(
  kind: OutcomeKind,
  operation: OutcomeOperation,
  message: string,
  rest: Omit<Partial<Outcome>, "kind" | "operation" | "severity" | "message"> = {},
): Outcome {
  return { kind, operation, severity: severityOf(kind), message, ...rest };
}

/**
 * The one entry point.
 *
 * Both channels are fed from here and from nowhere else: the message always, the
 * signal unless the severity is informational. A beep failure is swallowed by the
 * subscriber, so a signal can never turn a success into an error.
 */
export function report(outcome: Outcome): void {
  pushToast(outcome);
  emitSignal(signalOf(outcome));
}

/**
 * A hardware failure, with the one row that depends on when it was seen.
 *
 * `absentKind` is the whole difference between the two callers: `readerState` is
 * asked at rest and calls an absent Reader a silent state, `readerFailure` is
 * asked by an operation and calls the same absence a lost operation. Everything
 * else — the classification, the remedy, the wording of the other three rows — is
 * shared, so the two can never drift into two different accounts of one Reader.
 */
function deviceOutcome(
  raw: unknown,
  extra: { action?: OutcomeAction; onDismiss?: () => void },
  absentKind: "reader-absent" | "reader-gone",
): Outcome {
  const text =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw ?? "");
  const classified = classifyDeviceFailure(text);
  if (classified === "unknown") {
    // An ordinary failure keeps its own words: rewriting it as a hardware fault
    // would name a cause nobody established.
    const trimmed = text.trim();
    return make(
      "reader-failure",
      "reader",
      trimmed === "" ? "The operation failed." : trimmed,
      extra,
    );
  }
  const failure: DeviceFailure =
    classified === "absent" && absentKind === "reader-gone" ? "gone" : classified;
  const notice = deviceFailureNotice(failure);
  const kind: Record<DeviceFailure, OutcomeKind | null> = {
    absent: "reader-absent",
    gone: "reader-gone",
    claimed: "reader-claimed",
    wedged: "reader-wedged",
    unknown: null,
  };
  return make(kind[failure] ?? "reader-failure", "reader", notice.title, {
    detail: notice.detail,
    ...extra,
  });
}

/** Everything a caller may need to describe what an operation did. */
export const outcomes = {
  /** A Tag was read and the read is the result: `Read 55 00 84 82 12.` */
  tagRead(operation: "read" | "hf-read" | "clear", identity: string): Outcome {
    return make("read", operation, `Read ${identity}.`);
  },

  /**
   * A 13.56 MHz read that fetched everything it went for: the identity and,
   * where the family can hold one, the message.
   *
   * `held` says what the message half turned out to be, because that answer is
   * part of the complete read rather than a caveat: "2 Records", "an empty
   * message", "no NFC Forum tag type". It is written by `lib/hfRead.ts` from the
   * same value the readout renders, so the message and the screen cannot say
   * different things.
   */
  hfRead(identity: string, held: string): Outcome {
    return make("read", "hf-read", `Read ${identity} — ${held}.`);
  },

  /**
   * A 13.56 MHz read that finished but wants checking: the poll decoded and the
   * message half did not come back, or came back in a shape this build cannot
   * read. It is a warning rather than a failure because the identity it did get
   * is on screen — and rather than a success because the Records are not.
   *
   * `identity` is null when the poll itself is what could not be read; the line
   * then says that rather than pretending a UID. `reason` is kept as the detail,
   * because it is the part a user needs to act on and it must survive from the
   * failure that produced it.
   */
  hfReadIncomplete(identity: string | null, reason: string): Outcome {
    const message =
      identity === null
        ? "The poll reply could not be decoded."
        : `Read ${identity}, but its Records could not be read.`;
    return make("read-incomplete", "hf-read", message, { detail: reason });
  },

  /**
   * The field was empty. Silent, and still on screen: silence means nothing
   * happened, not that the app has nothing to say (ADR 0009).
   */
  nothingLatched(operation: "read" | "hf-read" | "copy", detail?: string): Outcome {
    return make(
      "nothing-latched",
      operation,
      "No tag in the field.",
      { detail: detail ?? "Hold a tag against the Reader and try again." },
    );
  },

  /**
   * What became of one write, in the words the write path already had. The
   * wording is not re-invented here: `writeNotice` owns it, so the inline notice
   * and the toast cannot drift apart.
   *
   * A refusal is split by the condition the guard reported, never by what the
   * message happens to say: `unreadable` is an error (seat a Tag that reads) and
   * `already-carries` is a skip (this is the wrong Tag). A refusal whose cause
   * nobody established keeps the generic kind, because the fail-safe direction is
   * the error rather than the milder skip.
   *
   * A copy write that reports `cleared`, `destroyed` or `erased` is a bug, not a
   * result — it places no copy — so it is reported as a failure rather than as
   * success.
   */
  write(operation: "write" | "clone" | "batch", result: WriteResult): Outcome {
    const kind = copyWriteKind(result.outcome, refusalCauseOf(result));
    return make(kind, operation, writeNotice(result).text);
  },

  /**
   * The wizard read the original Tag: the read is the whole result.
   *
   * The reads belong to the Clone rather than to a plain Read because they are
   * the two things the wizard waits for. A flow that reported nothing until the
   * write would leave both taps silent, and the wait indistinguishable from a
   * hang.
   */
  cloneSourceRead(identity: string): Outcome {
    return make("read", "clone", `Read ${identity} — the original.`);
  },

  /**
   * The wizard read the Tag in the write position. The same read that fills the
   * confirmation, reported on its own: it is the second thing the wizard waits
   * for, and what it read is on screen beneath the message.
   */
  cloneDestinationRead(identity: string): Outcome {
    return make("read", "clone", `Read ${identity} — the tag in the write position.`);
  },

  /**
   * The wizard read the original back: it is still on the Reader, so there is
   * nothing in the write position to write to.
   *
   * This is the condition the guard refuses a write on, caught at the read
   * instead of at the write — so it is the same outcome kind and the same sound
   * (attention: a refusal is three chirps, spec's alphabet table), and the remedy
   * is the same one: take the original off, put the blank on. Nothing was sent,
   * so nothing is counted.
   */
  cloneSourceStillInPlace(identity: string): Outcome {
    return make(
      "skipped",
      "clone",
      `Skipped: the tag on the reader is still the original, ${identity}.`,
      {
        detail:
          "That tag already carries the identity being written, so a write to it would be " +
          "refused. Take it off the reader and tap the blank you want to write. Nothing was " +
          "written and no copy was counted.",
      },
    );
  },

  /**
   * One Batch Clone attempt, reported on its own.
   *
   * A run is a list of these, never one verdict for the whole run: a skip, a
   * refusal, an unknown result and a verified write are different things to hear,
   * and an aggregate "the batch worked" would bury whichever of them came back.
   * The words are the batch's own (`attemptNotice`), so the ledger and the message
   * cannot disagree about what one attempt came to.
   */
  batchAttempt(result: BatchAttemptResult): Outcome {
    return make(attemptKind(result), "batch", attemptNotice(result).text);
  },

  /**
   * What keeping a read in the library came to, in the words both the readout
   * and the Library show. The store answered with what it did — added, already
   * there, or refused with the file's own problem — so a repeat read and an
   * unwritable file cannot look like the same silence.
   *
   * A duplicate is informational rather than a fault: nothing failed, and
   * nothing was added twice.
   */
  librarySaved(result: SaveResult): Outcome {
    if (result.outcome === "refused") {
      return make(
        "refused",
        "library",
        result.library.problem?.message ?? "The library could not be saved.",
      );
    }
    const name = result.snapshot?.name ?? "the read";
    if (result.outcome === "duplicate") {
      return make("already-saved", "library", `Already in the library as ${name}.`);
    }
    return make("saved", "library", `Saved to the library as ${name}.`);
  },

  /**
   * A save that never reached the store — the call itself failed, so nothing is
   * known about the file. Its own words are kept as the detail rather than
   * summarised into a cause nobody established.
   */
  librarySaveFailed(detail: string): Outcome {
    const trimmed = detail.trim();
    return make(
      "failed",
      "library",
      "The read could not be saved to the library.",
      trimmed === "" ? {} : { detail: trimmed },
    );
  },
  /**
   * What became of one Clear, or one Destroy, in that operation's own words.
   *
   * The operation the user chose is passed in rather than read off the result, so a
   * result that echoes the other one is a reported mismatch instead of a plausible
   * message: `tagOperationNotice` refuses to word a destruction as a clear.
   *
   * A tag that did not take the write is `clear-refused`: not `failed` (which says
   * the attempt is the problem) and not `unverified` (which says nothing is known) —
   * the state of the tag is known, and it is the useful finding (ADR 0007).
   * `clearKind` is the one place the severity comes from, so a destroy the user
   * asked for is never drawn as a failure.
   */
  clear(operation: TagOperation, result: ClearResult): Outcome {
    // A result for the other operation is a refusal, not a completion: the message
    // says so, and the severity has to agree with it.
    const kind = reportsOtherOperation(operation, result)
      ? "refused"
      : clearKind(result.outcome);
    return make(kind, "clear", tagOperationNotice(operation, result).text);
  },

  /** What became of one NDEF erase, in the erasing copy's own words. */
  erase(result: EraseResult): Outcome {
    return make(eraseKind(result.outcome), "erase", eraseNotice(result).text);
  },

  /**
   * What became of one 13.56 MHz write: a whole NDEF message put on a Tag,
   * whether those Records came from a Draft or from a Snapshot.
   *
   * The words are `lib/tagWrite`'s, because that module already words the notice
   * beside the result: the line on the page and the message in the corner come
   * from one sentence rather than two that can drift. `cleared`, `destroyed` and
   * `erased` are things writing a message cannot do, so a backend reporting any of
   * them is a bug and is reported as a failure rather than as a success nobody
   * would believe.
   */
  ndefWrite(result: NdefWriteResult): Outcome {
    return make(ndefWriteKind(result.outcome), "write", ndefWriteNotice(result).text);
  },

  /**
   * What became of one Copy — a whole NDEF message moved onto another Tag.
   *
   * The words are decided by `lib/hfCopy.ts`'s guard, which is the one place that
   * knows which condition fired and how the read-back compared; this factory only
   * turns its decision into the outcome that both channels read. Copy is its own
   * operation and its own name: it is verified by comparing a whole message, never
   * by comparing an Identity, so it is never a Clone.
   *
   * `verified` is one `done` chirp, `unverified` is `needs-you`, and a refusal is
   * `attention` — the severity table decides that, not a call site.
   */
  copy(
    kind: "verified" | "unverified" | "refused" | "failed",
    message: string,
    detail?: string,
  ): Outcome {
    return make(kind, "copy", message, detail === undefined ? {} : { detail });
  },

  /**
   * A reading's message became a Draft.
   *
   * Its own kind rather than `announcement`, which is silent, and rather than
   * `read`, because nothing was read here: this is what happened to a read that
   * already had. It is not a write outcome either — the Draft is this machine's
   * own file and no Tag was touched, which the detail says in words so the one
   * thing a user could fear is answered.
   *
   * `identity` is the UID the poll reported, and `records` is the count the
   * readout is showing, so the message and the screen cannot disagree.
   */
  draftedFromRead(identity: string, records: number): Outcome {
    return make(
      "drafted",
      "draft",
      `Draft created from ${identity} — ${records} ${records === 1 ? "Record" : "Records"}.`,
      {
        detail:
          "It is open in Library's Drafts collection, ready to edit. The Tag it was read " +
          "from was not written to.",
      },
    );
  },

  /**
   * Turning a readout into a Draft failed: the library file would not take it.
   *
   * An error rather than a warning, because nothing was created — but a failure
   * about this machine, so the detail says where the Records still are instead of
   * leaving the user wondering whether the press damaged anything.
   */
  draftNotCreated(): Outcome {
    return make("failed", "draft", "The Draft was not created.", {
      detail:
        "The library file could not be written to, so nothing was saved. Nothing was written " +
        "to the Tag either: its Records are still on the Tag, and still on screen.",
    });
  },

  /**
   * A Clear or Destroy this Tag would not accept. Its own outcome rather than a
   * write failure, because what it says is specific and the remedy is not "try
   * again": the first write is the test, and this Reader cannot tell which tags
   * will refuse one (ADR 0007, and `lib/clearTag.ts` for why no check is offered).
   */
  clearRefused(cause: string): Outcome {
    return make(
      "clear-refused",
      "clear",
      WILL_NOT_ACCEPT_WRITES,
      {
        detail:
          `${cause} A tag already written once may permanently refuse further writes, and ` +
          "this Reader cannot tell which kind it is. Nothing was written.",
      },
    );
  },

  /**
   * A frame the running build declined to send. About the build, never about the
   * tag — the refusal is a tagged value from the backend, not prose
   * (`lib/consoleRefusal.ts`).
   */
  refusedByBuild(refusal: BuildRefusal): Outcome {
    return make(
      "refused-by-build",
      "console",
      `${BUILD_REFUSAL_LABEL}: ${refusal.cmd} was not sent.`,
      { detail: BUILD_REFUSAL_DETAIL },
    );
  },

  /**
   * A frame the Reader or the guard refused. About the frame or the Tag in
   * position, and deliberately worded so it cannot be mistaken for a build
   * refusal: one says to change what you are sending, the other to reseat or
   * replace the tag.
   */
  refusedByReader(message: string): Outcome {
    return make(
      "refused",
      "console",
      `Not sent: ${message}`,
      {
        detail:
          "This is about the tag in position or the frame you typed, not about the build you are running.",
      },
    );
  },

  /**
   * The Reader's own condition, read **at rest**: at launch, or when the user
   * presses Connect/Reconnect. Not the result of an operation, so its silent
   * state is honest — nothing was asked of the Reader and nothing happened.
   *
   * The absence that arrives *during* an operation is `readerFailure`, not this.
   */
  readerState(
    raw: unknown,
    extra: { action?: OutcomeAction; onDismiss?: () => void } = {},
  ): Outcome {
    return deviceOutcome(raw, extra, "reader-absent");
  },

  /**
   * The Reader itself failed **an operation**. The classification decides the
   * kind, so the severity and the remedy come from the same answer: a Reader held
   * by another process is an error telling you to close it; a Reader that stopped
   * answering is attention, because it is present and broken and only a replug
   * clears it; and a Reader that is not there at all is attention here, because
   * the operation it was in the middle of did not complete.
   *
   * That last row is the distinction this seam has to keep: "no Reader attached"
   * at rest is a state and is silent (`readerState`), while the same message
   * arriving from a running operation is an event that lost the operation and must
   * not be drawn in the quiet tone. The two sound different because they are not
   * the same thing, and the caller knows which it is: this factory reports an
   * operation, so the worst reading is the right one.
   *
   * The shell used to render this as a strip that pushed the page down; it now
   * arrives here, carrying the reconnect action the strip offered.
   */
  readerFailure(
    raw: unknown,
    extra: { action?: OutcomeAction; onDismiss?: () => void } = {},
  ): Outcome {
    return deviceOutcome(raw, extra, "reader-gone");
  },

  /**
   * Something about the app's own settings changed. Visible, and silent: it is
   * not the result of an operation, so it neither chirps nor means "nothing
   * happened".
   */
  announcement(message: string, detail?: string): Outcome {
    return make("announcement", "preferences", message, detail === undefined ? {} : { detail });
  },

  /**
   * What clearing every saved thing came to, in the words the Settings page
   * shows. One report, one sentence source: the inline block and the message
   * cannot tell the user different things about the same action.
   *
   * The kind follows the report's tone rather than being chosen here: a clear is
   * a success, "there was nothing saved" is informational and silent, and a
   * refusal is an error that names the part it could not remove.
   */
  dataCleared(report: ClearReport): Outcome {
    const notice = describeClearReport(report);
    const kind: OutcomeKind =
      notice.tone === "ok"
        ? "data-cleared"
        : notice.tone === "muted"
          ? "announcement"
          : "refused";
    return make(kind, "preferences", notice.title, { detail: notice.detail });
  },

  /**
   * The beeper test in Settings: the one sound the app can make on request
   * without an operation behind it.
   *
   * It is an outcome rather than a bare `beep` command because the audible
   * channel is reachable only through this seam (ADR 0008), and because the test
   * a user wants is of the whole path — the quiet level included — not of the
   * wire. That is why the two outcomes below it exist: the same press reports
   * differently with no Reader attached, and at a level that plays no completed
   * chirp. Diagnostics keeps the frame-level probe.
   *
   * The message states what was **sent**, never what was heard: the beep frame is
   * fire-and-forget, so the app must not claim the buzzer sounded.
   */
  beepTest(): Outcome {
    return make("beep-test", "preferences", "Signal sent.", {
      detail:
        "The same signal a completed operation makes. The firmware never confirms that " +
        "the buzzer sounded.",
    });
  },

  /**
   * The LED-off frame was sent: Settings → Diagnostics' second actuator.
   *
   * The same rule as the beeper test — the operation reports itself through the
   * seam rather than setting a line of local state, so a success and a failure are
   * two different results instead of one string — with one difference that is the
   * point: `0x0055` is not a beep, so this outcome is silent. The message says
   * which frame was sent, never what was seen; the firmware acknowledges neither.
   *
   * A failure is not this factory: a frame that could not be sent is
   * `readerFailure`, because that is what went wrong.
   */
  ledOff(): Outcome {
    return make("led-off", "preferences", "LED off sent.", {
      detail:
        "0x0055 releases the LED. It is the LED-off frame, not a beep: nothing chirped, " +
        "and the firmware confirms neither frame.",
    });
  },

  /**
   * The beeper test with no Reader attached.
   *
   * Its own outcome rather than the success above, because the two are not the
   * same event: one sent a frame, the other sent nothing. It says that nothing
   * was sent and stops there — the app never claims a chirp was heard, and it
   * cannot claim to have tried when there is nothing to try on.
   */
  beepTestNoReader(): Outcome {
    return make(
      "reader-absent",
      "preferences",
      "No signal was sent.",
      {
        detail:
          "The beeper test needs the Reader attached, and none is. Connect the Reader and " +
          "press it again; nothing was sent to anything.",
      },
    );
  },

  /**
   * The beeper test at a quiet level that plays no completed-operation chirp.
   *
   * Visible and silent: the level did what it was told, so there is a message to
   * read and no sound to hear. Reporting it as `beep-test` instead would say a
   * signal was sent when the preference had just declined to send one.
   */
  beepTestMuted(level: QuietLevel): Outcome {
    return make("announcement", "preferences", "No signal was sent.", {
      detail:
        `The quiet level is ${QUIET_LEVEL_LABEL[level]}, which does not play a completed ` +
        "operation's chirp. Set it to All and press the test again to hear it.",
    });
  },
};
