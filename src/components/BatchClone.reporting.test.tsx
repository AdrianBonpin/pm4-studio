// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { BatchClone } from "./BatchClone";
import { BatchMode } from "./BatchMode";
import { fakeBackend, renderUi } from "../test/dom";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { toastStore } from "../lib/toastStore";
import { runConfirmedCopies, startBatch, recordAttempt } from "../lib/batchClone";
import type { BatchAttemptResult, BatchAttemptOutcome, LfCard } from "../types";

/**
 * Ticket 13 — a Batch run reports every attempt, and is heard doing it.
 *
 * The claims, from outside the component:
 *
 *   * every attempt ends in exactly one outcome, reported as it arrives — a
 *     skip, a refusal and a verified write are three distinguishable results in
 *     the list and three different sounds;
 *   * the run's confirmed copy count rises once per verified write and never for
 *     a skip, a refusal or an unverified one;
 *   * nothing produced by polling or by the run's own bookkeeping reaches either
 *     channel: no attempt is heard twice and no poll is heard at all;
 *   * a failing attempt is heard like any other rather than dropped.
 */

const SOURCE: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

function attempt(
  outcome: BatchAttemptOutcome,
  overrides: Partial<BatchAttemptResult> = {},
): BatchAttemptResult {
  return {
    customer: SOURCE.customer,
    data32: SOURCE.data32,
    outcome,
    message: null,
    refusalCause: null,
    readback: null,
    confirmedCopies: null,
    countProblem: null,
    ...overrides,
  };
}

const VERIFIED = attempt("verified", { readback: SOURCE, confirmedCopies: 1 });

const SKIPPED = attempt("skipped", {
  refusalCause: "already-carries",
  readback: SOURCE,
  confirmedCopies: 1,
  message:
    "the tag on the reader already reads as 55 00 84 82 12, so nothing was written. That is " +
    "either the original tag still on the reader, or a tag that was already written in this " +
    "run — this attempt is not counted again. Put a fresh blank tag on the reader for the " +
    "next attempt.",
});

const REFUSED = attempt("refused", {
  refusalCause: "unreadable",
  message:
    "could not read the tag on the reader, so refusing to write blind. Put a blank 125 kHz " +
    "tag on the reader and try again.",
});

const UNVERIFIED = attempt("unverified", {
  message:
    "the write was sent, but the tag could not be read back, so whether this attempt landed " +
    "is unknown and it is not counted as a copy.",
});

beforeEach(() => {
  toastStore.clear();
});

function hearSignals(): { symbols: SignalSymbol[]; stop: () => void } {
  const symbols: SignalSymbol[] = [];
  return { symbols, stop: subscribeSignals((symbol) => symbols.push(symbol)) };
}

let stopHearing: (() => void) | null = null;
afterEach(() => {
  stopHearing?.();
  stopHearing = null;
});

/** Render a run whose attempts answer with the given results, in order. */
function renderRun(results: BatchAttemptResult[]) {
  const queue = [...results];
  const backend = fakeBackend({
    lf_clone_attempt: () => queue.shift() ?? VERIFIED,
  });
  const ui = renderUi(<BatchClone source={SOURCE} connected onExit={() => {}} />);
  return { backend, ...ui };
}

/** Press the write button and wait for the attempt to be reported. */
async function writeOnce(
  harness: ReturnType<typeof renderRun>,
  reportedSoFar: number,
) {
  await harness.user.click(screen.getByRole("button", { name: /Write the blank on the reader/ }));
  await waitFor(() =>
    expect(harness.backend.callsTo("lf_clone_attempt")).toHaveLength(reportedSoFar),
  );
}

describe("every attempt reports itself", () => {
  it("keeps a verified write, a skip and a refusal three distinguishable results", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const harness = renderRun([VERIFIED, SKIPPED, REFUSED]);

    await writeOnce(harness, 1);
    await writeOnce(harness, 2);
    await writeOnce(harness, 3);

    // Three attempts, three signals. Only the verified one sounds "done", so which
    // fob worked is audible without reading the list. The skip and the refusal
    // share the attention symbol on purpose — both are refusals, which the spec's
    // alphabet gives three chirps — and the ledger, not the beeper, says which.
    expect(heard.symbols).toEqual(["done", "attention", "attention"]);

    // And three different messages, each naming its own condition.
    const messages = toastStore.getState().toasts.map((toast) => toast.message);
    expect(new Set(messages).size).toBe(3);
    expect(messages.some((m) => m.startsWith("Verified"))).toBe(true);
    expect(messages.some((m) => m.includes("could not read"))).toBe(true);
    expect(messages.some((m) => m.includes("already reads as"))).toBe(true);

    // The run's own ledger keeps all three, each labelled with its own outcome.
    const ledger = screen.getByText("Attempts").parentElement as HTMLElement;
    const labels = within(ledger)
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(labels[0]).toContain("Verified");
    expect(labels[1]).toContain("Skipped");
    expect(labels[2]).toContain("Refused");
    expect(new Set(labels).size).toBe(3);
  });

  it("reports an unknown attempt as needs-you, never as a failure or a copy", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const harness = renderRun([UNVERIFIED]);

    await writeOnce(harness, 1);

    expect(heard.symbols).toEqual(["needs-you"]);
    expect(toastStore.getState().toasts[0]?.kind).toBe("unverified");
    expect(toastStore.getState().toasts[0]?.severity).toBe("warning");
  });

  it("reports an attempt the Reader failed outright, and records it", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const backend = fakeBackend({
      lf_clone_attempt: () => {
        throw new Error("I/O Timeout: the reader stopped answering");
      },
    });
    const { user } = renderUi(<BatchClone source={SOURCE} connected onExit={() => {}} />);

    await user.click(screen.getByRole("button", { name: /Write the blank on the reader/ }));

    await waitFor(() => expect(backend.callsTo("lf_clone_attempt")).toHaveLength(1));
    // Heard with the remedy, and as attention: a wedged Reader is present and
    // broken, so the operation failed — "failed, nothing changed" in the spec's
    // table. A warning said "completed, result needs checking", which this is not.
    expect(heard.symbols).toEqual(["attention"]);
    expect(toastStore.getState().toasts[0]?.kind).toBe("reader-wedged");
    // And it stays in the ledger as an attempt that produced nothing, so a run
    // cannot lose a press.
    const ledger = screen.getByText("Attempts").parentElement as HTMLElement;
    expect(within(ledger).getAllByRole("listitem")).toHaveLength(1);
    expect(within(ledger).getByText("Failed")).toBeTruthy();
  });
});

describe("the run's confirmed copy count", () => {
  it("rises once per verified write and never for a skip, a refusal or an unknown", async () => {
    const harness = renderRun([
      VERIFIED,
      { ...VERIFIED, confirmedCopies: 2 },
      SKIPPED,
      REFUSED,
      UNVERIFIED,
    ]);

    await writeOnce(harness, 1);
    await writeOnce(harness, 2);
    await writeOnce(harness, 3);
    await writeOnce(harness, 4);
    await writeOnce(harness, 5);

    // Two verified writes out of five attempts: two copies, said both beside the
    // button and in the run's summary of every kind counted separately.
    expect(screen.getAllByText(/2 confirmed copies made by this run/)).toHaveLength(2);
    expect(
      screen.getByText(
        "5 attempts: 2 verified, 1 skipped, 1 unknown, 1 refused. 2 confirmed copies made by this run.",
      ),
    ).toBeTruthy();
  });

  it("is the same rule the batch module applies, not a second one", async () => {
    // The component renders `runConfirmedCopies`, so this pins the rule itself:
    // a skip, a refusal, an unknown and a failure all leave the count alone.
    const run = [VERIFIED, SKIPPED, REFUSED, UNVERIFIED, attempt("failed")]
      .reduce((acc, result) => recordAttempt(acc, result), startBatch(SOURCE));
    expect(runConfirmedCopies(run)).toBe(1);
    expect(run.attempts).toHaveLength(5);
  });
});

describe("nothing but an attempt is heard", () => {
  it("raises no message and no signal from the run itself", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const harness = renderRun([VERIFIED]);

    // The run opening reports nothing: reading its facts, holding the Reader and
    // pausing polling are conditions, not outcomes.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(heard.symbols).toEqual([]);
    expect(toastStore.getState().toasts).toHaveLength(0);

    await writeOnce(harness, 1);
    // One attempt, one outcome. Not two.
    expect(heard.symbols).toEqual(["done"]);
    expect(toastStore.getState().toasts).toHaveLength(1);
  });

  it("polls not at all while a run is open, so no poll can be heard or mistaken for an attempt", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    // A poller that would answer if it were ever asked. It must never be asked:
    // the run holds the Reader for its whole length.
    const backend = fakeBackend({
      lf_poll: () => SOURCE,
      lf_clone_attempt: () => VERIFIED,
    });
    const { user } = renderUi(<BatchMode connected />);

    await user.click(screen.getByRole("button", { name: /Read the tag to copy/ }));
    await screen.findByRole("button", { name: /Write the blank on the reader/ });
    const pollsForTheSource = backend.callsTo("lf_poll").length;

    await writeOnce({ backend, user } as ReturnType<typeof renderRun>, 1);
    await new Promise((resolve) => setTimeout(resolve, 900));

    // The source read was one operation and one signal; nothing else was polled.
    expect(backend.callsTo("lf_poll")).toHaveLength(pollsForTheSource);
    expect(heard.symbols).toEqual(["done", "done"]);
  });
});
