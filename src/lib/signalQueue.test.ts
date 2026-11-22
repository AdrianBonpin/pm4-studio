import { describe, expect, it } from "vitest";
import {
  SIGNAL_QUEUE_LIMIT,
  createSignalQueue,
  type SignalEffects,
  type SignalQueue,
} from "./signalQueue";
import { ATTENTION_LED_HOLD_MS, CHIRP_GAP_MS } from "./chirpSequence";
import { manualTimers, type ManualClock } from "../test/clock";
import type { SignalSymbol } from "./signal";

/**
 * The signal queue: signals play one after another, never over each other.
 *
 * Everything is driven by a clock the test owns, so "120 ms apart" and "held for
 * two seconds" are values stepped over rather than slept through. The effects
 * are recorded with the time they fired, because the order and the spacing are
 * the whole contract: three chirps at 120 ms is attention, and three chirps at
 * 300 ms is not.
 */

interface Fired {
  readonly at: number;
  readonly what: "chirp" | "release-led";
}

function setup(options: { chirpThrows?: boolean; limit?: number } = {}) {
  const clock = manualTimers();
  const fired: Fired[] = [];
  const effects: SignalEffects = {
    chirp() {
      fired.push({ at: clock.now(), what: "chirp" });
      if (options.chirpThrows) throw new Error("the beeper did not answer");
    },
    releaseLed() {
      fired.push({ at: clock.now(), what: "release-led" });
    },
  };
  const queue: SignalQueue = createSignalQueue({
    effects,
    timers: clock.timers,
    limit: options.limit,
  });
  const chirps = () => fired.filter((event) => event.what === "chirp");
  return { queue, clock, fired, chirps };
}

/** Drive the queue to the end, so an assertion sees every chirp it plays. */
function drain(clock: ManualClock): void {
  for (let step = 0; step < 16; step += 1) clock.advance(10_000);
}

describe("one signal at a time", () => {
  it("plays a done signal as one chirp, immediately", () => {
    const { queue, fired } = setup();
    queue.enqueue("done");

    expect(fired).toEqual([{ at: 0, what: "chirp" }]);
    expect(queue.pending()).toBe(0);
  });

  it("plays needs-you as two chirps and attention as three", () => {
    const two = setup();
    two.queue.enqueue("needs-you");
    two.clock.advance(CHIRP_GAP_MS);
    expect(two.chirps()).toHaveLength(2);

    const three = setup();
    three.queue.enqueue("attention");
    three.clock.advance(CHIRP_GAP_MS * 2);
    expect(three.chirps()).toHaveLength(3);
  });

  it("needs a clock for the chirps after the first, because the gap is real", () => {
    const { queue, clock, chirps } = setup();
    queue.enqueue("attention");

    expect(chirps()).toHaveLength(1);
    clock.advance(CHIRP_GAP_MS - 1);
    expect(chirps()).toHaveLength(1);
    clock.advance(1);
    expect(chirps()).toHaveLength(2);
    clock.advance(CHIRP_GAP_MS);
    expect(chirps()).toHaveLength(3);
  });

  it("spaces every chirp by the one named gap", () => {
    const { queue, clock, chirps } = setup();
    queue.enqueue("attention");
    clock.advance(1_000);

    expect(chirps().map((event) => event.at)).toEqual([0, CHIRP_GAP_MS, CHIRP_GAP_MS * 2]);
  });

  it("plays queued signals in order, with no interleaving", () => {
    const { queue, clock, chirps } = setup();
    queue.enqueue("attention");
    queue.enqueue("done");

    clock.advance(10_000);

    // Attention's three chirps, then a gap, then the next signal's one: the two
    // sequences never overlap, which is what keeps three from becoming two.
    expect(chirps().map((event) => event.at)).toEqual([
      0,
      CHIRP_GAP_MS,
      CHIRP_GAP_MS * 2,
      CHIRP_GAP_MS * 3,
    ]);
    expect(queue.pending()).toBe(0);
  });

  it("holds attention's LED for two seconds after the last chirp, then releases it", () => {
    const { queue, clock, fired, chirps } = setup();
    queue.enqueue("attention");
    clock.advance(CHIRP_GAP_MS * 2);
    expect(chirps()).toHaveLength(3);

    clock.advance(ATTENTION_LED_HOLD_MS - 1);
    expect(fired.filter((event) => event.what === "release-led")).toHaveLength(0);

    clock.advance(1);
    expect(fired.filter((event) => event.what === "release-led")).toEqual([
      { at: CHIRP_GAP_MS * 2 + ATTENTION_LED_HOLD_MS, what: "release-led" },
    ]);
  });

  it("releases the LED for attention only, because nothing else holds it", () => {
    const { queue, clock, fired } = setup();
    queue.enqueue("needs-you");
    clock.advance(10_000);
    queue.enqueue("done");
    clock.advance(10_000);

    expect(fired.filter((event) => event.what === "release-led")).toHaveLength(0);
  });
});

describe("silence and repeats", () => {
  it("never queues silence: it is the absence of a signal, not a quiet one", () => {
    const { queue, clock, fired } = setup();
    queue.enqueue("silent");

    expect(fired).toHaveLength(0);
    expect(queue.pending()).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  it("coalesces identical adjacent signals rather than sounding them twice", () => {
    const { queue, clock, chirps } = setup();
    queue.enqueue("done");
    queue.enqueue("done");
    queue.enqueue("needs-you");
    queue.enqueue("needs-you");
    queue.enqueue("done");

    clock.advance(10_000);

    // One chirp, two chirps, one chirp: the repeats never became their own
    // sequence, so a bursting operation does not sound like a different symbol.
    expect(chirps()).toHaveLength(4);
  });

  it("plays the same signal again once the queue has gone quiet", () => {
    // Coalescing is about adjacency, not about a symbol being banned: a second
    // read that completes a minute later still chirps.
    const { queue, clock, chirps } = setup();
    queue.enqueue("done");
    clock.advance(10_000);
    expect(chirps()).toHaveLength(1);

    queue.enqueue("done");
    clock.advance(10_000);
    expect(chirps()).toHaveLength(2);
  });
});

describe("the queue's bound", () => {
  it("holds eight and drops the oldest rather than blocking the reporter", () => {
    expect(SIGNAL_QUEUE_LIMIT).toBe(8);
    const { queue, clock, chirps } = setup();

    // One starts at once; nine arrive behind it, so the oldest of those nine is
    // dropped and the queue still holds exactly eight.
    const symbols: SignalSymbol[] = [
      "done",
      "needs-you",
      "done",
      "needs-you",
      "done",
      "needs-you",
      "done",
      "needs-you",
      "done",
      "needs-you",
    ];
    for (const symbol of symbols) queue.enqueue(symbol);
    expect(queue.pending()).toBeLessThanOrEqual(SIGNAL_QUEUE_LIMIT);

    drain(clock);

    // Five done at one chirp and five needs-you at two is fifteen; the dropped
    // needs-you is two of those, so thirteen were played.
    expect(chirps()).toHaveLength(13);
  });

  it("takes the limit it is given, for a different queue length", () => {
    const { queue, clock, chirps } = setup({ limit: 2 });
    for (const symbol of ["done", "needs-you", "done", "needs-you", "done"] as const) {
      queue.enqueue(symbol);
    }
    expect(queue.pending()).toBe(2);

    drain(clock);
    // The one in flight is a done chirp, and the two that survived are the last
    // two queued: needs-you then done.
    expect(chirps()).toHaveLength(4);
  });
});

describe("a signal that cannot be emitted", () => {
  it("never throws at whoever reported the outcome", () => {
    const { queue } = setup({ chirpThrows: true });

    expect(() => queue.enqueue("attention")).not.toThrow();
  });

  it("does not stop the queue, so a dead beeper does not silence the app", () => {
    const { queue, clock, chirps } = setup({ chirpThrows: true });
    queue.enqueue("done");
    queue.enqueue("needs-you");

    clock.advance(10_000);

    // Every chirp was attempted; whether the hardware answered is not something
    // this layer can know, and a failure never gates the operation behind it.
    expect(chirps()).toHaveLength(3);
    expect(queue.pending()).toBe(0);
  });
});

describe("clearing the queue", () => {
  it("drops what is pending and stops the sequence in flight", () => {
    const { queue, clock, chirps } = setup();
    queue.enqueue("attention");
    queue.enqueue("done");
    clock.advance(CHIRP_GAP_MS);
    expect(chirps()).toHaveLength(2);

    queue.clear();
    clock.advance(10_000);

    expect(chirps()).toHaveLength(2);
    expect(queue.pending()).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});
