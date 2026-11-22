// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { CloneWizard } from "./CloneWizard";
import { fakeBackend, renderUi, type CommandAnswer } from "../test/dom";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { toastStore, type Toast } from "../lib/toastStore";
import { replacementConfirmation } from "../lib/replacement";
import type { LfCard, WriteOutcome, WriteResult } from "../types";

/**
 * Ticket 13 — a Clone reports its own outcomes, including the ones that fail.
 *
 * The wizard is two reads and a write, and each of the three is an operation the
 * user waits through, so each ends in exactly one outcome that reaches both
 * channels. What is asserted here, from the outside:
 *
 *   * the source read and the destination read are reported separately, once
 *     each, from the reading that completes the step — never from a poll;
 *   * a verified write is *done*, a write whose read-back cannot confirm it is
 *     *needs you* and is never rendered as a failure, and a refusal is audible as
 *     a refusal;
 *   * the two refusal conditions are named apart, because they have two
 *     different fixes;
 *   * nothing reaches the beeper except through the seam: the wizard takes no
 *     callback that could make a sound, so every chirp here came from `report`.
 */

const SOURCE: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

const DEST: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "77 00 AB CD EF",
};

/** The guard's refusal when nothing could be read in the write position. */
const UNREADABLE =
  "could not read the tag on the reader, so refusing to write blind. Put a blank 125 kHz " +
  "tag on the reader and try again.";

/** The guard's refusal when the Tag already presents the Identity being written. */
const ALREADY_CARRIES =
  "the tag on the reader already reads as 55 00 84 82 12 — that looks like the original " +
  "tag. Take it off and put a blank tag on instead.";

function result(outcome: WriteOutcome, overrides: Partial<WriteResult> = {}): WriteResult {
  return {
    customer: SOURCE.customer,
    data32: SOURCE.data32,
    readback: outcome === "verified" ? SOURCE : null,
    outcome,
    verified: outcome === "verified",
    message: null,
    refusalCause: null,
    confirmedCopies: outcome === "verified" ? 1 : 0,
    countProblem: null,
    ...overrides,
  };
}

const ACTION = replacementConfirmation(SOURCE, { kind: "identified", card: DEST }).action;

beforeEach(() => {
  toastStore.clear();
});

/** Everything the audible half was told, and the stop function. */
function hearSignals(): { symbols: SignalSymbol[]; stop: () => void } {
  const symbols: SignalSymbol[] = [];
  return { symbols, stop: subscribeSignals((symbol) => symbols.push(symbol)) };
}

/** The newest message on screen. */
function newestToast(): Toast | undefined {
  return toastStore.getState().toasts[0];
}

/**
 * Render the wizard.
 *
 * There is no sound-making prop to spy on, which is the point: the type has none,
 * so a test cannot hand the wizard a second way to beep. Everything audible in
 * this file arrives through `report(outcome)` and is heard by `subscribeSignals`.
 */
function renderWizard(answers: Record<string, CommandAnswer>) {
  const backend = fakeBackend(answers);
  const ui = renderUi(<CloneWizard connected onDeviceError={() => {}} />);
  return { backend, ...ui };
}

/** Read the original, then the destination, and stop on the confirmation. */
async function upToConfirmation(answers: Record<string, CommandAnswer>) {
  const reads: (LfCard | null)[] = [SOURCE, DEST];
  const harness = renderWizard({ lf_poll: () => reads.shift() ?? DEST, ...answers });
  await harness.user.click(screen.getByRole("button", { name: "Start clone" }));
  await harness.user.click(await screen.findByRole("button", { name: "Use this tag" }));
  await screen.findByRole("button", { name: ACTION });
  return harness;
}

let stopHearing: (() => void) | null = null;
afterEach(() => {
  stopHearing?.();
  stopHearing = null;
});

describe("the reads a clone is made of", () => {
  it("reports the source read and the destination read as their own outcomes", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { backend } = await upToConfirmation({ lf_write: () => result("verified") });
    void backend;

    // The newest first: the destination read is what just happened, the source
    // read is the one before it. Two reads, two messages.
    expect(newestToast()?.message).toBe(`Read ${DEST.id} — the tag in the write position.`);
    expect(toastStore.getState().toasts.map((t) => t.message)).toContain(
      `Read ${SOURCE.id} — the original.`,
    );
    // Each read is one completed operation, so each is one chirp — and the
    // wizard is now waiting on the confirmation.
    expect(heard.symbols).toEqual(["done", "done"]);
  });

  it("signals nothing while it is merely waiting for a tag", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    // A poll that latches nothing is background work: it is not an outcome, so
    // it makes no sound and raises no message however many times it runs.
    const { backend, user } = renderWizard({ lf_poll: () => null });

    await user.click(screen.getByRole("button", { name: "Start clone" }));
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(backend.callsTo("lf_poll").length).toBeGreaterThan(1);
    expect(heard.symbols).toEqual([]);
    expect(toastStore.getState().toasts).toHaveLength(0);
  });

  it("names the original left on the reader once, and keeps listening for the blank", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    // The original is read as the source, then read again in the write position,
    // and only then is a blank put on.
    const reads: (LfCard | null)[] = [SOURCE, SOURCE, DEST];
    const { backend, user } = renderWizard({
      lf_poll: () => reads.shift() ?? DEST,
      lf_write: () => result("verified"),
    });

    await user.click(screen.getByRole("button", { name: "Start clone" }));
    await user.click(await screen.findByRole("button", { name: "Use this tag" }));

    // The same condition the guard refuses a write on, caught at the read and
    // reported as a skip: a refusal, so attention — with the words that say it is
    // the wrong Tag rather than a failed read.
    const skipped = toastStore
      .getState()
      .toasts.filter((t) => t.kind === "skipped")
      .map((t) => t.message);
    await waitFor(() => expect(skipped).toHaveLength(1));
    expect(skipped[0]).toContain(SOURCE.id);

    // And the flow recovers by itself: the poller never stopped, so the blank
    // that was tapped afterwards is read without another click.
    await screen.findByRole("button", { name: ACTION }, { timeout: 3000 });
    // Three operations were heard: source read, the skip, the destination read.
    expect(heard.symbols).toEqual(["done", "attention", "done"]);
    expect(backend.callsTo("lf_write")).toHaveLength(0);
  });
});

describe("what the write came to", () => {
  it("reports a verified write as done, and the sound is one chirp", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { user } = await upToConfirmation({ lf_write: () => result("verified", { confirmedCopies: 1 }) });

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => expect(newestToast()?.kind).toBe("verified"));
    expect(newestToast()?.severity).toBe("success");
    expect(newestToast()?.message).toBe(
      "Verified — the tag reads 55 00 84 82 12. The library now lists 1 confirmed copy of it.",
    );
    expect(heard.symbols).toEqual(["done", "done", "done"]);
    // The evidence is on screen under the message.
    expect(screen.getByText("Cloned and verified")).toBeTruthy();
  });

  it("reports a read-back that could not confirm it as needs-you, never as failure", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { user } = await upToConfirmation({
      lf_write: () => result("unverified", { confirmedCopies: 0 }),
    });

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => expect(newestToast()?.kind).toBe("unverified"));
    // Two chirps: the write completed and wants checking. Three would say it
    // failed, and nobody established that.
    expect(heard.symbols).toEqual(["done", "done", "needs-you"]);
    expect(newestToast()?.message).toContain("Unknown");
    // The end state says the same thing, and never calls this a failure.
    expect(screen.getByText(/Unknown — the tag did not read back/)).toBeTruthy();
    expect(screen.queryByText(/could not be sent/)).toBeNull();
    expect(screen.queryByText(/Not written/)).toBeNull();
  });

  it("names the unreadable write position as its own refusal, with its own fix", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { user } = await upToConfirmation({
      lf_write: () =>
        result("refused", { refusalCause: "unreadable", message: UNREADABLE }),
    });

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => expect(newestToast()?.kind).toBe("unreadable"));
    expect(newestToast()?.severity).toBe("error");
    // The guard's own words, and nothing counted: a refusal is not a copy.
    expect(newestToast()?.message).toContain(`Not written: ${UNREADABLE}`);
    expect(newestToast()?.message).toContain("No confirmed copies");
    // Three chirps: refused, and nothing changed.
    expect(heard.symbols).toEqual(["done", "done", "attention"]);
    expect(screen.getByText(/Not written — nothing readable on the reader/)).toBeTruthy();
    expect(screen.queryByText(/already carries this identity/)).toBeNull();
  });

  it("names a tag that already carries the Identity as a skip, not as a failure", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { user } = await upToConfirmation({
      lf_write: () =>
        result("refused", { refusalCause: "already-carries", message: ALREADY_CARRIES }),
    });

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => expect(newestToast()?.kind).toBe("skipped"));
    // Attention, like every refusal: the spec's table gives three chirps to
    // "failed, refused, or the tag will not accept the write; nothing changed".
    // The word "Skipped" and the advice below carry "this tag read fine, it is the
    // wrong one" — that was never the tone's job, and two chirps made it sound
    // like a result that merely wants checking.
    expect(newestToast()?.severity).toBe("error");
    expect(newestToast()?.message.startsWith("Skipped:")).toBe(true);
    expect(heard.symbols).toEqual(["done", "done", "attention"]);
    expect(screen.getByText(/Skipped — the tag already carries this identity/)).toBeTruthy();
    expect(screen.queryByText(/nothing readable on the reader/)).toBeNull();
  });

  it("reports a write the Reader could not send as a failure with its remedy", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { user } = await upToConfirmation({
      lf_write: () => {
        throw new Error("I/O Timeout: the reader stopped answering");
      },
    });

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => expect(newestToast()?.kind).toBe("reader-wedged"));
    expect(heard.symbols).toEqual(["done", "done", "attention"]);
    // The Reader's own failure, with the remedy the classification carries — and
    // never a claim that the write was refused.
    expect(screen.getByText("The Reader stopped responding")).toBeTruthy();
    expect(screen.getByText(/Unplug the Reader/)).toBeTruthy();
  });
});

describe("the beeper in this flow", () => {
  it("is reached only through the outcome seam", async () => {
    const heard = hearSignals();
    stopHearing = heard.stop;
    const { user } = await upToConfirmation({ lf_write: () => result("verified") });

    await user.click(screen.getByRole("button", { name: ACTION }));
    await waitFor(() => expect(newestToast()?.kind).toBe("verified"));

    // Three operations, three signals, and every one of them arrived through
    // `report`. The wizard takes no callback that could make a sound, so there is
    // no second channel for a test to observe and none for the app to use.
    expect(heard.symbols).toHaveLength(3);
    expect(toastStore.getState().toasts.length).toBeGreaterThanOrEqual(3);
  });
});
