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
 * | `attention` | 3 | Failed, refused, or nothing completed — do not rely on the
 * | | | result; the LED is held on. |
 * | `silent` | 0 | Nothing happened: no tag, nothing to act on. Not an error. |
 *
 * There is no fourth count. Three is the loudest, because a fourth is not
 * distinguishable from three at speed, and a distinction that cannot be perceived
 * is not a distinction.
 *
 * The symbol is not chosen here: it comes from the outcome's severity in
 * `lib/severity`, so a message and its sound cannot disagree (ADR 0008). What this
 * module adds is only the translation from that symbol into what a player has to
 * do: this many chirps, this far apart, and whether the LED stays on afterwards.
 *
 * There is deliberately **no** outcome-in/sequence-out function here. `report` is
 * the only way an outcome reaches the audible half, and a helper that turned an
 * outcome into a sequence would be a second route in — one no operation uses, which
 * is how it would stay unnoticed while it drifted from the seam.
 */

import { type SignalSymbol } from "./signal";

/**
 * The silence between two chirps, in milliseconds.
 *
 * One named value rather than a number repeated at each call site, because it is
 * the dial that makes one, two and three chirps distinguishable. It is nominal:
 * the real duration of a firmware chirp is unknown to the host, so this constant
 * is tuned on hardware (the spec records that as open), and every producer and
 * player reads it from here.
 *
 * Tuned to 400 ms by ear on real hardware. The nominal 120 ms was too short: two
 * chirps in a row ran together, so "needs you" sounded like one longer beep and
 * could not be told from "done". At 400 ms, one, two and three chirps were each
 * distinguishable, the glimpse of the LED after an attention signal was legible in
 * a loud room, and a twenty-attempt batch was still intelligible as it ran. That is
 * a measurement, not a preference: it is the value the alphabet actually needs on
 * this buzzer.
 */
export const CHIRP_GAP_MS = 400;

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
