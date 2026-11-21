/**
 * The outcome seam: one typed value per operation, one entry point, two channels.
 *
 * Every operation the user starts ends in exactly one `Outcome`. It is handed to
 * `report`, which fans out to the visible message (the toast store) and to the
 * audible signal (`lib/signal`). Neither channel can be produced without the
 * other, and neither is reachable from a component: the factories below are the
 * only things that build the text, and the tables below are the only place a
 * severity is chosen (ADR 0008).
 *
 * Three properties this module is built to keep:
 *
 * 1. **The discriminator set is closed.** `OutcomeKind` is a small union derived
 *    from the write-outcome vocabulary this app already had (`WriteOutcome` plus
 *    the blanking and erasing results), the new Reset refusal, the Reader's own
 *    failures, and a build refusal. A new kind is a deliberate edit here, not a
 *    sentence invented at a call site.
 * 2. **Severity belongs to the outcome.** `SEVERITY_OF` maps each discriminator
 *    to one severity; the signal is derived from that severity by `signalFor`. So
 *    a message cannot be styled as a warning while it sounds like a failure.
 * 3. **Conditions are not outcomes.** A library file that cannot be written to, a
 *    migration warning, an invalid Record, a pending confirmation: those are
 *    states the user is in, they stay inline, and they have no kind here. An
 *    outcome is something that just happened.
 *
 * Background work — connecting, the firmware query, autosave, the poll loop's
 * iterations — reports nothing, by design. The rule is that an operation the user
 * starts ends in exactly one outcome; the compatibility chirp below is the one
 * marked exception, and it disappears in ticket 17.
 */

import type { BlankResult, BuildRefusal, EraseResult, WriteResult } from "../types";
import type { SaveResult } from "./library";
import { blankNotice } from "./blankTag";
import { describeClearReport, type ClearReport } from "./clearData";
import { BUILD_REFUSAL_DETAIL, BUILD_REFUSAL_LABEL } from "./consoleRefusal";
import { eraseNotice } from "./eraseTag";
import { QUIET_LEVEL_LABEL, type QuietLevel } from "./quietLevel";
import { classifyDeviceFailure, deviceFailureNotice } from "./readerIdentity";
import { emitSignal } from "./signal";
import { pushToast } from "./toastStore";
import { writeNotice } from "./writeOutcome";
import type { SignalSymbol } from "./signal";

/** How much attention one outcome deserves. Chosen by the kind, never by a caller. */
export type Severity = "info" | "success" | "warning" | "error";

/** The operation an outcome belongs to, so a later success can clear its error. */
export type OutcomeOperation =
  | "read"
  | "hf-read"
  | "library"
  | "write"
  | "reset"
  | "clone"
  | "batch"
  | "erase"
  | "console"
  | "reader"
  | "preferences";

/**
 * What an operation did, as a closed set.
 *
 * The first group is the write-outcome vocabulary the app already spoke; the
 * rest are the Reader's own failures, a refusal caused by the build rather than
 * the tag, and the one informational kind.
 */
export type OutcomeKind =
  /** A Tag was read; the read is the whole result. */
  | "read"
  /** A read that finished but whose result wants checking: it got part of what
   *  it went for, and says why the rest is missing. Distinct from `read` because
   *  the sound has to be (ADR 0009), and distinct from `failed` because something
   *  was obtained and is on screen. */
  | "read-incomplete"
  /** There was no Tag in the field. Nothing happened, and that is not an error. */
  | "nothing-latched"
  /** A read was kept in the library: the Snapshot is on disk. */
  | "saved"
  /**
   * The read was already in the library, so nothing was added. Informational
   * and silent: a repeat read is not a fault, and it did not change anything.
   * It is still said, because a save that vanishes without a word looks like a
   * save that failed.
   */
  | "already-saved"
  /** A write whose read-back proved it. */
  | "verified"
  /** A Reset that left no Identity on the Tag. */
  | "blanked"
  /** An erase that cleared the Tag's NDEF content. */
  | "erased"
  /** Saved data was cleared from this machine, by the one action allowed to.
   *  About this app's storage, never about a Tag: erasing a Tag is `erased`. */
  | "data-cleared"
  /** Sent, but the read-back could not confirm it. The Tag's state is unknown. */
  | "unverified"
  /** Stopped before anything was sent: the guard, the tag or the frame refused. */
  | "refused"
  /** Attempted and did not work. */
  | "failed"
  /** A Reset this Tag will not accept writes for; nothing changed. */
  | "reset-refused"
  /** Refused because the running build sends only non-changing commands. */
  | "refused-by-build"
  /** No Reader attached. */
  | "reader-absent"
  /** Another process holds the Reader. */
  | "reader-claimed"
  /** The Reader stopped answering until it is physically replugged. */
  | "reader-wedged"
  /** The Reader failed in a way none of the above name. */
  | "reader-failure"
  /** A stored preference changed. Informational: says something, sounds nothing. */
  | "announcement"
  /**
   * The beeper test was pressed in Settings. An operation the user started — it
   * sounds, and it says what was sent rather than what was heard.
   */
  | "beep-test";

/** Every discriminator, for the exhaustiveness tests and for documentation. */
export const ALL_OUTCOME_KINDS: readonly OutcomeKind[] = [
  "read",
  "read-incomplete",
  "nothing-latched",
  "saved",
  "already-saved",
  "verified",
  "blanked",
  "erased",
  "data-cleared",
  "unverified",
  "refused",
  "failed",
  "reset-refused",
  "refused-by-build",
  "reader-absent",
  "reader-claimed",
  "reader-wedged",
  "reader-failure",
  "announcement",
  "beep-test",
];

/**
 * The one table that decides severity. Changing a row moves every message of
 * that kind at once — which is the point: there is no call site to hunt down.
 */
const SEVERITY_OF: Record<OutcomeKind, Severity> = {
  read: "success",
  "read-incomplete": "warning",
  "nothing-latched": "info",
  saved: "success",
  "already-saved": "info",
  verified: "success",
  blanked: "success",
  erased: "success",
  "data-cleared": "success",
  unverified: "warning",
  refused: "error",
  failed: "error",
  "reset-refused": "error",
  "refused-by-build": "error",
  "reader-absent": "warning",
  "reader-claimed": "error",
  "reader-wedged": "warning",
  "reader-failure": "error",
  announcement: "info",
  "beep-test": "success",
};

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
  /** Derived from `kind` by `SEVERITY_OF`; never passed in by a caller. */
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

/** The severity of one discriminator. */
export function severityOf(kind: OutcomeKind): Severity {
  return SEVERITY_OF[kind];
}

/**
 * The symbol a severity produces. This is the whole mapping, and it is one-way:
 * a success is one chirp, a warning is two, an error is three, and only an
 * informational outcome is silent.
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
  return { kind, operation, severity: SEVERITY_OF[kind], message, ...rest };
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
 * Compatibility: one `done` signal for a call site that still calls the pre-seam
 * `chirp()` helper.
 *
 * Those call sites have no outcome to describe yet — the pages are rewired in
 * tickets 11–16 — so this raises a sound and no message, and the toast half stays
 * exactly as silent as it is today. It is the only signal emitted without an
 * outcome, it exists so nothing regresses audibly in the meantime, and ticket 17
 * deletes it along with the `onChirp` props that carry it.
 */
export function legacyChirp(): void {
  emitSignal(signalFor("success"));
}

/** Everything a caller may need to describe what an operation did. */
export const outcomes = {
  /** A Tag was read and the read is the result: `Read 55 00 84 82 12.` */
  tagRead(operation: "read" | "hf-read", identity: string): Outcome {
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
  nothingLatched(operation: "read" | "hf-read"): Outcome {
    return make(
      "nothing-latched",
      operation,
      "No tag in the field.",
      { detail: "Hold a tag against the Reader and try again." },
    );
  },

  /**
   * What became of one write, in the words the write path already had. The
   * wording is not re-invented here: `writeNotice` owns it, so the inline notice
   * and the toast cannot drift apart.
   *
   * A copy write that reports `blanked` or `erased` is a bug, not a result — it
   * places no copy — so it is reported as a failure rather than as success.
   */
  write(operation: "write" | "clone" | "batch", result: WriteResult): Outcome {
    const kind: Record<WriteResult["outcome"], OutcomeKind> = {
      verified: "verified",
      refused: "refused",
      unverified: "unverified",
      failed: "failed",
      blanked: "failed",
      erased: "failed",
    };
    return make(kind[result.outcome], operation, writeNotice(result).text);
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

  /** What became of one Reset, in the blanking copy's own words. */
  blank(result: BlankResult): Outcome {
    const kind: Record<BlankResult["outcome"], OutcomeKind> = {
      blanked: "blanked",
      refused: "refused",
      unverified: "unverified",
      failed: "failed",
    };
    return make(kind[result.outcome], "reset", blankNotice(result).text);
  },

  /** What became of one NDEF erase, in the erasing copy's own words. */
  erase(result: EraseResult): Outcome {
    const kind: Record<EraseResult["outcome"], OutcomeKind> = {
      erased: "erased",
      refused: "refused",
      unverified: "unverified",
      failed: "failed",
    };
    return make(kind[result.outcome], "erase", eraseNotice(result).text);
  },

  /**
   * A Reset this Tag would not accept. Its own outcome rather than a write
   * failure, because what it says is specific and the remedy is not "try again":
   * the first write is the test, and this Reader cannot tell which tags will
   * refuse one (ADR 0007, and `lib/blankTag.ts` for why no check is offered).
   */
  resetRefused(cause: string): Outcome {
    return make(
      "reset-refused",
      "reset",
      "This tag will not accept writes.",
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
   * The Reader itself failed. The classification decides the kind, so the
   * severity and the remedy come from the same answer: an unplugged Reader is a
   * warning with the plug-in remedy, a Reader held by another process is an error
   * telling you to close it.
   *
   * The shell used to render this as a strip that pushed the page down; it now
   * arrives here, carrying the reconnect action the strip offered.
   */
  readerFailure(
    raw: unknown,
    extra: { action?: OutcomeAction; onDismiss?: () => void } = {},
  ): Outcome {
    const text =
      raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw ?? "");
    const failure = classifyDeviceFailure(text);
    if (failure === "unknown") {
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
    const notice = deviceFailureNotice(failure);
    const kind: Record<"absent" | "claimed" | "wedged", OutcomeKind> = {
      absent: "reader-absent",
      claimed: "reader-claimed",
      wedged: "reader-wedged",
    };
    return make(kind[failure], "reader", notice.title, {
      detail: notice.detail,
      ...extra,
    });
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
      notice.tone === "ok" ? "data-cleared" : notice.tone === "info" ? "announcement" : "refused";
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
