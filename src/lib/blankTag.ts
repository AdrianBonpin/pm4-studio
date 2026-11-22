/**
 * **Reset** a Tag's Identity: the confirmation the user reads, and the wording of
 * what came of it.
 *
 * The operation is called **Reset** everywhere a user reads it: the mode pill in
 * `lib/lfModes`, this module's heading, its controls, and the words its outcome
 * arrives in. GLOSSARY.md puts "blank (as a verb)" on Reset's *Avoid* line — the
 * verb invited the factory-restore reading this redesign set out to end, and the
 * panel then had to spend a paragraph denying it. "Blank" survives only as the
 * noun: the state of a Tag that carries no Identity, which Clone and Batch write
 * onto.
 *
 * What Reset does *not* do is stated once, where this Reader's every other limit
 * is stated: `READER_CAPABILITY_LIMITS`' *Factory restore and unlock* entry. A
 * factory configuration cannot be written back and a locked Tag cannot be
 * recovered, which is why no paragraph here repeats it.
 *
 * The wire vocabulary keeps its own word. The Rust command is `lf_blank`, the
 * result's outcome is `blanked`, and `src-tauri/src/blank.rs` owns the model. That
 * is a protocol and storage vocabulary, not interface copy, and renaming it would
 * break the library's count rule for nothing a user can see. The rule that matters
 * here: a Tag after a Reset reads as *empty*, because the Identity codec treats an
 * all-zero data field as "no reading". So "blanked" is a definite result, and it is
 * never worded as "verified" — a Reset adds no copy of anything, and it must not
 * look like one.
 */

import type { BlankResult } from "../types";
import { blankKind, severityOf, toneForSeverity } from "./severity";
import type { WriteNotice } from "./writeOutcome";

/** The verb this feature may use for itself, as the button that does it. */
export const RESET_ACTION_LABEL = "Reset this tag permanently";

/** The panel's heading. The mode pill in `lib/lfModes` says the same word. */
export const RESET_PANEL_TITLE = "Reset a tag";

/** The line under the heading: what a Reset does, with no factory-restore denial. */
export const RESET_PANEL_HINT =
  "Overwrite a Tag's Identity with nothing, so the Tag carries no assigned value.";

/** The control that starts the flow. */
export const RESET_READ_CONTROL = "Read the tag to reset";

/** The control that starts over once an attempt is done. */
export const RESET_ANOTHER_CONTROL = "Reset another tag";

/** One fact the user must read before the write is offered. */
export interface BlankFact {
  readonly title: string;
  readonly detail: string;
}

/**
 * The facts the confirmation states, each one a consequence the user cannot
 * discover afterwards without having lost a Tag to it.
 *
 * The three writability caveats are facts in this list rather than a footnote
 * under it, because they are the reason the operation is risky and the reason no
 * safer version of it exists (ADR 0007). A user who reads this confirmation and
 * still presses the button has been told, in as many words, that the attempt is
 * the only test there is.
 */
export const RESET_FACTS: readonly BlankFact[] = [
  {
    title: "This is permanent",
    detail:
      "The Identity on the tag is overwritten for good. Whatever value it holds now cannot be recovered from the tag afterwards.",
  },
  {
    title: "This Reader cannot tell whether a tag will accept a write",
    detail:
      "A 125 kHz reply carries no tag family and no writability flag, and there is no command that asks a tag whether it will take a write. Every command that would answer the question is itself a write, so no check exists — not in this app, and not in this protocol. Nothing here can look at the tag and tell you first.",
  },
  {
    title: "A tag already written once may refuse forever",
    detail:
      "A T5577 that has already been written may permanently refuse every later write while still reading back the Identity it carries. This Reader cannot tell a tag that will refuse from one that will accept. A tag Reset once may be unusable for further writes: a T5577 test tag has already been permanently locked by an earlier write experiment, so this is a real hazard rather than a theoretical one.",
  },
  {
    title: "Only attempt this on a tag you can afford to lose",
    detail:
      "The write is the test, so there is no cheaper way to find out whether this tag accepts one. If you need the tag, do not put it here — the app cannot make the attempt safe.",
  },
  {
    title: "The tag may read as empty",
    detail:
      "A tag that carries no Identity reads as nothing, so reading it again will probably show no Identity at all. That is the expected result of a Reset, not a failure.",
  },
];

/**
 * Shown beside the outcome: why a Tag with no Identity reports nothing, so an
 * expected empty read is not taken for a broken Tag.
 */
export const RESET_OUTCOME_HINT =
  "A tag with no Identity reads as empty, so a tag Reset once is expected to show no Identity. Reset is not a copy: no Snapshot's confirmed-copy count moves.";

/** The confirmation, ready to render. */
export interface BlankConfirmation {
  /** The Identity that will be destroyed, as the user saw it read. */
  readonly identity: string;
  /** Heading: names the Identity and the action. */
  readonly title: string;
  readonly action: string;
  readonly facts: readonly BlankFact[];
}

/**
 * Build the confirmation for one read Identity.
 *
 * It takes the Identity text rather than a card so the caller cannot accidentally
 * confirm something it did not read: the tag is named in the heading, and the
 * same Identity is handed to the write so the guard can refuse if the tag on the
 * Reader is a different one.
 */
export function resetConfirmation(identity: string): BlankConfirmation {
  return {
    identity,
    title: `Reset the tag holding ${identity}?`,
    action: RESET_ACTION_LABEL,
    facts: RESET_FACTS,
  };
}

/**
 * The sentence a refused Reset says. Its own words, not a failure's, because what
 * happened is specific: bytes were sent and the tag kept its Identity, which is
 * the one way this app can learn that a tag will not take a write (ADR 0007).
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

/**
 * What a deliberate re-read after the attempt showed.
 *
 * This is the same finding as the write's own read-back, worded the same way: a
 * tag that still presents an Identity is a tag that will not accept writes, and
 * the app names the likely causes instead of reporting that nothing changed as
 * though nothing could be concluded (ADR 0007). Silence is worded as the expected
 * result of a Reset, with the one caveat an empty reading cannot exclude.
 */
export function resetCheckNotice(read: { readonly id: string } | null): WriteNotice {
  if (read === null) {
    return {
      tone: "ok",
      text:
        "No Identity read. That is the expected result for a tag with no Identity — though an " +
        "empty reader looks the same, so re-seat the tag on the reader and check again if you " +
        "want to be sure.",
    };
  }
  return {
    tone: "warn",
    text:
      `This tag still reads as ${read.id}. ` +
      "If this is the tag the write was sent to, it will not accept writes: the likely cause " +
      "is that it has already been written once, or that it was never writable. This Reader " +
      "cannot tell which, and no check could have answered it first.",
  };
}

/**
 * What to tell the user about one Reset, in the words of its actual outcome.
 *
 * The words say **Reset**, because that is the name of the thing the user did. A
 * Reset that took is a definite result — the tag presents no Identity — and it is
 * never "verified": no copy was placed.
 */
export function resetNotice(result: BlankResult): WriteNotice {
  // The severity is the seam's, so a refusal of the write cannot be drawn
  // calmer than the three chirps it sounds.
  const tone = toneForSeverity(severityOf(blankKind(result.outcome)));
  switch (result.outcome) {
    case "blanked":
      return {
        tone,
        text:
          "Reset — the tag no longer presents an Identity. Reading it again shows no " +
          "Identity at all, which is the expected result of a Reset. The Identity is gone; " +
          "whether this tag will accept a new one depends on the tag itself, and this Reader " +
          "cannot tell without writing to it." +
          " No copy was recorded: Reset destroys an Identity rather than copying one.",
      };
    case "willNotAcceptWrites":
      return {
        tone,
        text: `${WILL_NOT_ACCEPT_WRITES} ${WILL_NOT_ACCEPT_WRITES_CAUSE}`,
      };
    case "refused":
      return {
        tone,
        text: `Not reset: ${result.message ?? "the reader refused the write"}`,
      };
    case "unverified":
      return {
        tone,
        text:
          "Unknown: " +
          (result.message ?? "the reset write was sent but the tag could not be read back") +
          " Read the tag on the reader to find out what it holds.",
      };
    case "failed":
      return {
        tone,
        text: `Not reset. ${result.message ?? "The write did not take."}`,
      };
  }
}
