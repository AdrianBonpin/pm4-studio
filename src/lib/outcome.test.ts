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
import { ATTENTION_LED_HOLD_MS, chirpSequenceForOutcome } from "./chirpSequence";
import { subscribeSignals, type SignalSymbol } from "./signal";
import { toastStore } from "./toastStore";
import { BUILD_REFUSAL_LABEL } from "./consoleRefusal";
import { writeNotice } from "./writeOutcome";
import { blankNotice } from "./blankTag";
import { eraseNotice } from "./eraseTag";
import type { BlankResult, EraseResult, WriteResult } from "../types";

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
  "data-cleared": "success",
  unverified: "warning",
  refused: "error",
  failed: "error",
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
    confirmedCopies: outcome === "verified" ? 1 : 0,
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

/** A Reset the tag refused: the re-read still found an Identity (ADR 0007). */
const WILL_NOT_ACCEPT: BlankResult = {
  customer: 0x55,
  data32: 0x0084_8212,
  outcome: "willNotAcceptWrites",
  blanked: false,
  stillIdentifies: "55 00 84 82 12",
  message: "the tag still reads as 55 00 84 82 12 after the blanking write",
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
        "data-cleared",
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

  it("takes a clear-data report the way the Settings page shows it", () => {
    // One report, one set of words: the message and the page cannot disagree,
    // and the tone is the report's, not a call site's choice.
    const cleared = outcomes.dataCleared({
      cleared: true,
      removed: [{ target: "libraryFile", detail: "/x/library.json", bytes: 12 }],
      blocked: null,
    });
    expect(cleared.kind).toBe("data-cleared");
    expect(cleared.severity).toBe("success");
    expect(cleared.message).toBe("Cleared all saved data.");

    const nothing = outcomes.dataCleared({ cleared: true, removed: [], blocked: null });
    expect(nothing.kind).toBe("announcement");
    expect(nothing.message).toBe("There was nothing saved to clear.");

    const refused = outcomes.dataCleared({
      cleared: false,
      removed: [],
      blocked: { target: "staleTemp", detail: "/x/library.json.tmp", reason: "it is a directory" },
    });
    expect(refused.kind).toBe("refused");
    expect(refused.severity).toBe("error");
    expect(refused.message).toBe(
      "Nothing was cleared: the temporary file a save may have left beside it could not be removed.",
    );
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

  it("is classified apart from a failure and from an unknown", () => {
    // The three call for different next actions, so the discriminators differ:
    // the write was sent, it did not take, and the tag's state is known.
    const refusedWrites = outcomes.blank(WILL_NOT_ACCEPT);
    const failed = outcomes.blank({ ...WILL_NOT_ACCEPT, outcome: "failed", message: "no" });
    const unknown = outcomes.blank({ ...WILL_NOT_ACCEPT, outcome: "unverified", message: "no" });

    expect(refusedWrites.kind).toBe("reset-refused");
    expect(failed.kind).toBe("failed");
    expect(unknown.kind).toBe("unverified");
    expect(refusedWrites.kind).not.toBe(failed.kind);
    expect(refusedWrites.kind).not.toBe(unknown.kind);
    // ...and never as a blank or as a copy.
    expect(refusedWrites.kind).not.toBe("blanked");
    expect(refusedWrites.kind).not.toBe("verified");
  });

  it("keeps the blanking copy's words rather than inventing its own", () => {
    expect(outcomes.blank(WILL_NOT_ACCEPT).message).toBe(blankNotice(WILL_NOT_ACCEPT).text);
    expect(outcomes.blank(WILL_NOT_ACCEPT).message).toContain("will not accept writes");
    expect(outcomes.blank(WILL_NOT_ACCEPT).message).toMatch(/already (been )?written/i);
    expect(outcomes.blank(WILL_NOT_ACCEPT).message).toMatch(/never writable/i);
  });

  it("emits the attention symbol, with the LED held on for two seconds", () => {
    // The signal machinery is ticket 04's; this ticket's job is to reach it.
    const outcome = outcomes.blank(WILL_NOT_ACCEPT);
    expect(signalOf(outcome)).toBe("attention");

    const sequence = chirpSequenceForOutcome(outcome);
    expect(sequence.chirps).toBe(3);
    expect(sequence.holdLedMs).toBe(ATTENTION_LED_HOLD_MS);
    expect(sequence.holdLedMs).toBe(2_000);
  });

  it("reports a refusal through the seam, on both channels", () => {
    const { symbols, stop } = hearSignals();

    report(outcomes.blank(WILL_NOT_ACCEPT));

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toContain("will not accept writes");
    expect(toast?.severity).toBe("error");
    expect(symbols).toEqual(["attention"]);
    stop();
  });

  it("never counts a confirmed copy for any outcome of the operation", () => {
    // Reset places nothing, so no outcome of it may raise a Snapshot's count —
    // and the refusal may not be worded as though it did.
    for (const result of [BLANK, WILL_NOT_ACCEPT]) {
      const outcome = outcomes.blank(result);
      expect(outcome.message).not.toMatch(/confirmed cop(y|ies)/i);
      expect(outcome.kind).not.toBe("verified");
    }
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
    outcomes.blank(WILL_NOT_ACCEPT),
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
