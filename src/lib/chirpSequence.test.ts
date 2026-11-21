import { describe, expect, it } from "vitest";
import {
  ATTENTION_LED_HOLD_MS,
  CHIRP_GAP_MS,
  chirpSequenceFor,
  chirpSequenceForOutcome,
} from "./chirpSequence";
import { outcomes, type Outcome } from "./outcome";
import { SIGNAL_SYMBOLS, type SignalSymbol } from "./signal";
import type { BlankResult, EraseResult, WriteResult } from "../types";

/**
 * The audible alphabet, as a pure value: an outcome in, a sequence out.
 *
 * Everything here is written down independently of the implementation — the
 * chirp count per symbol, the gap, the LED hold, and the symbol each outcome
 * must produce. A table read back out of the module under test would agree with
 * any edit, including a wrong one; these tables would not.
 *
 * What this file cannot settle: the real duration of one firmware chirp, and
 * therefore whether 120 ms makes one, two and three chirps distinguishable by
 * ear. That is tuning on hardware, and the spec records it as open.
 */

/** The count each symbol must produce, written out again on purpose. */
const EXPECTED_CHIRPS: Record<SignalSymbol, number> = {
  done: 1,
  "needs-you": 2,
  attention: 3,
  silent: 0,
};

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

/**
 * One row per kind of operation, with its sound written down: the symbol the
 * user hears, and how many chirps that is.
 */
const EXPECTED_OUTCOMES: readonly {
  readonly what: string;
  readonly outcome: Outcome;
  readonly symbol: SignalSymbol;
  readonly chirps: number;
}[] = [
  {
    what: "a 125 kHz read",
    outcome: outcomes.tagRead("read", "55 00 84 82 12"),
    symbol: "done",
    chirps: 1,
  },
  {
    what: "a complete 13.56 MHz read",
    outcome: outcomes.hfRead("04 43 8A 01 22 09 03", "2 Records"),
    symbol: "done",
    chirps: 1,
  },
  {
    what: "a verified write",
    outcome: outcomes.write("write", writeResult("verified")),
    symbol: "done",
    chirps: 1,
  },
  {
    what: "a Reset that left no Identity",
    outcome: outcomes.blank(BLANK),
    symbol: "done",
    chirps: 1,
  },
  {
    what: "an erase that cleared the message",
    outcome: outcomes.erase(ERASE),
    symbol: "done",
    chirps: 1,
  },
  {
    what: "the beeper test",
    outcome: outcomes.beepTest(),
    symbol: "done",
    chirps: 1,
  },
  {
    what: "the beeper test with no Reader attached",
    outcome: outcomes.beepTestNoReader(),
    symbol: "needs-you",
    chirps: 2,
  },
  {
    what: "the beeper test at a level that mutes it",
    outcome: outcomes.beepTestMuted("off"),
    symbol: "silent",
    chirps: 0,
  },
  {
    what: "a 13.56 MHz read whose Records are missing",
    outcome: outcomes.hfReadIncomplete("04 43 8A 01 22 09 03", "the memory read timed out"),
    symbol: "needs-you",
    chirps: 2,
  },
  {
    what: "a write the read-back could not confirm",
    outcome: outcomes.write("write", writeResult("unverified")),
    symbol: "needs-you",
    chirps: 2,
  },
  {
    what: "a Reader that is not plugged in",
    outcome: outcomes.readerFailure("no such device: failed to open the Reader"),
    symbol: "needs-you",
    chirps: 2,
  },
  {
    what: "a write that failed",
    outcome: outcomes.write("write", writeResult("failed")),
    symbol: "attention",
    chirps: 3,
  },
  {
    what: "a frame the Reader refused",
    outcome: outcomes.refusedByReader("the tag in position is write-protected"),
    symbol: "attention",
    chirps: 3,
  },
  {
    what: "a Reset the tag would not accept",
    outcome: outcomes.resetRefused("the tag is still identifiable"),
    symbol: "attention",
    chirps: 3,
  },
  {
    what: "a frame this build declined to send",
    outcome: outcomes.refusedByBuild({
      kind: "refusedByBuild",
      cmd: "0x0073",
      message: "this build sends only commands that cannot change a tag",
    }),
    symbol: "attention",
    chirps: 3,
  },
  {
    what: "a Reader held by another process",
    outcome: outcomes.readerFailure("kIOReturnExclusiveAccess"),
    symbol: "attention",
    chirps: 3,
  },
  {
    what: "a 125 kHz poll with no tag in the field",
    outcome: outcomes.nothingLatched("read"),
    symbol: "silent",
    chirps: 0,
  },
  {
    what: "a 13.56 MHz poll with no tag in the field",
    outcome: outcomes.nothingLatched("hf-read"),
    symbol: "silent",
    chirps: 0,
  },
  {
    what: "a stored preference that changed",
    outcome: outcomes.announcement("Quiet level set to Off."),
    symbol: "silent",
    chirps: 0,
  },
];

describe("the alphabet", () => {
  it("is four symbols: one chirp, two, three, or silence", () => {
    expect([...SIGNAL_SYMBOLS].sort()).toEqual(["attention", "done", "needs-you", "silent"]);
    expect(SIGNAL_SYMBOLS.map((symbol) => EXPECTED_CHIRPS[symbol]).sort()).toEqual([0, 1, 2, 3]);
  });

  it("gives every symbol exactly one count", () => {
    for (const symbol of SIGNAL_SYMBOLS) {
      expect(chirpSequenceFor(symbol).symbol, symbol).toBe(symbol);
      expect(chirpSequenceFor(symbol).chirps, symbol).toBe(EXPECTED_CHIRPS[symbol]);
    }
  });

  it("has no fourth count, because a fourth count is not perceivable at speed", () => {
    const counts = SIGNAL_SYMBOLS.map((symbol) => chirpSequenceFor(symbol).chirps);
    expect(Math.max(...counts)).toBe(3);
  });

  it("separates chirps with one named gap rather than a value at each call site", () => {
    expect(CHIRP_GAP_MS).toBe(120);
    for (const symbol of SIGNAL_SYMBOLS) {
      expect(chirpSequenceFor(symbol).gapMs, symbol).toBe(CHIRP_GAP_MS);
    }
  });

  it("holds the LED on for two seconds after attention, and only after attention", () => {
    expect(ATTENTION_LED_HOLD_MS).toBe(2_000);
    expect(chirpSequenceFor("attention").holdLedMs).toBe(2_000);
    for (const symbol of ["done", "needs-you", "silent"] as const) {
      expect(chirpSequenceFor(symbol).holdLedMs, symbol).toBe(0);
    }
  });

  it("makes silence a symbol with no chirps, not a missing sequence", () => {
    const silence = chirpSequenceFor("silent");
    expect(silence.symbol).toBe("silent");
    expect(silence.chirps).toBe(0);
    expect(silence.holdLedMs).toBe(0);
  });
});

describe("an outcome's sound", () => {
  it("is the symbol and count written down here, for every kind of operation", () => {
    for (const row of EXPECTED_OUTCOMES) {
      const sequence = chirpSequenceForOutcome(row.outcome);
      expect(sequence.symbol, row.what).toBe(row.symbol);
      expect(sequence.chirps, row.what).toBe(row.chirps);
    }
  });

  it("distinguishes success from failure, which is the point of the alphabet", () => {
    const done = chirpSequenceForOutcome(outcomes.tagRead("read", "55 00 84 82 12"));
    const failure = chirpSequenceForOutcome(
      outcomes.write("write", writeResult("failed")),
    );
    expect(done.chirps).not.toBe(failure.chirps);
    expect(done.holdLedMs).toBe(0);
    expect(failure.holdLedMs).toBe(ATTENTION_LED_HOLD_MS);
  });
});

describe("a poll's two empty-looking ends", () => {
  it("is silent when the field was empty, because nothing happened", () => {
    expect(chirpSequenceForOutcome(outcomes.nothingLatched("hf-read")).chirps).toBe(0);
  });

  it("needs you when a tag latched and its reply was rejected", () => {
    // Something happened and it needs a look: the tag was there, and the app
    // could not read it. Two chirps, not silence.
    const rejected = outcomes.hfReadIncomplete(null, "the poll reply carried no UID");
    const sequence = chirpSequenceForOutcome(rejected);
    expect(sequence.symbol).toBe("needs-you");
    expect(sequence.chirps).toBe(2);
  });

  it("never conflates the two, because telling them apart is why silence exists", () => {
    const nothing = chirpSequenceForOutcome(outcomes.nothingLatched("hf-read"));
    const rejected = chirpSequenceForOutcome(
      outcomes.hfReadIncomplete(null, "the poll reply carried no UID"),
    );
    expect(nothing.symbol).not.toBe(rejected.symbol);
    expect(nothing.chirps).not.toBe(rejected.chirps);
  });
});

describe("a read loop", () => {
  it("turns its one completing outcome into one sequence, not one per iteration", () => {
    // The loop's iterations that latch nothing report nothing at all — they are
    // background work. The completion is the operation, and it has one outcome,
    // which is one sequence.
    const completing = outcomes.tagRead("read", "55 00 84 82 12");
    expect(chirpSequenceForOutcome(completing).chirps).toBe(1);
  });
});
