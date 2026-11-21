/**
 * The audible alphabet, as a pure value: an outcome in, a sequence of chirps out.
 *
 * This is ADR 0009 written as data. The Reader's protocol offers exactly two
 * relevant frames — `0x0053`, a single fixed-tone chirp that also drives the LED
 * on, and `0x0055`, LED off — so the alphabet can only be built out of **count**
 * (how many chirps), **silence** (none), and the **gap** the host leaves between
 * them. There is no pitch, no duration, no volume and no repeat-with-gap command,
 * and the firmware never acknowledges `0x0053`, so nothing here may claim a chirp
 * was heard.
 *
 * Four symbols, distinguished by count and by absence:
 *
 * | Symbol | Chirps | Meaning |
 * |---|---|---|
 * | `done` | 1 | Completed and confirmed good. |
 * | `needs-you` | 2 | Completed, but the result needs checking. |
 * | `attention` | 3 | Failed, refused, or nothing changed; the LED is held on. |
 * | `silent` | 0 | Nothing happened: no tag, nothing to act on. Not an error. |
 *
 * There is no fourth count. Three is the loudest, because a fourth is not
 * distinguishable from three at speed, and a distinction that cannot be perceived
 * is not a distinction.
 *
 * The symbol is not chosen here: it comes from the outcome's severity in
 * `outcome.ts`, so a message and its sound cannot disagree (ADR 0008). What this
 * module adds is only the translation from that symbol into what a player has to
 * do: this many chirps, this far apart, and whether the LED stays on afterwards.
 */

import { signalOf, type Outcome } from "./outcome";
import { type SignalSymbol } from "./signal";

/**
 * The silence between two chirps, in milliseconds.
 *
 * One named value rather than a number repeated at each call site, because it is
 * the dial that makes one, two and three chirps distinguishable. It is nominal:
 * the real duration of a firmware chirp is unknown to the host, so this constant
 * is tuned on hardware (the spec records that as open), and every producer and
 * player reads it from here.
 */
export const CHIRP_GAP_MS = 120;

/**
 * How long the LED stays on after an attention signal.
 *
 * `0x0053` turns the LED on with every chirp, so attention gets a second,
 * silent channel: two seconds of light survive a loud room, headphones, or a
 * hearing loss. `0x0055` releases it, and only attention holds it — the other
 * symbols release nothing, because the firmware's own LED behaviour after a
 * chirp is not established and this app does not invent it.
 */
export const ATTENTION_LED_HOLD_MS = 2_000;

/**
 * How many chirps each symbol is worth. The whole vocabulary, in one table.
 *
 * Typed as a total `Record`, so a new symbol cannot be added to `signal.ts`
 * without a count here: the compiler refuses a table that omits one.
 */
export const CHIRPS_PER_SYMBOL: Record<SignalSymbol, number> = {
  done: 1,
  "needs-you": 2,
  attention: 3,
  silent: 0,
};

/** What playing one symbol means: a count, a gap, and an LED hold. */
export interface ChirpSequence {
  readonly symbol: SignalSymbol;
  /** How many chirps to send. Zero is silence, a symbol rather than a failure. */
  readonly chirps: number;
  /** The silence to leave between two chirps of this sequence. */
  readonly gapMs: number;
  /** How long to hold the LED on after the last chirp; zero releases nothing. */
  readonly holdLedMs: number;
}

/**
 * The sequence one symbol plays.
 *
 * Total by construction: every symbol in the alphabet has a sequence, including
 * silence, so a player never has to ask whether "silent" means "do nothing" or
 * "stop".
 */
export function chirpSequenceFor(symbol: SignalSymbol): ChirpSequence {
  return {
    symbol,
    chirps: CHIRPS_PER_SYMBOL[symbol],
    gapMs: CHIRP_GAP_MS,
    holdLedMs: symbol === "attention" ? ATTENTION_LED_HOLD_MS : 0,
  };
}

/**
 * The sequence one outcome plays: the symbol its severity produced, and that
 * symbol's count.
 *
 * This is the seam's signal half in one function. An operation reports one
 * outcome; the outcome has one severity; the severity has one symbol; the symbol
 * has one count. So a failure cannot sound like a success, and a poll that
 * latched nothing cannot sound like a poll that latched a tag the decoder then
 * rejected.
 */
export function chirpSequenceForOutcome(outcome: Outcome): ChirpSequence {
  return chirpSequenceFor(signalOf(outcome));
}
