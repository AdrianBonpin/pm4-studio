/**
 * **Clear** and **Destroy**: the two operations that overwrite a Tag's Identity,
 * the confirmations the user reads, and the wording of what came of each.
 *
 * One page mode, two operations, and they are genuinely different things:
 *
 *   * **Clear** is the everyday one. It writes a non-zero *placeholder* Identity,
 *     so the tag stops being a working credential while staying a live, rewritable
 *     chip. "This tag should stop opening the door and I want it back" is the
 *     common case, and Clear is that case.
 *   * **Destroy** is the deliberate, destructive one. It writes the all-zero
 *     Identity, which on a T5577 stops the tag presenting an Identity while the
 *     chip keeps answering every reader, and permanently refuses further data.
 *     "This tag must never open anything again" is rare, and it costs the tag.
 *
 * The destructive one used to be the only one, presented as the routine one, and
 * that is how three tags were consumed. So Destroy is not the default, it is not
 * reachable by repeating Clear, and its confirmation states that it permanently
 * disables the tag rather than that it "may refuse further writes".
 *
 * # Where the placeholder value lives
 *
 * The value is defined once, in `src-tauri/src/identity.rs`
 * (`Identity::CLEARED`), with the reasoning that chose it. Nothing here repeats
 * the number: the interface shows the Identity the backend reports for
 * `presents`, so the value and its explanation cannot drift apart.
 *
 * # Vocabulary
 *
 * "Blank" is not a verb here, and not a word the user reads at all in this panel.
 * It survives only as the noun for a Tag that carries no Identity, which Clone and
 * Batch write onto (GLOSSARY). "Reset" is retired from this operation entirely: it
 * is the word that suggested a factory restore the hardware cannot perform, so the
 * operation is named for what it does. The wire values are `clear`, `destroy`,
 * `cleared` and `destroyed` — interface copy and wire vocabulary use the same words
 * because they now mean the same thing.
 *
 * What neither operation can do — restore a factory configuration, or unlock a
 * locked chip — is stated once, where this Reader's every other limit is stated:
 * `READER_CAPABILITY_LIMITS`' *Factory restore and unlock* entry. No paragraph here
 * repeats it, and no word here implies it.
 */

import type { ClearResult, TagOperation } from "../types";
import { clearKind, severityOf, toneForSeverity } from "./severity";
import type { WriteNotice } from "./writeOutcome";

/** The operation's own name, as the mode switch, the panel and its buttons say it. */
export const TAG_OPERATION_LABEL: Record<TagOperation, string> = {
  clear: "Clear",
  destroy: "Destroy",
};

/** The panel's heading. The mode pill in `lib/lfModes` says the same word. */
export const CLEAR_PANEL_TITLE = "Clear a tag";

/** The line under the heading: what Clear does, with no factory-restore denial. */
export const CLEAR_PANEL_HINT =
  "Overwrite a Tag's Identity with a placeholder, so the tag stops working as a credential and stays a tag you can write again.";

/** The control that starts the flow. */
export const CLEAR_READ_CONTROL = "Read the tag to clear";

/** The control that starts over once an attempt is done. */
export const CLEAR_ANOTHER_CONTROL = "Clear another tag";

/** The same control after a Destroy, which does not offer a clear as its repeat. */
export const DESTROY_ANOTHER_CONTROL = "Destroy another tag";

/** The control that performs the Clear, once its confirmation is on screen. */
export const CLEAR_ACTION_LABEL = "Clear this tag";

/**
 * The heading over Destroy's separate control, on the panel's first screen.
 *
 * Destroy is not a second button on Clear's confirmation: it is its own entry
 * point, its own read, and its own confirmation. A user clearing tags all day
 * cannot arrive at it by repeating the everyday action.
 */
export const DESTROY_PANEL_TITLE = "Destroy a tag";

/** What Destroy does, said plainly where it is offered. */
export const DESTROY_PANEL_HINT =
  "Permanently disables a tag. A destroyed tag still answers every reader and will never accept data again.";

/** The low-emphasis control that enters Destroy's own flow. */
export const DESTROY_ENTER_CONTROL = "Destroy a tag instead";

/** The control that performs Destroy, on its own confirmation. */
export const DESTROY_ACTION_LABEL = "Destroy this tag permanently";

/** One fact the user must read before a write is offered. */
export interface TagFact {
  readonly title: string;
  readonly detail: string;
}

/** A confirmation, ready to render. */
export interface TagConfirmation {
  /** The Identity that will be overwritten, as the user saw it read. */
  readonly identity: string;
  /** Heading: names the Identity and the action. */
  readonly title: string;
  readonly action: string;
  readonly facts: readonly TagFact[];
}

/**
 * The facts Clear's confirmation states — each one a consequence the user cannot
 * discover afterwards without having lost the value on the tag.
 */
export const CLEAR_FACTS: readonly TagFact[] = [
  {
    title: "The Identity it carries now is overwritten for good",
    detail:
      "The value read above cannot be recovered from the tag afterwards. Keep it as a Snapshot in the library first if you need the number.",
  },
  {
    title: "The tag stops being a credential",
    detail:
      "It is given a placeholder Identity that no building system issues, so it will not open anything on its own.",
  },
  {
    title: "The tag stays a tag, and stays writable here",
    detail:
      "Clearing leaves a live tag that still reads, so it can be written again from this app: clone an Identity onto it, or author one. Whether that next write is accepted is the tag's answer, as it is for any write.",
  },
  {
    title: "This Reader cannot tell whether a tag will accept a write",
    detail:
      "A 125 kHz reply carries no tag family and no writability flag, and there is no command that asks a tag whether it will take a write. Every command that would answer the question is itself a write, so no check exists — not in this app, and not in this protocol.",
  },
  {
    title: "A tag already written once may refuse forever",
    detail:
      "A T5577 that has already been written may permanently refuse every later write while still reading back the Identity it carries. This Reader cannot tell a tag that will refuse from one that will accept.",
  },
];

/**
 * The facts Destroy's confirmation states.
 *
 * These are starker than Clear's on purpose, and the first one is the whole point:
 * Destroy does not "may" anything. It permanently disables the tag, and every
 * T5577 this project has written with this payload has stopped accepting data.
 */
export const DESTROY_FACTS: readonly TagFact[] = [
  {
    title: "This permanently disables the tag",
    detail:
      "The tag will never accept data again. This is not a caution about a possible outcome: every tag this app has written this way has permanently refused every later write, and nothing in this app can undo it.",
  },
  {
    title: "It cannot be recovered or reused",
    detail:
      "There is no factory restore and no unlock in this protocol. The tag cannot be written again — not by a Clone, not by an authored Identity, and not by running this again.",
  },
  {
    title: "Every reader will still see it",
    detail:
      "A destroyed tag keeps answering readers while it refuses all data. Reading it back and getting a reply therefore does not mean it still works.",
  },
  {
    title: "Only use this on a tag you are finished with",
    detail:
      "Clear is the operation for a tag you want back. Destroy is the one for a tag you want gone, and it takes the tag with it.",
  },
];

/**
 * Build Clear's confirmation for one read Identity.
 *
 * It takes the Identity text rather than a card so the caller cannot accidentally
 * confirm something it did not read: the tag is named in the heading, and the same
 * Identity is handed to the write so the guard can refuse if the tag on the Reader
 * is a different one.
 */
export function clearConfirmation(identity: string): TagConfirmation {
  return {
    identity,
    title: `Clear the tag holding ${identity}?`,
    action: CLEAR_ACTION_LABEL,
    facts: CLEAR_FACTS,
  };
}

/** Build Destroy's confirmation. Its own heading, its own action, its own facts. */
export function destroyConfirmation(identity: string): TagConfirmation {
  return {
    identity,
    title: `Permanently destroy the tag holding ${identity}?`,
    action: DESTROY_ACTION_LABEL,
    facts: DESTROY_FACTS,
  };
}

/** The confirmation for whichever operation the user chose. */
export function tagConfirmation(
  operation: TagOperation,
  identity: string,
): TagConfirmation {
  return operation === "destroy"
    ? destroyConfirmation(identity)
    : clearConfirmation(identity);
}

/**
 * The sentence a refusal reports. Its own words, not a failure's, because what
 * happened is specific: bytes were sent and the tag did not take them, which is the
 * one way this app can learn that a tag will not accept a write (ADR 0007).
 */
export const WILL_NOT_ACCEPT_WRITES = "This tag will not accept writes.";

/**
 * Why it probably would not, stated as possibilities because that is what they
 * are: the Reader cannot tell a tag that is locked from one that was never
 * writable, and claiming one of them would be inventing a finding.
 *
 * This is also where the app says that no pre-check could have helped, so a user
 * does not go looking for one — or ask for one (ADR 0007).
 */
export const WILL_NOT_ACCEPT_WRITES_CAUSE =
  "The likely cause is that the tag has already been written once — a tag written once may permanently refuse further writes — or that it was never writable. This Reader cannot tell which of those it is, and no check exists that could have told you first: a writability test is a write, so the attempt was the only way to find out. Nothing about the tag was changed.";

/** The words for the operation the user chose, so no notice can borrow the other's. */
const WORDS: Record<
  TagOperation,
  { readonly verb: string; readonly doing: string; readonly past: string }
> = {
  clear: { verb: "clear", doing: "clearing", past: "cleared" },
  destroy: { verb: "destroy", doing: "destroying", past: "destroyed" },
};

/**
 * True when a result is for the other operation than the one the user asked for:
 * the backend echoed a different operation, or reported the outcome only the other
 * one can produce.
 *
 * Exported because `lib/outcome` needs the same answer to pick the severity with —
 * `clearKind` would otherwise read a `destroyed` result as *needs you* while this
 * module worded it as a refusal, and the message and the sound would disagree.
 */
export function reportsOtherOperation(
  operation: TagOperation,
  result: ClearResult,
): boolean {
  const otherOutcome: ClearResult["outcome"] =
    operation === "clear" ? "destroyed" : "cleared";
  return result.operation !== operation || result.outcome === otherOutcome;
}

/**
 * What one attempt came to, for the operation the user chose.
 *
 * The success wording is the operation's own, and a result that reports the *other*
 * operation's outcome is reported as a mismatch rather than as a success. That is
 * the one way this module could word a destruction as a Clear, so it is the one
 * place it is refused: the kind, the message and the symbol then all come from a
 * `refused`-severity notice instead of from an outcome nobody produced.
 */
export function tagOperationNotice(
  operation: TagOperation,
  result: ClearResult,
): WriteNotice {
  const words = WORDS[operation];
  const other: TagOperation = operation === "clear" ? "destroy" : "clear";

  // A result for the other operation is a bug, not a result: the app cannot say
  // what the tag carries, so it makes no claim and reports it at the refusal's
  // severity.
  if (reportsOtherOperation(operation, result)) {
    return {
      tone: toneForSeverity("error"),
      text:
        `Reported ${other} for a ${words.verb}. The app cannot say what the tag now ` +
        "carries, so read it again before doing anything else.",
    };
  }

  const tone = toneForSeverity(severityOf(clearKind(result.outcome)));
  switch (result.outcome) {
    case "cleared":
      return {
        tone,
        text:
          `Cleared — the tag now carries ${result.presents ?? "a placeholder Identity"}, ` +
          "a placeholder that no building system issues. It is not a working credential: " +
          "nothing will open with it." +
          " The tag is still a live tag and can be written again from this app — clone an " +
          "Identity onto it, or author one. Whether that next write is accepted is the tag's " +
          "answer, as it is for any write." +
          " No copy was recorded: clearing replaces an Identity rather than copying one.",
      };
    case "destroyed":
      return {
        tone,
        text:
          "Destroyed — the tag carries no Identity, and it will never accept data again." +
          " It cannot be recovered or reused: there is no factory restore, no unlock, and " +
          "nothing in this app can bring it back." +
          " Every reader still sees it, because it keeps answering the field — that is not a " +
          "sign it still works, only that the tag answers.",
      };
    case "willNotAcceptWrites":
      return {
        tone,
        text: `${WILL_NOT_ACCEPT_WRITES} ${WILL_NOT_ACCEPT_WRITES_CAUSE}`,
      };
    case "refused":
      return {
        tone,
        text: `Not ${words.past}: ${result.message ?? "the reader refused the write"}`,
      };
    case "unverified":
      return {
        tone,
        text:
          "Unknown: " +
          (result.message ??
            `the ${words.doing} write was sent but the tag could not be read back`) +
          " Read the tag on the reader to find out what it holds.",
      };
    case "failed":
      return {
        tone,
        text: `Not ${words.past}. ${result.message ?? "The write did not take."}`,
      };
  }
}

/** What Clear came to. Throws away the operation argument, not the distinction. */
export function clearNotice(result: ClearResult): WriteNotice {
  return tagOperationNotice("clear", result);
}

/** What Destroy came to. */
export function destroyNotice(result: ClearResult): WriteNotice {
  return tagOperationNotice("destroy", result);
}

/**
 * What a deliberate re-read after the attempt showed.
 *
 * The same finding the write's own read-back produces, worded for the operation the
 * user chose: a Clear is expected to read back as the placeholder, and a Destroy is
 * expected to read back as nothing. Silence is never *proof* for either — a tag
 * that was lifted off looks the same — so the caveat an empty reading cannot
 * exclude is stated rather than left out.
 */
export function reReadNotice(
  operation: TagOperation,
  expected: string | null,
  read: { readonly id: string } | null,
): WriteNotice {
  if (read === null) {
    if (operation === "destroy") {
      return {
        tone: "ok",
        text:
          "No Identity read, which is what a destroyed tag reads as — though a tag lifted off " +
          "the reader looks the same, so re-seat it and check again if you want to be sure.",
      };
    }
    return {
      tone: "warn",
      text:
        "No Identity read. A cleared tag carries a placeholder, so it should read as one: " +
        "either the tag is off the reader, or the clearing write did not land. Re-seat it and " +
        "read again.",
    };
  }
  if (expected !== null && read.id === expected) {
    return {
      tone: "ok",
      text: `Still on the tag: ${read.id}, the placeholder this app wrote.`,
    };
  }
  if (operation === "clear") {
    // A clear aims at a value, so anything else on the tag — including nothing at
    // all, above — is a write that may not have landed. The wording never borrows
    // Destroy's: "it kept what it had, so it will not accept writes" is a verdict
    // about a chip, and a re-read alone cannot reach it.
    return {
      tone: "warn",
      text:
        `This tag reads as ${read.id}. ` +
        (expected === null
          ? "The clearing write was not confirmed, so there is no placeholder to compare it " +
            "with: read it again to see what it holds."
          : `That is not the placeholder this app wrote (${expected}), so the clearing write may ` +
            "not have landed."),
    };
  }
  return {
    tone: "warn",
    text:
      `This tag reads as ${read.id}. If this is the tag the write was sent to, it kept what it ` +
      "had, which means it will not accept writes.",
  };
}
