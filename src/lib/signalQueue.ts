/**
 * The queue signals are played through: one sequence at a time, in order.
 *
 * A signal is a count — one chirp, two, three — and a count is only readable if
 * the chirps arrive as one uninterrupted group. Two operations finishing at the
 * same moment must therefore never interleave their chirps: three chirps from two
 * outcomes interleaved is indistinguishable from four or from none. So this is a
 * serial player: each sequence finishes, a gap separates it from the next, and
 * only then does the next begin.
 *
 * Three properties the spec asks for, and what each one is for:
 *
 *   * **Bounded at eight, dropping the oldest.** A burst of reports must not grow
 *     without limit, and must never block the operation that reported — the
 *     signal is never the only report of an outcome (ADR 0008). Dropping the
 *     oldest is chosen over dropping the newest, because the newest is the news.
 *   * **Identical adjacent signals coalesce.** The same outcome reported twice in
 *     a row is one signal, exactly as the toast store coalesces the same message:
 *     two identical bursts do not become a longer, wrong-looking count.
 *   * **Effect failures are swallowed.** The firmware never acknowledges the
 *     chirp frame, and a Reader that has gone away must not turn a completed
 *     operation into an error. Nothing here throws at whoever reported.
 *
 * This module knows nothing about the Reader and nothing about outcomes: it takes
 * symbols, asks `lib/chirpSequence` what that symbol is made of, and calls two
 * injected effects — send one chirp, release the LED. `hooks/useBeep` is where
 * those effects become frames on the wire.
 */

import { chirpSequenceFor, type ChirpSequence } from "./chirpSequence";
import type { SignalSymbol } from "./signal";

/** How many signals may wait behind the one playing. Beyond that, the oldest go. */
export const SIGNAL_QUEUE_LIMIT = 8;

/**
 * The clock, injected. Deliberately smaller than the toast store's timer: this
 * layer only needs to schedule and cancel, and a test states the cadence instead
 * of sleeping through it.
 */
export interface SignalTimers {
  after(ms: number, run: () => void): unknown;
  cancel(handle: unknown): void;
}

export const systemSignalTimers: SignalTimers = {
  after: (ms, run) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What playing a signal does to the Reader. Both are fire-and-forget frames. */
export interface SignalEffects {
  /** Send one chirp: `0x0053`. Fixed tone, fixed duration, LED on as a side effect. */
  chirp(): void;
  /** Release the LED: `0x0055`. Not a beep, whatever an earlier build thought. */
  releaseLed(): void;
}

export interface SignalQueue {
  /**
   * Ask for one symbol to be played.
   *
   * Silence is ignored — it is the absence of a signal, not a quiet one — and an
   * identical signal already playing or waiting is dropped. Never throws.
   */
  enqueue(symbol: SignalSymbol): void;
  /** How many signals are waiting behind the one playing. For tests and for a
   *  later surface that wants to show a backlog; zero means nothing is waiting. */
  pending(): number;
  /** Drop everything and stop the sequence in flight, cancelling its timers. */
  clear(): void;
}

export interface SignalQueueOptions {
  readonly effects: SignalEffects;
  readonly timers?: SignalTimers;
  /** How many signals may wait; `SIGNAL_QUEUE_LIMIT` unless a caller says otherwise. */
  readonly limit?: number;
}

export function createSignalQueue(options: SignalQueueOptions): SignalQueue {
  const effects = options.effects;
  const timers = options.timers ?? systemSignalTimers;
  const limit = options.limit ?? SIGNAL_QUEUE_LIMIT;

  let pending: ChirpSequence[] = [];
  let playing: ChirpSequence | null = null;
  let chirpsLeft = 0;
  /** True during the gap after a sequence's last chirp, before the next may start. */
  let inGap = false;
  /** The last symbol accepted, so an identical adjacent one can be dropped. */
  let lastSymbol: SignalSymbol | null = null;

  /** Timers still scheduled, so `clear` can cancel them all. */
  const handles = new Set<unknown>();
  /**
   * Bumped by `clear`. A callback scheduled before a clear belongs to an older
   * generation and is ignored even if its cancel did not take effect.
   */
  let generation = 0;

  function schedule(ms: number, run: () => void): void {
    const current = generation;
    let handle: unknown;
    handle = timers.after(ms, () => {
      handles.delete(handle);
      if (generation !== current) return;
      run();
    });
    handles.add(handle);
  }

  /** Run one effect, absorbing anything it throws. */
  function attempt(effect: () => void): void {
    try {
      effect();
    } catch {
      // The signal is never the only report of an outcome, and never gates the
      // operation behind it, so a dead beeper stops here.
    }
  }

  function startNext(): void {
    if (pending.length === 0) {
      // Idle: the next signal is not adjacent to anything, so it may be the same
      // symbol again and must not be coalesced into a burst that already ended.
      lastSymbol = null;
      return;
    }
    const sequence = pending.shift() as ChirpSequence;
    playing = sequence;
    chirpsLeft = sequence.chirps;
    sendChirp();
  }

  function sendChirp(): void {
    const sequence = playing;
    if (sequence === null) return;

    attempt(() => effects.chirp());
    chirpsLeft -= 1;

    if (chirpsLeft > 0) {
      schedule(sequence.gapMs, sendChirp);
      return;
    }

    // The last chirp is out. Attention keeps the LED on for its hold; every other
    // symbol releases nothing, because the firmware's own LED behaviour after a
    // chirp is not established.
    if (sequence.holdLedMs > 0) {
      schedule(sequence.holdLedMs, () => attempt(() => effects.releaseLed()));
    }

    playing = null;
    inGap = true;
    // The gap between sequences is the same named gap as the gap between chirps:
    // a sequence beginning the instant another ended would merge two counts into
    // one and change what the user heard.
    schedule(sequence.gapMs, () => {
      inGap = false;
      startNext();
    });
  }

  return {
    enqueue(symbol) {
      const sequence = chirpSequenceFor(symbol);
      if (sequence.chirps === 0) return;
      if (lastSymbol === symbol) return;

      lastSymbol = symbol;
      if (pending.length >= limit) pending.shift();
      pending.push(sequence);
      if (playing === null && !inGap) startNext();
    },

    pending: () => pending.length,

    clear() {
      generation += 1;
      for (const handle of handles) timers.cancel(handle);
      handles.clear();
      pending = [];
      playing = null;
      chirpsLeft = 0;
      inGap = false;
      lastSymbol = null;
    },
  };
}
