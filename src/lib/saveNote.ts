/**
 * One line of plain text saying how a save came out, read from the outcome.
 *
 * Both band pages keep a read in the library and then show a line under the
 * readout: `Saved to the library as Front door.`, `Already in the library as Front
 * door.`, or the problem that stopped it. The line used to be built per page — one
 * page re-branching on the store's `SaveResult`, the other reading the `Outcome` it
 * had just reported — which is two copies of one decision and the drift ADR 0008
 * exists to prevent. So there is one derivation, and it reads the outcome: the kind
 * decides the tone, exactly as it does for the message in the corner, and the words
 * are the outcome's own.
 */

import { severityOf, toneForSeverity } from "./severity";
import type { NoticeTone } from "./noticeTone";
import type { Outcome } from "./outcome";

/** What a save came to, in the one shape both pages draw. */
export interface SaveNote {
  readonly tone: NoticeTone;
  readonly text: string;
}

/**
 * The note for one save, from the outcome that was reported for it.
 *
 * `saved` is a success, `already-saved` is informational rather than a fault (a
 * repeat read changed nothing), and everything else is the failure the seam named —
 * a refusal by the library file included, whose own sentence is the outcome's
 * message. Nothing here decides a severity: the tone comes from the kind's row in
 * the seam's table, so the line cannot be calmer than the sound it accompanied.
 */
export function saveNoteOf(outcome: Outcome): SaveNote {
  const text =
    outcome.detail === undefined ? outcome.message : `${outcome.message} ${outcome.detail}`;
  return { tone: toneForSeverity(severityOf(outcome.kind)), text };
}
