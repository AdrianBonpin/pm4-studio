import { describe, expect, it } from "vitest";
import type { BatchAttemptResult, LfCard } from "../types";
import {
  BATCH_FACTS,
  FRESH_TAG_PER_ATTEMPT,
  IDENTICAL_BLANKS_LIMIT,
  OUTCOME_LABEL,
  attemptCountsAsConfirmedCopy,
  attemptNotice,
  attemptRequest,
  batchCounts,
  recordAttempt,
  runConfirmedCopies,
  sourceIdentity,
  startBatch,
  summarySentence,
} from "./batchClone";


/** The source Tag, as the wizard read it once: `55 00 84 82 12`. */
const SOURCE: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 132,
  card: 33298,
  raw: "00 01 01 …",
};

/** A different Tag: a Blank that already holds something else. */
const OTHER: LfCard = {
  customer: 0x56,
  data32: 0x0053_c7b3,
  id: "56 00 53 C7 B3",
  facility: 0x53,
  card: 0xc7b3,
  raw: "00 01 01 …",
};

function attempt(
  outcome: BatchAttemptResult["outcome"],
  overrides: Partial<BatchAttemptResult> = {},
): BatchAttemptResult {
  return {
    customer: SOURCE.customer,
    data32: SOURCE.data32,
    outcome,
    message: null,
    readback: null,
    confirmedCopies: null,
    countProblem: null,
    ...overrides,
  };
}

const verified = (copies: number | null = 1) =>
  attempt("verified", { readback: SOURCE, confirmedCopies: copies });

const skipped = () =>
  attempt("skipped", {
    readback: SOURCE,
    confirmedCopies: 1,
    message:
      "the tag on the reader already reads as 55 00 84 82 12, so nothing was written. That is " +
      "either the original tag still on the reader, or a tag that was already written in this " +
      "run — this attempt is not counted again. Put a fresh blank tag on the reader for the " +
      "next attempt.",
  });

describe("the source identity is read once and held", () => {
  it("sends the identity it started with, not the last tag it saw", () => {
    let run = startBatch(SOURCE);
    expect(attemptRequest(run)).toEqual({
      customer: SOURCE.customer,
      data32: SOURCE.data32,
    });

    // Attempts report other Tags being read in the write position; none of them
    // may become the identity the run writes.
    run = recordAttempt(run, attempt("unverified", { readback: OTHER }));
    run = recordAttempt(run, skipped());
    run = recordAttempt(run, verified());

    expect(attemptRequest(run)).toEqual({
      customer: SOURCE.customer,
      data32: SOURCE.data32,
    });
    expect(sourceIdentity(run)).toBe("55 00 84 82 12");
  });

  it("keeps the readings it was handed", () => {
    const run = recordAttempt(startBatch(SOURCE), verified());
    expect(run.source).toBe(SOURCE);
    expect(run.attempts).toHaveLength(1);
  });
});

describe("only a verified attempt is a confirmed copy", () => {
  it("agrees with the copy rule every other write path uses", () => {
    for (const outcome of ["verified", "skipped", "unverified", "refused", "failed"] as const) {
      expect(attemptCountsAsConfirmedCopy(outcome)).toBe(outcome === "verified");
    }
  });

  it("counts verified attempts and nothing else", () => {
    let run = startBatch(SOURCE);
    run = recordAttempt(run, skipped());
    run = recordAttempt(run, attempt("refused"));
    run = recordAttempt(run, attempt("unverified"));
    run = recordAttempt(run, attempt("failed"));
    expect(runConfirmedCopies(run)).toBe(0);

    run = recordAttempt(run, verified());
    expect(runConfirmedCopies(run)).toBe(1);
  });

  it("counts each kind separately instead of one aggregate verdict", () => {
    let run = startBatch(SOURCE);
    run = recordAttempt(run, verified());
    run = recordAttempt(run, skipped());
    run = recordAttempt(run, attempt("refused"));
    run = recordAttempt(run, attempt("unverified"));
    run = recordAttempt(run, attempt("failed"));

    expect(batchCounts(run.attempts)).toEqual({
      verified: 1,
      skipped: 1,
      refused: 1,
      unverified: 1,
      failed: 1,
      attempts: 5,
    });
  });
});

describe("the identical-tag hazard", () => {
  it("does not count the same tag twice when it is left in position", () => {
    // Attempt 1 writes a blank and is verified. The tag is left on the reader,
    // so attempt 2 sees a tag that already presents the identity: skipped.
    let run = startBatch(SOURCE);
    run = recordAttempt(run, verified());
    expect(runConfirmedCopies(run)).toBe(1);

    run = recordAttempt(run, skipped());
    expect(runConfirmedCopies(run)).toBe(1);
    expect(run.attempts).toHaveLength(2);
    expect(run.attempts[1]!.outcome).toBe("skipped");
  });

  it("survives three presses with one tag in place: one copy, two skips", () => {
    let run = startBatch(SOURCE);
    run = recordAttempt(run, verified());
    run = recordAttempt(run, skipped());
    run = recordAttempt(run, skipped());
    expect(runConfirmedCopies(run)).toBe(1);
    expect(batchCounts(run.attempts).skipped).toBe(2);
  });

  it("lets a fresh blank be written after a skip", () => {
    let run = startBatch(SOURCE);
    run = recordAttempt(run, skipped());
    run = recordAttempt(run, verified(2));
    expect(batchCounts(run.attempts).skipped).toBe(1);
    expect(runConfirmedCopies(run)).toBe(1);
  });

  it("says a skip is not a copy, and is not a failure to seat a tag", () => {
    const notice = attemptNotice(skipped());
    expect(notice.tone).toBe("warn");
    expect(notice.text).toContain("55 00 84 82 12");
    expect(notice.text).toContain("nothing was written");
    expect(notice.text).toContain("Not counted as another copy");
    // The tag was read perfectly well; this is not the unreadable refusal.
    expect(notice.text).not.toContain("could not read");
    expect(notice.text).not.toContain("Verified");
  });
});

describe("a refusal does not abort the run", () => {
  it("keeps every attempt and keeps going", () => {
    let run = startBatch(SOURCE);
    run = recordAttempt(run, attempt("refused", { message: "could not read the tag" }));
    expect(runConfirmedCopies(run)).toBe(0);
    expect(run.attempts).toHaveLength(1);

    run = recordAttempt(run, attempt("failed", { message: "USB write failed" }));
    run = recordAttempt(run, verified());
    expect(run.attempts.map((a) => a.outcome)).toEqual(["refused", "failed", "verified"]);
    expect(runConfirmedCopies(run)).toBe(1);
  });
});

describe("each attempt reports itself", () => {
  it("gives every outcome its own wording and tone", () => {
    const notices = {
      verified: attemptNotice(verified()),
      skipped: attemptNotice(skipped()),
      unverified: attemptNotice(attempt("unverified", { message: "could not be read back" })),
      refused: attemptNotice(attempt("refused", { message: "could not read the tag" })),
      failed: attemptNotice(attempt("failed", { message: "USB write failed" })),
    };

    expect(notices.verified.tone).toBe("ok");
    expect(notices.skipped.tone).toBe("warn");
    expect(notices.unverified.tone).toBe("warn");
    expect(notices.refused.tone).toBe("err");
    expect(notices.failed.tone).toBe("err");

    const texts = Object.values(notices).map((notice) => notice.text);
    expect(new Set(texts).size).toBe(5);

    expect(notices.verified.text).toContain("Verified");
    expect(notices.refused.text).toContain("Not written");
    expect(notices.failed.text).toContain("could not be sent");
    expect(notices.unverified.text).toContain("Unknown");
  });

  it("never words a non-verified attempt as a copy", () => {
    const others = ["skipped", "unverified", "refused", "failed"] as const;
    for (const outcome of others) {
      const notice = attemptNotice(attempt(outcome, { message: "why" }));
      expect(notice.text).not.toContain("Verified");
      expect(OUTCOME_LABEL[outcome]).not.toBe("Verified");
    }
  });

  it("says which count the library holds, and that a non-copy left it alone", () => {
    expect(attemptNotice(verified(3)).text).toContain("3 confirmed copies");
    expect(attemptNotice(attempt("refused", { confirmedCopies: 2 })).text).toContain(
      "Unchanged: 2 confirmed copies",
    );
    expect(attemptNotice(attempt("refused", { confirmedCopies: null })).text).toContain(
      "no count to keep",
    );
  });

  it("summarises every kind separately", () => {
    let run = startBatch(SOURCE);
    expect(summarySentence(run)).toContain("No attempts yet");

    run = recordAttempt(run, verified());
    run = recordAttempt(run, skipped());
    run = recordAttempt(run, attempt("refused"));
    const sentence = summarySentence(run);
    expect(sentence).toContain("3 attempts");
    expect(sentence).toContain("1 verified");
    expect(sentence).toContain("1 skipped");
    expect(sentence).toContain("1 refused");
    expect(sentence).toContain("1 confirmed copy");
  });
});

describe("what the user is told about several blanks", () => {
  it("states that two identical blanks cannot be told apart", () => {
    expect(IDENTICAL_BLANKS_LIMIT).toContain("cannot be told apart");
    expect(IDENTICAL_BLANKS_LIMIT).toContain("not a chip");
    expect(IDENTICAL_BLANKS_LIMIT).toContain("fresh blank");
  });

  it("states that each attempt needs a fresh tag", () => {
    expect(FRESH_TAG_PER_ATTEMPT).toContain("Each attempt needs a fresh tag");
    expect(FRESH_TAG_PER_ATTEMPT).toContain("Take the original off the reader before the first");
    expect(FRESH_TAG_PER_ATTEMPT).toContain("skipped, not written");
  });

  it("puts both facts in front of the user before the first attempt", () => {
    const text = BATCH_FACTS.map((fact) => `${fact.title} ${fact.detail}`).join(" ");
    expect(text).toContain("cannot be told apart");
    expect(text).toContain("Each attempt needs a fresh tag");
    expect(text).toContain("Only a verified attempt counts");
    expect(BATCH_FACTS.every((fact) => fact.title.length > 0 && fact.detail.length > 0)).toBe(true);
  });

  it("never calls a Tag a badge or a fob", () => {
    const text = [
      IDENTICAL_BLANKS_LIMIT,
      FRESH_TAG_PER_ATTEMPT,
      ...BATCH_FACTS.map((fact) => `${fact.title} ${fact.detail}`),
      summarySentence(recordAttempt(startBatch(SOURCE), skipped())),
      attemptNotice(skipped()).text,
    ]
      .join(" ")
      .toLowerCase();
    expect(text).not.toContain("badge");
    expect(text).not.toContain("fob");
  });
});
