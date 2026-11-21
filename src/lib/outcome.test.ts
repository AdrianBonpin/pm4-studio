import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_OUTCOME_KINDS,
  legacyChirp,
  outcomes,
  report,
  severityOf,
  signalFor,
  type Outcome,
  type OutcomeKind,
  type Severity,
} from "./outcome";
import { subscribeSignals, type SignalSymbol } from "./signal";
import { toastStore } from "./toastStore";
import { BUILD_REFUSAL_LABEL } from "./consoleRefusal";
import { writeNotice } from "./writeOutcome";
import { blankNotice } from "./blankTag";
import { eraseNotice } from "./eraseTag";
import type { BlankResult, EraseResult, WriteResult } from "../types";
import type { LibraryView, SaveResult, Snapshot } from "./library";

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
  saved: "success",
  "already-saved": "info",
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


/** A Snapshot as a save would return it. */
const SAVED_SNAPSHOT: Snapshot = {
  id: "55 00 84 82 12",
  name: "Front door",
  note: "",
  kind: "LF",
  capturedAt: "2026-11-21T09:30:00.000Z",
  writeCount: 0,
  identity: {
    customer: 0x55,
    data32: 0x0084_8212,
    facility: 132,
    card: 33298,
    raw: "00 01 01 00",
  },
};

/** The library file a save answers with, or the problem that refused it. */
function savedResult(outcome: SaveResult["outcome"]): SaveResult {
  const library: LibraryView = {
    path: "/Users/someone/Library/Application Support/pm4-studio/library.json",
    version: 3,
    snapshots: outcome === "refused" ? [] : [SAVED_SNAPSHOT],
    problem:
      outcome === "refused"
        ? {
            kind: "newerVersion",
            message:
              "This library was written by a newer version of PM4 Studio (schema 4; this build " +
              "understands 3). It has been left exactly as it is, because saving would downgrade it.",
            detail: null,
          }
        : null,
    migrationWarning: null,
  };
  return {
    outcome,
    library,
    snapshot: outcome === "refused" ? null : SAVED_SNAPSHOT,
  };
}

describe("the discriminator set", () => {
  it("is closed, and every discriminator is named here deliberately", () => {
    expect([...ALL_OUTCOME_KINDS].sort()).toEqual(
      [
        "already-saved",
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
        "saved",
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
    outcomes.erase(ERASE),
    outcomes.resetRefused("because"),
    outcomes.refusedByBuild({ kind: "refusedByBuild", cmd: "0x0073", message: "no" }),
    outcomes.refusedByReader("the frame was malformed"),
    outcomes.readerFailure("no such device"),
    outcomes.announcement("Saved."),
    outcomes.librarySaved(savedResult("added")),
    outcomes.librarySaved(savedResult("duplicate")),
    outcomes.librarySaved(savedResult("refused")),
    outcomes.librarySaveFailed("the library file could not be reached"),
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

/**
 * Keeping a read in the library.
 *
 * The store answers with what it did, and that answer is the outcome: a save, a
 * repeat, and a file this build must not write to are three different things and
 * must not arrive as one silence. A duplicate is informational and silent — it
 * changed nothing, which is exactly what silence means (ADR 0009) — while still
 * being said, because a save that vanishes looks like a save that failed.
 */
describe("saving a read to the library", () => {
  it("reports a save as a success, and sounds one chirp", () => {
    const { symbols, stop } = hearSignals();

    report(outcomes.librarySaved(savedResult("added")));

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("Saved to the library as Front door.");
    expect(toast?.kind).toBe("saved");
    expect(toast?.severity).toBe("success");
    expect(symbols).toEqual(["done"]);
    stop();
  });

  it("reports a repeat read as already saved, visibly and silently", () => {
    const { symbols, stop } = hearSignals();

    report(outcomes.librarySaved(savedResult("duplicate")));

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("Already in the library as Front door.");
    expect(toast?.kind).toBe("already-saved");
    expect(toast?.severity).toBe("info");
    expect(symbols).toEqual([]);
    stop();
  });

  it("reports a file this build must not write to as a refusal, in the file's own words", () => {
    const outcome = outcomes.librarySaved(savedResult("refused"));

    expect(outcome.kind).toBe("refused");
    expect(outcome.severity).toBe("error");
    expect(outcome.message).toContain("newer version of PM4 Studio");
  });

  it("reports a save that never reached the store, keeping its own words", () => {
    const outcome = outcomes.librarySaveFailed("  the app data directory is not writable  ");

    expect(outcome.kind).toBe("failed");
    expect(outcome.operation).toBe("library");
    expect(outcome.message).toBe("The read could not be saved to the library.");
    expect(outcome.detail).toBe("the app data directory is not writable");
    expect(outcomes.librarySaveFailed("").detail).toBeUndefined();
  });
});
