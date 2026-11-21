import { describe, expect, it, vi } from "vitest";
import { MAX_VISIBLE_TOASTS, createToastStore, visibleToasts } from "./toastStore";
import { outcomes, type Outcome } from "./outcome";
import { manualTimers } from "../test/clock";
import type { WriteResult } from "../types";

/**
 * The toast store, driven by a clock the tests own.
 *
 * Dismissal is by severity, so every timing claim here is advanced rather than
 * waited for: the store is handed a timer it cannot escape, and the test states
 * exactly where the deadline falls. Nothing in this file sleeps.
 */

function setup() {
  const clock = manualTimers();
  const store = createToastStore({ timers: clock.timers });
  return { store, clock };
}

function writeResult(outcome: WriteResult["outcome"], overrides: Partial<WriteResult> = {}): WriteResult {
  return {
    customer: 0x55,
    data32: 0x0084_8212,
    readback: null,
    outcome,
    verified: outcome === "verified",
    message: null,
    confirmedCopies: outcome === "verified" ? 1 : 0,
    countProblem: null,
    ...overrides,
  };
}

/** One outcome per severity, built by the vocabulary rather than by hand. */
const DONE: Outcome = outcomes.tagRead("read", "55 00 84 82 12");
const NEEDS_CHECKING: Outcome = outcomes.write("write", writeResult("unverified"));
const FAILED: Outcome = outcomes.write("write", writeResult("failed"));

describe("how long a message stays", () => {
  it("clears a success at four seconds and not a millisecond before", () => {
    const { store, clock } = setup();
    store.push(DONE);

    clock.advance(3_999);
    expect(store.getState().toasts).toHaveLength(1);

    clock.advance(1);
    expect(store.getState().toasts).toHaveLength(0);
  });

  it("clears a warning at eight seconds, longer than a success but still itself", () => {
    const { store, clock } = setup();
    store.push(NEEDS_CHECKING);

    clock.advance(7_999);
    expect(store.getState().toasts).toHaveLength(1);

    clock.advance(1);
    expect(store.getState().toasts).toHaveLength(0);
  });

  it("keeps an error until it is dismissed, however long that takes", () => {
    const { store, clock } = setup();
    store.push(FAILED);

    clock.advance(60_000);
    expect(store.getState().toasts).toHaveLength(1);
    // Nothing is scheduled for it at all: an error has no deadline to miss.
    expect(clock.pending()).toBe(0);
  });
});

describe("an error and the operation that raised it", () => {
  it("clears the error when the same operation later succeeds", () => {
    const { store } = setup();
    const refused = outcomes.write("write", writeResult("refused", { message: "the tag refused" }));
    const verified = outcomes.write("write", writeResult("verified"));

    store.push(refused);
    expect(store.getState().toasts).toHaveLength(1);

    store.push(verified);
    // One message, and it is the success: the refusal it replaced is gone.
    const remaining = store.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe("verified");
  });

  it("leaves another operation's error alone", () => {
    const { store } = setup();
    store.push(outcomes.write("write", writeResult("failed")));
    store.push(outcomes.announcement("Feedback preferences saved."));

    expect(store.getState().toasts.map((toast) => toast.kind)).toEqual([
      "announcement",
      "failed",
    ]);
  });
});

describe("how many are visible", () => {
  it("shows at most three and counts the older ones rather than dropping them", () => {
    const { store } = setup();
    for (let i = 1; i <= 5; i += 1) {
      store.push(outcomes.tagRead("read", `55 00 84 82 ${i.toString().padStart(2, "0")}`));
    }

    const state = store.getState();
    expect(state.toasts).toHaveLength(5);
    const { visible, hidden } = visibleToasts(state);
    expect(visible).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(hidden).toBe(2);
    // The visible three are the newest, and the count is of the older ones.
    expect(visible[0]?.message).toBe("Read 55 00 84 82 05.");
  });
});

describe("a repeated outcome", () => {
  it("coalesces into one message carrying a repeat count", () => {
    const { store, clock } = setup();
    const same = outcomes.write("batch", writeResult("verified"));

    store.push(same);
    clock.advance(200);
    store.push(same);
    clock.advance(200);
    store.push(same);

    const state = store.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]?.repeat).toBe(3);
  });

  it("does not coalesce outcomes that arrived apart in time", () => {
    const { store, clock } = setup();
    const same = outcomes.write("batch", writeResult("verified"));

    store.push(same);
    clock.advance(2_500);
    store.push(same);

    expect(store.getState().toasts).toHaveLength(2);
  });

  it("does not coalesce two different messages", () => {
    const { store } = setup();
    store.push(outcomes.tagRead("read", "55 00 84 82 12"));
    store.push(outcomes.tagRead("read", "55 00 84 82 13"));

    expect(store.getState().toasts).toHaveLength(2);
  });
});

describe("dismissal", () => {
  it("removes the message and cancels its deadline", () => {
    const { store, clock } = setup();
    store.push(DONE);
    const id = store.getState().toasts[0]?.id as string;

    store.dismiss(id);

    expect(store.getState().toasts).toHaveLength(0);
    expect(clock.pending()).toBe(0);
  });

  it("acknowledges a message however it leaves, so its owner can clear its state", () => {
    const { store, clock } = setup();
    const onDismiss = vi.fn();
    store.push({ ...FAILED, onDismiss });
    store.dismiss(store.getState().toasts[0]?.id as string);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // And again when the message times out, rather than by dismissal.
    store.push({ ...DONE, onDismiss });
    clock.advance(4_000);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("tells its subscribers whenever the stack changes", () => {
    const { store, clock } = setup();
    const seen = vi.fn();
    const stop = store.subscribe(seen);

    store.push(DONE);
    expect(seen).toHaveBeenCalledTimes(1);
    clock.advance(4_000);
    expect(seen).toHaveBeenCalledTimes(2);

    stop();
    store.push(DONE);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
