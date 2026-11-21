/**
 * Blanking a Tag's Identity: the confirmation the user reads, and the wording of
 * what came of it.
 *
 * Blanking writes the neutral Identity onto a 125 kHz Tag. It is **not** a
 * factory reset and it does **not** unlock a locked chip: neither is reachable
 * over this protocol. The words here are therefore "blank"/"blanked" and never
 * "reset", "restore", "unlock", "wipe", "erase" or "format" — each of those
 * promises something the hardware cannot do.
 *
 * The outcome model lives in Rust (`src-tauri/src/write_outcome.rs` and
 * `src-tauri/src/blank.rs`) and reaches this module already decided. The rule
 * that matters here: a blanked Tag reads as *empty*, because the Identity codec
 * treats an all-zero data field as "no reading". So "blanked" is a definite
 * result, and it is never worded as "verified" — a blanking write adds no copy
 * of anything, and it must not look like one.
 */

import type { BlankResult } from "../types";
import type { WriteNotice } from "./writeOutcome";

/** The one verb this feature may use for itself. */
export const BLANK_ACTION_LABEL = "Blank tag";

/** One fact the user must read before the write is offered. */
export interface BlankFact {
  readonly title: string;
  readonly detail: string;
}

/**
 * The facts the confirmation states, each one a consequence the user cannot
 * discover afterwards without having lost a Tag to it.
 */
export const BLANK_FACTS: readonly BlankFact[] = [
  {
    title: "This is permanent",
    detail:
      "The Identity on the tag is overwritten for good. Whatever value it holds now cannot be recovered from the tag afterwards.",
  },
  {
    title: "The tag may read as empty",
    detail:
      "A tag that carries no Identity reads as nothing, so reading it again will probably show no Identity at all. That is the expected result of blanking, not a failure.",
  },
  {
    title: "The tag may be unusable afterwards",
    detail:
      "A blanked tag may be unusable for further writes. A T5577 test tag has already been permanently locked by an earlier write experiment, so this is a real hazard rather than a theoretical one.",
  },
];

/**
 * The denial, stated as plainly as the facts above it. Blanking is the only
 * operation this protocol offers, so the app says what it is not as well.
 */
export const BLANK_IS_NOT_A_FACTORY_RESET =
  "Blanking is not a factory reset and it does not unlock the tag. Neither can be reached over this protocol: a factory configuration cannot be written back, and a tag that has stopped accepting writes stays that way.";

/**
 * Shown beside the outcome: why a blanked tag reports nothing, so an expected
 * empty read is not taken for a broken Tag.
 */
export const BLANK_OUTCOME_HINT =
  "A tag with no Identity reads as empty, so a blanked tag is expected to show no Identity. Blanking is not a copy: no Snapshot's confirmed-copy count moves.";

/** The confirmation, ready to render. */
export interface BlankConfirmation {
  /** The Identity that will be destroyed, as the user saw it read. */
  readonly identity: string;
  /** Heading: names the Identity and the action. */
  readonly title: string;
  readonly action: string;
  readonly facts: readonly BlankFact[];
  readonly notFactoryReset: string;
}

/**
 * Build the confirmation for one read Identity.
 *
 * It takes the Identity text rather than a card so the caller cannot accidentally
 * confirm something it did not read: the tag is named in the heading, and the
 * same Identity is handed to the write so the guard can refuse if the tag on the
 * Reader is a different one.
 */
export function blankConfirmation(identity: string): BlankConfirmation {
  return {
    identity,
    title: `Blank ${identity} permanently?`,
    action: BLANK_ACTION_LABEL,
    facts: BLANK_FACTS,
    notFactoryReset: BLANK_IS_NOT_A_FACTORY_RESET,
  };
}

/**
 * What to tell the user about one blanking attempt, in the words of its actual
 * outcome. A blanked Tag is "blanked" — never "verified" — and nothing else is
 * ever described as blanked.
 */
export function blankNotice(result: BlankResult): WriteNotice {
  switch (result.outcome) {
    case "blanked":
      return {
        tone: "ok",
        text:
          "Blanked — the tag no longer presents an Identity. It will probably read as empty " +
          "now, showing no Identity at all, which is the expected result. Put it back on the " +
          "reader to check, and note that it may refuse further writes." +
          " No copy was recorded: blanking destroys an Identity rather than copying one.",
      };
    case "refused":
      return {
        tone: "err",
        text: `Not blanked: ${result.message ?? "the reader refused the write"}`,
      };
    case "unverified":
      return {
        tone: "warn",
        text:
          "Unknown: " +
          (result.message ??
            "the blanking write was sent but the tag could not be read back") +
          " Read the tag on the reader to find out what it holds.",
      };
    case "failed":
      return {
        tone: "err",
        text: `Not blanked. ${result.message ?? "The write did not take."}`,
      };
  }
}
