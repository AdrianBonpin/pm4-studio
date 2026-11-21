// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useBeep } from "./useBeep";
import { fakeBackend, renderUi } from "../test/dom";
import { manualTimers } from "../test/clock";
import { outcomes, report } from "../lib/outcome";
import { toastStore } from "../lib/toastStore";
import { QUIET_LEVEL_KEY, loadQuietLevel } from "../lib/quietLevel";
import { CHIRP_GAP_MS } from "../lib/chirpSequence";
import type { SignalTimers } from "../lib/signalQueue";
import type { WriteResult } from "../types";

/**
 * The shell's beeper: the one subscriber that turns reported symbols into frames.
 *
 * Three things are held here, and they are the ones a user would notice:
 *
 *   - a completed operation chirps once, a result that needs checking twice, and
 *     a failure three times, so success and failure finally sound different;
 *   - the quiet level gates what is played, and survives a restart;
 *   - a beeper that does not answer never becomes an operation's outcome, and
 *     never stops the next signal.
 *
 * The clock is injected so the count and the two-second LED hold are asserted
 * rather than slept through. The frames still go through the real IPC boundary:
 * the only thing faked is the backend.
 */

function writeResult(
  outcome: WriteResult["outcome"],
  overrides: Partial<WriteResult> = {},
): WriteResult {
  return {
    customer: 0x55,
    data32: 0x0084_8212,
    readback: null,
    outcome,
    verified: outcome === "verified",
    message: null,
    refusalCause: null,
    confirmedCopies: outcome === "verified" ? 1 : 0,
    countProblem: null,
    ...overrides,
  };
}

function Harness({ timers }: { timers?: SignalTimers }) {
  const { quietLevel, setQuietLevel } = useBeep({ timers });
  return (
    <div>
      <span data-testid="level">{quietLevel}</span>
      <button onClick={() => setQuietLevel("off")}>level off</button>
      <button onClick={() => setQuietLevel("errors-and-warnings")}>level errors</button>
      <button onClick={() => setQuietLevel("all")}>level all</button>
      <button onClick={() => report(outcomes.tagRead("read", "55 00 84 82 12"))}>done</button>
      <button onClick={() => report(outcomes.nothingLatched("read"))}>nothing</button>
      <button onClick={() => report(outcomes.write("write", writeResult("unverified")))}>
        needs-you
      </button>
      <button onClick={() => report(outcomes.write("write", writeResult("failed")))}>
        failed
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  toastStore.clear();
});

afterEach(() => {
  toastStore.clear();
});


describe("a reported outcome", () => {
  it("sounds one chirp for a completed operation", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "done" }));

    await waitFor(() => {
      expect(backend.callsTo("beep")).toHaveLength(1);
    });
  });

  it("sounds two chirps when the result needs checking", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "needs-you" }));
    await waitFor(() => expect(backend.callsTo("beep")).toHaveLength(1));

    clock.advance(CHIRP_GAP_MS);
    expect(backend.callsTo("beep")).toHaveLength(2);
  });

  it("sounds three chirps when something failed", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "failed" }));
    await waitFor(() => expect(backend.callsTo("beep")).toHaveLength(1));

    clock.advance(CHIRP_GAP_MS);
    clock.advance(CHIRP_GAP_MS);
    expect(backend.callsTo("beep")).toHaveLength(3);
  });

  it("holds the LED for two seconds after a failure, then releases it", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null, led_off: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "failed" }));
    clock.advance(CHIRP_GAP_MS * 2);
    await waitFor(() => expect(backend.callsTo("beep")).toHaveLength(3));

    clock.advance(1_999);
    expect(backend.callsTo("led_off")).toHaveLength(0);

    clock.advance(1);
    expect(backend.callsTo("led_off")).toHaveLength(1);
  });

  it("leaves the beeper alone for an outcome whose severity is silent", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "nothing" }));
    clock.advance(10_000);

    // Nothing happened, and that is not an error: silence is a symbol.
    expect(backend.callsTo("beep")).toHaveLength(0);
    expect(backend.callsTo("led_off")).toHaveLength(0);
  });

  it("plays the next signal after one the beeper could not answer", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({
      beep: () => {
        throw new Error("the beeper did not answer");
      },
    });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "done" }));
    await user.click(screen.getByRole("button", { name: "needs-you" }));

    clock.advance(10_000);
    // One for the done, two for the needs-you: a dead beeper does not swallow
    // the signals that follow it.
    expect(backend.callsTo("beep")).toHaveLength(3);
  });
});

describe("the quiet level in the shell", () => {
  it("starts from the stored level, so a restart is not a reset", () => {
    localStorage.setItem(QUIET_LEVEL_KEY, "errors-and-warnings");
    fakeBackend({ beep: () => null });
    renderUi(<Harness />);

    expect(screen.getByTestId("level").textContent).toBe("errors-and-warnings");
  });

  it("carries the old boolean beep preference across", () => {
    // The preference existed before the level did; upgrading must not change
    // what this user hears, and must not silently turn the sound back on.
    localStorage.setItem("pm4studio.beep", "0");
    fakeBackend({ beep: () => null });
    renderUi(<Harness />);

    expect(screen.getByTestId("level").textContent).toBe("off");
  });

  it("persists a change, so the control and the next launch agree", async () => {
    fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness />);

    await user.click(screen.getByRole("button", { name: "level off" }));

    expect(screen.getByTestId("level").textContent).toBe("off");
    expect(localStorage.getItem(QUIET_LEVEL_KEY)).toBe("off");
    expect(loadQuietLevel()).toBe("off");
  });

  it("silences a completed operation at errors-and-warnings but keeps the failure", async () => {
    const clock = manualTimers();
    localStorage.setItem(QUIET_LEVEL_KEY, "errors-and-warnings");
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "done" }));
    clock.advance(10_000);
    expect(backend.callsTo("beep")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "failed" }));
    clock.advance(CHIRP_GAP_MS * 2);
    expect(backend.callsTo("beep")).toHaveLength(3);
  });

  it("changes what is played straight away, without a reload", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "level off" }));
    await user.click(screen.getByRole("button", { name: "failed" }));
    clock.advance(10_000);

    expect(backend.callsTo("beep")).toHaveLength(0);
  });
});

describe("unmounting the shell", () => {
  it("stops a signal in flight instead of chirping at a window that is gone", async () => {
    const clock = manualTimers();
    const backend = fakeBackend({ beep: () => null });
    const { user, unmount } = renderUi(<Harness timers={clock.timers} />);

    await user.click(screen.getByRole("button", { name: "failed" }));
    unmount();
    clock.advance(10_000);

    expect(backend.callsTo("beep")).toHaveLength(1);
  });
});
