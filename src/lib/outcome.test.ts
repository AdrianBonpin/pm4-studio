import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_OUTCOME_KINDS,
  legacyChirp,
  outcomes,
  report,
  severityOf,
  signalFor,
  signalOf,
  type Outcome,
  type OutcomeKind,
  type Severity,
} from "./outcome";
import { subscribeSignals, type SignalSymbol } from "./signal";
import { toastStore } from "./toastStore";
import { BUILD_REFUSAL_LABEL } from "./consoleRefusal";
import { writeNotice } from "./writeOutcome";
import { attemptNotice } from "./batchClone";
import { blankNotice } from "./blankTag";
import { eraseNotice } from "./eraseTag";
import type { BatchAttemptResult, BlankResult, EraseResult, WriteResult } from "../types";

/**
 * The outcome seam: one typed value, one entry point, two channels.
 *
 * Three claims are structural rather than a matter of care, and this file is
 * where they are checked:
 *
 *   * the discriminator set is closed, and every discriminator has one severity
 *     in one table — no call site chooses a severity;
 *   * the signal is derived from the severity, so a message and the signal it
 *     would produce cannot disagree;
 *   * `report` is the only way an outcome reaches either channel, and an
 *     informational outcome is visible but silent.
 */

beforeEach(() => {
  toastStore.clear();
});

/** Severity per discriminator, written out again so a silent edit to the table fails here. */
const EXPECTED_SEVERITY: Record<OutcomeKind, Severity> = {
  read: "success",
  "beep-test": "success",
  "nothing-latched": "info",
  "read-incomplete": "warning",
  verified: "success",
  blanked: "success",
  erased: "success",
  unverified: "warning",
  refused: "error",
  failed: "error",
  skipped: "warning",
  unreadable: "error",
  "reset-refused": "error",
  "refused-by-build": "error",
  "reader-absent": "warning",
  "reader-claimed": "error",
  "reader-wedged": "warning",
  "reader-failure": "error",
  announcement: "info",
};

/** The symbol each severity must produce. Silent is a symbol, not a fallback. */
const EXPECTED_SIGNAL: Record<Severity, SignalSymbol> = {
  success: "done",
  warning: "needs-you",
  error: "attention",
  info: "silent",
};

function writeResult(outcome: WriteResult["outcome"], overrides: Partial<WriteResult> = {}): WriteResult {
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

/** One batch attempt, as `lf_clone_attempt` reports it. */
function attempt(
  outcome: BatchAttemptResult["outcome"],
  overrides: Partial<BatchAttemptResult> = {},
): BatchAttemptResult {
  return {
    customer: 0x55,
    data32: 0x0084_8212,
    outcome,
    message: null,
    refusalCause: null,
    readback: null,
    confirmedCopies: null,
    countProblem: null,
    ...overrides,
  };
}

const BLANK: BlankResult = {
  customer: 0x55,
  data32: 0x0084_8212,
  outcome: "blanked",
  blanked: true,
  stillIdentifies: null,
  message: null,
};

const ERASE: EraseResult = {
  outcome: "erased",
  message: null,
  before: null,
  after: null,
  capacityBytes: 144,
  clearedBytes: 10,
  erasePages: [4],
  acceptedPages: [4],
  identityIntact: true,
  writtenHex: "03 00 FE",
};

/** Collect everything the audible half is told, for one test. */
function hearSignals(): { symbols: SignalSymbol[]; stop: () => void } {
  const symbols: SignalSymbol[] = [];
  const stop = subscribeSignals((symbol) => symbols.push(symbol));
  return { symbols, stop };
}

describe("the discriminator set", () => {
  it("is closed, and every discriminator is named here deliberately", () => {
    expect([...ALL_OUTCOME_KINDS].sort()).toEqual(
      [
        "announcement",
        "beep-test",
        "blanked",
        "erased",
        "failed",
        "nothing-latched",
        "read",
        "read-incomplete",
        "reader-absent",
        "reader-claimed",
        "reader-failure",
        "reader-wedged",
        "refused",
        "refused-by-build",
        "reset-refused",
        "skipped",
        "unreadable",
        "unverified",
        "verified",
      ].sort(),
    );
  });

  it("gives every discriminator one severity, in one table", () => {
    for (const kind of ALL_OUTCOME_KINDS) {
      expect(severityOf(kind), kind).toBe(EXPECTED_SEVERITY[kind]);
    }
  });

  it("derives the signal from the severity, so the two cannot disagree", () => {
    for (const kind of ALL_OUTCOME_KINDS) {
      expect(signalFor(severityOf(kind)), kind).toBe(EXPECTED_SIGNAL[EXPECTED_SEVERITY[kind]]);
    }
  });

  it("has no silent success, warning or error: silence means nothing happened", () => {
    expect(signalFor("success")).toBe("done");
    expect(signalFor("warning")).toBe("needs-you");
    expect(signalFor("error")).toBe("attention");
    expect(signalFor("info")).toBe("silent");
  });
});

describe("report", () => {
  it("is the one entry point: one call reaches both channels", () => {
    const { symbols, stop } = hearSignals();
    const outcome = outcomes.tagRead("read", "55 00 84 82 12");

    report(outcome);

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("Read 55 00 84 82 12.");
    expect(toast?.severity).toBe("success");
    expect(symbols).toEqual(["done"]);
    stop();
  });

  it("carries the severity the vocabulary chose, not the one a caller wanted", () => {
    for (const outcome of [
      outcomes.tagRead("read", "55 00 84 82 12"),
      outcomes.write("write", writeResult("unverified")),
      outcomes.write("write", writeResult("failed")),
      outcomes.nothingLatched("read"),
      outcomes.announcement("Feedback preferences saved."),
    ]) {
      expect(outcome.severity).toBe(severityOf(outcome.kind));
    }
  });

  it("shows an announcement and keeps it silent", () => {
    const { symbols, stop } = hearSignals();

    report(outcomes.announcement("Messages now appear in the bottom-left corner."));

    expect(toastStore.getState().toasts).toHaveLength(1);
    expect(symbols).toEqual([]);
    stop();
  });

  it("drops the signal for an outcome whose severity is silent", () => {
    const { symbols, stop } = hearSignals();

    report(outcomes.nothingLatched("read"));

    expect(toastStore.getState().toasts).toHaveLength(1);
    expect(symbols).toEqual([]);
    stop();
  });
});

describe("a 13.56 MHz read", () => {
  it("that fetched everything it went for is one success", () => {
    const outcome = outcomes.hfRead("04 43 8A 01 22 09 03", "2 Records");

    expect(outcome.kind).toBe("read");
    expect(outcome.operation).toBe("hf-read");
    expect(outcome.severity).toBe("success");
    expect(outcome.message).toBe("Read 04 43 8A 01 22 09 03 — 2 Records.");
    expect(signalFor(severityOf(outcome.kind))).toBe("done");
  });

  it("that finished but needs checking is its own warning, not a success", () => {
    const outcome = outcomes.hfReadIncomplete(
      "04 43 8A 01 22 09 03",
      "the memory read timed out",
    );

    expect(outcome.kind).toBe("read-incomplete");
    expect(outcome.operation).toBe("hf-read");
    expect(outcome.severity).toBe("warning");
    expect(outcome.message).toBe("Read 04 43 8A 01 22 09 03, but its Records could not be read.");
    expect(outcome.detail).toBe("the memory read timed out");
    expect(signalFor(severityOf(outcome.kind))).toBe("needs-you");
  });

  it("keeps read-fully and read-but-check distinguishable to the ear", () => {
    const done = signalFor(severityOf(outcomes.hfRead("04 43", "no Records").kind));
    const check = signalFor(
      severityOf(outcomes.hfReadIncomplete(null, "no card type resolved").kind),
    );
    expect(done).not.toBe(check);
  });
});

describe("an outcome built from the write-outcome vocabulary", () => {
  it("words a write from the existing notice and keeps its severity", () => {
    const cases: [WriteResult["outcome"], OutcomeKind][] = [
      ["verified", "verified"],
      ["refused", "refused"],
      ["unverified", "unverified"],
      ["failed", "failed"],
    ];
    for (const [result, kind] of cases) {
      const write = writeResult(result, { message: "the tag refused the write" });
      const outcome = outcomes.write("write", write);
      expect(outcome.kind).toBe(kind);
      expect(outcome.message).toBe(writeNotice(write).text);
      expect(outcome.operation).toBe("write");
    }
  });

  it("never words a copy write that reported a blanked or erased tag as success", () => {
    for (const result of ["blanked", "erased"] as const) {
      const outcome = outcomes.write("write", writeResult(result));
      expect(outcome.kind).toBe("failed");
      expect(outcome.severity).toBe("error");
    }
  });

  it("words blanking with the blanking copy, and calls it Reset", () => {
    const outcome = outcomes.blank(BLANK);
    expect(outcome.kind).toBe("blanked");
    expect(outcome.message).toBe(blankNotice(BLANK).text);
    expect(outcome.operation).toBe("reset");
  });

  it("words erasing with the erasing copy", () => {
    const outcome = outcomes.erase(ERASE);
    expect(outcome.kind).toBe("erased");
    expect(outcome.message).toBe(eraseNotice(ERASE).text);
    expect(outcome.operation).toBe("erase");
  });
});

describe("a Reset the tag would not accept", () => {
  it("is its own outcome, names the likely cause, and says nothing changed", () => {
    const outcome = outcomes.resetRefused("The Reader stopped answering during the write.");

    expect(outcome.kind).toBe("reset-refused");
    expect(outcome.severity).toBe("error");
    expect(outcome.operation).toBe("reset");
    expect(outcome.message).toContain("will not accept writes");
    expect(outcome.detail).toContain("The Reader stopped answering during the write.");
    expect(outcome.detail).toContain("cannot tell which kind");
    expect(outcome.detail).toContain("Nothing was written");
  });
});

describe("a refusal about the build and a refusal about the tag", () => {
  it("are different outcomes with different messages", () => {
    const build = outcomes.refusedByBuild({
      kind: "refusedByBuild",
      cmd: "0x0073",
      message: "this build sends only commands that cannot change a tag",
    });
    const tag = outcomes.refusedByReader("the tag in position is write-protected");

    expect(build.kind).toBe("refused-by-build");
    expect(tag.kind).toBe("refused");
    expect(build.message).not.toBe(tag.message);
    // One says to change what you are sending; the other says to look at the tag.
    expect(build.message).toContain(BUILD_REFUSAL_LABEL);
    expect(build.detail).toContain("build");
    expect(tag.detail).toContain("tag in position");
    // Both are failures, and both are audible as such.
    expect(build.severity).toBe("error");
    expect(tag.severity).toBe("error");
  });
});

describe("a device failure", () => {
  it("keeps the remedy the shell's strip carried, and its reconnect action", () => {
    const reconnect = vi.fn();
    const outcome = outcomes.readerFailure("I/O Timeout: the reader stopped answering", {
      action: { label: "Reconnect", run: reconnect },
    });

    expect(outcome.kind).toBe("reader-wedged");
    expect(outcome.severity).toBe("warning");
    expect(outcome.operation).toBe("reader");
    expect(outcome.message).toBe("The Reader stopped responding");
    expect(outcome.detail).toContain("Unplug the Reader");

    report(outcome);
    const [toast] = toastStore.getState().toasts;
    toast?.action?.run();
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("is an error when the Reader is held by another process", () => {
    const outcome = outcomes.readerFailure("kIOReturnExclusiveAccess");
    expect(outcome.kind).toBe("reader-claimed");
    expect(outcome.severity).toBe("error");
  });

  it("is a warning when no Reader is attached, and keeps the plug-in remedy", () => {
    const outcome = outcomes.readerFailure("no such device: failed to open the Reader");
    expect(outcome.kind).toBe("reader-absent");
    expect(outcome.severity).toBe("warning");
    expect(outcome.detail).toContain("Plug the NFC-PM4 Reader");
  });

  it("keeps an unclassified failure's own words rather than inventing a cause", () => {
    const outcome = outcomes.readerFailure("something the classifier does not know");
    expect(outcome.kind).toBe("reader-failure");
    expect(outcome.severity).toBe("error");
    expect(outcome.message).toBe("something the classifier does not know");
  });
});

describe("the two conditions a write can be refused on", () => {
  /** Nothing readable in the write position. */
  const unreadable = () =>
    writeResult("refused", {
      refusalCause: "unreadable",
      message: "could not read the tag on the reader, so refusing to write blind.",
    });

  /** The Tag already presents the Identity being written. */
  const alreadyCarries = () =>
    writeResult("refused", {
      refusalCause: "already-carries",
      message: "the tag on the reader already reads as 55 00 84 82 12.",
    });

  it("are two discriminators, not one refusal with two sentences", () => {
    const a = outcomes.write("clone", unreadable());
    const b = outcomes.write("clone", alreadyCarries());
    expect(a.kind).toBe("unreadable");
    expect(b.kind).toBe("skipped");
    expect(a.kind).not.toBe(b.kind);
    expect(a.message).not.toBe(b.message);
  });

  it("sound different, because the fixes are different", () => {
    // "seat a tag that reads" and "this is the original, swap it" are two
    // different errands. One is an error; the other is a skip, which needs you
    // but means nothing failed.
    const unreadableSignal = signalOf(outcomes.write("clone", unreadable()));
    const skipSignal = signalOf(outcomes.write("clone", alreadyCarries()));
    expect(unreadableSignal).toBe("attention");
    expect(skipSignal).toBe("needs-you");
    expect(unreadableSignal).not.toBe(skipSignal);
  });

  it("is still a plain refusal when no cause was reported", () => {
    // Fail safe: an older reply, or a refusal whose cause nobody established,
    // keeps the error rather than being softened into a skip.
    const unknown = outcomes.write("clone", writeResult("refused", { message: "no" }));
    expect(unknown.kind).toBe("refused");
    expect(unknown.severity).toBe("error");
  });

  it("never reclassifies a transmitted write from a stray cause", () => {
    // Only a refused write can name a cause: a verified or unknown write is
    // whatever its outcome said, whatever field arrived beside it.
    for (const result of ["verified", "unverified", "failed"] as const) {
      const outcome = outcomes.write("clone", writeResult(result, { refusalCause: "already-carries" }));
      expect(outcome.kind).not.toBe("skipped");
    }
  });
});

describe("the reads a clone is made of", () => {
  it("reports the source and the destination as their own reads", () => {
    const source = outcomes.cloneSourceRead("55 00 84 82 12");
    const dest = outcomes.cloneDestinationRead("77 00 AB CD EF");

    expect(source.kind).toBe("read");
    expect(dest.kind).toBe("read");
    expect(source.operation).toBe("clone");
    expect(dest.operation).toBe("clone");
    // Two reads, two messages: the wizard never reports the same sentence for
    // two different steps.
    expect(source.message).toContain("55 00 84 82 12");
    expect(dest.message).toContain("77 00 AB CD EF");
    expect(source.message).not.toBe(dest.message);
    // Both are a completed read, so both are one chirp.
    expect(signalOf(source)).toBe("done");
    expect(signalOf(dest)).toBe("done");
  });

  it("names the original left on the reader as a skip, not as a failed read", () => {
    const outcome = outcomes.cloneSourceStillInPlace("55 00 84 82 12");

    expect(outcome.kind).toBe("skipped");
    expect(outcome.operation).toBe("clone");
    expect(outcome.severity).toBe("warning");
    expect(outcome.message).toContain("55 00 84 82 12");
    expect(outcome.message).toMatch(/original/i);
    expect(outcome.detail).toMatch(/nothing was written/i);
    expect(signalOf(outcome)).toBe("needs-you");
  });
});

describe("one batch attempt", () => {
  const verified = attempt("verified", { readback: null, confirmedCopies: 2 });
  const skipped = attempt("skipped", {
    refusalCause: "already-carries",
    message: "the tag on the reader already reads as 55 00 84 82 12, so nothing was written.",
  });
  const refused = attempt("refused", {
    refusalCause: "unreadable",
    message: "could not read the tag on the reader, so refusing to write blind.",
  });
  const unverified = attempt("unverified", { message: "the tag could not be read back" });
  const failed = attempt("failed", { message: "the device is unplugged" });

  it("takes its vocabulary from the batch's own notice", () => {
    for (const result of [verified, skipped, refused, unverified, failed]) {
      const outcome = outcomes.batchAttempt(result);
      expect(outcome.message).toBe(attemptNotice(result).text);
      expect(outcome.operation).toBe("batch");
    }
  });

  it("keeps a skip, a refusal and a verified write three distinguishable results", () => {
    const results = [verified, skipped, refused].map((r) => outcomes.batchAttempt(r));

    expect(results.map((o) => o.kind)).toEqual(["verified", "skipped", "unreadable"]);
    // Three different messages...
    expect(new Set(results.map((o) => o.message)).size).toBe(3);
    // ...and three different sounds, so which fob worked is audible.
    expect(results.map((o) => signalOf(o))).toEqual(["done", "needs-you", "attention"]);
    expect(new Set(results.map((o) => signalOf(o))).size).toBe(3);
  });

  it("never lets a skip or a refusal be heard as a copy", () => {
    for (const result of [skipped, refused, unverified, failed]) {
      expect(signalOf(outcomes.batchAttempt(result))).not.toBe("done");
    }
  });

  it("reports an unknown attempt as needs-you rather than as a failure", () => {
    const outcome = outcomes.batchAttempt(unverified);
    expect(outcome.kind).toBe("unverified");
    expect(outcome.severity).toBe("warning");
    expect(signalOf(outcome)).toBe("needs-you");
  });
});

describe("the compatibility chirp", () => {
  it("still reaches the audible half, and raises no message", () => {
    const { symbols, stop } = hearSignals();

    legacyChirp();

    expect(symbols).toEqual(["done"]);
    expect(toastStore.getState().toasts).toHaveLength(0);
    stop();
  });
});

describe("the beeper test", () => {
  it("sounds, and says what was sent rather than what was heard", () => {
    // The firmware never acknowledges the beep frame, so a message claiming the
    // buzzer sounded would be a claim the app cannot support. What it can say is
    // that the signal a completed operation makes was sent.
    const { symbols, stop } = hearSignals();

    report(outcomes.beepTest());

    const [toast] = toastStore.getState().toasts;
    expect(toast?.severity).toBe("success");
    expect(symbols).toEqual(["done"]);
    expect(toast?.message ?? "").not.toMatch(/heard|sounded|confirmed/i);
    expect(toast?.detail ?? "").toMatch(/never confirms/i);
    stop();
  });

  it("says nothing was sent when there is no Reader, and does not pretend otherwise", () => {
    const outcome = outcomes.beepTestNoReader();

    expect(outcome.kind).toBe("reader-absent");
    expect(outcome.operation).toBe("preferences");
    expect(outcome.message).toBe("No signal was sent.");
    expect(outcome.severity).toBe("warning");
    expect(`${outcome.message} ${outcome.detail}`).not.toMatch(/heard|sounded/i);
  });

  it("says the quiet level muted it, visibly and silently", () => {
    // The level did what it was told, so there is a message to read and no sound
    // to hear — which is why this is an announcement rather than a success.
    const { symbols, stop } = hearSignals();

    report(outcomes.beepTestMuted("off"));

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("No signal was sent.");
    expect(toast?.severity).toBe("info");
    expect(toast?.detail ?? "").toContain("Off");
    expect(symbols).toEqual([]);
    stop();
  });
});

describe("every outcome the vocabulary can build", () => {
  const built: Outcome[] = [
    outcomes.tagRead("read", "55 00 84 82 12"),
    outcomes.tagRead("hf-read", "04 A2 24 5A 6C 71 80"),
    outcomes.nothingLatched("hf-read"),
    outcomes.write("batch", writeResult("verified")),
    outcomes.blank(BLANK),
    outcomes.erase(ERASE),
    outcomes.resetRefused("because"),
    outcomes.refusedByBuild({ kind: "refusedByBuild", cmd: "0x0073", message: "no" }),
    outcomes.refusedByReader("the frame was malformed"),
    outcomes.readerFailure("no such device"),
    outcomes.announcement("Saved."),
    outcomes.beepTest(),
    outcomes.beepTestNoReader(),
    outcomes.beepTestMuted("errors-and-warnings"),
  ];

  it("has a non-empty message, a discriminator in the set, and a known severity", () => {
    for (const outcome of built) {
      expect(outcome.message.trim(), outcome.kind).not.toBe("");
      expect(ALL_OUTCOME_KINDS, outcome.kind).toContain(outcome.kind);
      expect(outcome.severity, outcome.kind).toBe(severityOf(outcome.kind));
    }
  });

  it("is reported without throwing, through the one entry point", () => {
    for (const outcome of built) {
      expect(() => report(outcome)).not.toThrow();
    }
  });
});
