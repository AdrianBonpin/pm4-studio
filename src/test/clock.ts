/**
 * A clock and a timer queue the tests advance by hand.
 *
 * The toast store takes its timers as a dependency rather than reaching for
 * `setTimeout`, so a dismissal deadline is a value a test steps over instead of
 * a wall-clock wait. Shared here because both the store's own tests and the
 * rendering surface's tests need the same one.
 */

import type { Timer } from "../lib/toastStore";

export interface ManualClock {
  /** The injected timer, passed to whatever is under test. */
  readonly timers: Timer;
  /** Milliseconds since the test started stepping. */
  now(): number;
  /** How many deadlines are still scheduled. */
  pending(): number;
  /** Move the clock forward, running every timer that falls due on the way. */
  advance(ms: number): void;
}

export function manualTimers(): ManualClock {
  let now = 0;
  let next = 0;
  const pending = new Map<number, { at: number; run: () => void }>();

  const timers: Timer = {
    now: () => now,
    after(ms, run) {
      const handle = ++next;
      pending.set(handle, { at: now + ms, run });
      return handle;
    },
    cancel(handle) {
      pending.delete(handle as number);
    },
  };

  return {
    timers,
    now: () => now,
    pending: () => pending.size,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [handle, timer] = due;
        pending.delete(handle);
        now = Math.max(now, timer.at);
        timer.run();
      }
      now = target;
    },
  };
}
