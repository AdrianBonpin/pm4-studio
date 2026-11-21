import { describe, expect, it } from "vitest";
import {
  BLANK_ACTION_LABEL,
  BLANK_IS_NOT_A_FACTORY_RESET,
  BLANK_OUTCOME_HINT,
  WILL_NOT_ACCEPT_WRITES,
  blankConfirmation,
  blankNotice,
} from "./blankTag";
import { pageCopyViolations, unapprovedWords } from "./copyGuard";
import { PAGE_SUBTITLES } from "./pageCopy";
import type { BlankResult } from "../types";

// The confirmation is the only thing standing between a user and a destroyed
// credential, so its wording is asserted rather than trusted.

const CONFIRMED = "55 00 84 82 12";

function result(outcome: BlankResult["outcome"], overrides: Partial<BlankResult> = {}): BlankResult {
  return {
    customer: 0x55,
    data32: 0x0084_8212,
    outcome,
    blanked: outcome === "blanked",
    stillIdentifies: null,
    message: null,
    ...overrides,
  };
}

describe("the blanking confirmation", () => {
  const confirmation = blankConfirmation(CONFIRMED);
  const copy = [
    confirmation.title,
    ...confirmation.facts.map((f) => `${f.title} ${f.detail}`),
  ].join(" ");

  it("names the Identity that will be destroyed", () => {
    expect(confirmation.identity).toBe(CONFIRMED);
    expect(confirmation.title).toContain(CONFIRMED);
  });

  it("states that the write is permanent", () => {
    expect(copy).toMatch(/permanent/i);
    expect(copy).toMatch(/cannot be recovered/i);
  });

  it("states that the tag may read as empty afterwards", () => {
    expect(copy).toMatch(/reads? as empty|read as empty/i);
    // ...and that this is the expected result, not a failure.
    expect(copy).toMatch(/expected result/i);
  });

  it("says a blanked tag may be unusable for further writes", () => {
    expect(copy).toMatch(/unusable for further writes/i);
    // The hazard is stated as real, because one of these blanks is already
    // permanently locked from earlier experiments.
    expect(copy).toMatch(/locked/i);
  });

  // ADR 0007: Reset is the only writability test, and it says so before it runs.
  // The three caveats are facts in the confirmation, not a footnote under it.
  describe("states the three writability caveats in plain words", () => {
    const facts = confirmation.facts.map((f) => `${f.title} ${f.detail}`);
    const inAFact = (pattern: RegExp) => facts.some((fact) => pattern.test(fact));

    it("says this Reader cannot tell whether a tag will accept a write", () => {
      expect(inAFact(/cannot (tell|determine)/i)).toBe(true);
      expect(copy).toMatch(/cannot (tell|determine) whether a tag will accept a write/i);
    });

    it("says a tag already written once may refuse forever", () => {
      expect(inAFact(/already been written/i)).toBe(true);
      expect(copy).toMatch(/may (permanently )?refuse/i);
    });

    it("says the attempt is safe only on a tag you can afford to lose", () => {
      expect(inAFact(/afford to lose/i)).toBe(true);
    });

    it("says no check exists, so nothing invites a pre-check", () => {
      expect(copy).toMatch(/no (check|test)/i);
      // The confirmation never offers, or hints at, a way to find out first.
      expect(copy).not.toMatch(/check (the|this) tag first|probe/i);
    });
  });

  it("is labelled blanking, and never claims a factory restore", () => {
    expect(confirmation.title.toLowerCase()).toContain("blank");
    expect(BLANK_ACTION_LABEL.toLowerCase()).toContain("blank");
    // No claim of restoring a factory state or unlocking a chip anywhere in the
    // confirmation itself.
    expect(copy).not.toMatch(/factory/i);
    expect(copy).not.toMatch(/unlock/i);
    expect(copy).not.toMatch(/restore/i);
    // The denial is stated separately, in as many words.
    expect(BLANK_IS_NOT_A_FACTORY_RESET).toMatch(/not a factory reset/i);
    expect(BLANK_IS_NOT_A_FACTORY_RESET).toMatch(/does not unlock/i);
  });

  it("never uses the words the glossary retired", () => {
    expect(unapprovedWords(copy)).toEqual([]);
    expect(unapprovedWords(BLANK_IS_NOT_A_FACTORY_RESET)).toEqual([]);
    // The same guard covers the shell's page copy. It used to reach module
    // constants only, so a subtitle reading "badges, fobs" passed CI — the
    // plural form the pattern could not see.
    expect(pageCopyViolations()).toEqual([]);
    expect(PAGE_SUBTITLES.length).toBeGreaterThan(0);
  });

  it("does not call blanking a reset, wipe, erase, or format", () => {
    expect(BLANK_ACTION_LABEL).not.toMatch(/reset|wipe|erase|format/i);
    expect(confirmation.title).not.toMatch(/reset|wipe|erase|format/i);
  });
});

describe("blankNotice", () => {
  it("reports a blank as blanked, never as verified, and says what to expect next", () => {
    const notice = blankNotice(result("blanked"));
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("Blanked");
    expect(notice.text).not.toMatch(/verified/i);
    expect(notice.text).toMatch(/no Identity/i);
    // The library is untouched: blanking is not a copy.
    expect(notice.text).toMatch(/no copy|unchanged/i);
    expect(notice.text).not.toMatch(/confirmed cop(y|ies)/i);
  });

  it("reports a refusal as not blanked, with the guard's reason and no retry offer", () => {
    const notice = blankNotice(
      result("refused", { message: "could not read the tag on the reader" }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not blanked");
    expect(notice.text).toContain("could not read the tag on the reader");
  });

  it("reports a failed blank as not blanked, in the reason's own words", () => {
    const still = blankNotice(
      result("failed", {
        message: "the tag still reads as 55 00 84 82 12 after the blanking write",
      }),
    );
    expect(still.tone).toBe("err");
    expect(still.text).toContain("Not blanked");
    expect(still.text).toContain("still reads as");

    const unsent = blankNotice(result("failed", { message: "USB write failed: timeout" }));
    expect(unsent.tone).toBe("err");
    expect(unsent.text).toContain("USB write failed: timeout");
  });

  it("reports an unreadable read-back as unknown, not as blanked", () => {
    const notice = blankNotice(
      result("unverified", { message: "the tag could not be read back" }),
    );
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/unknown/i);
    expect(notice.text).not.toContain("Blanked");
  });

  // The refusal is its own outcome: a tag that read back its own Identity after
  // the write is evidence about the tag, so it is not worded as a generic
  // failure and not as an unknown (ADR 0007).
  describe("a tag that will not accept writes", () => {
    const notice = blankNotice(
      result("willNotAcceptWrites", {
        stillIdentifies: CONFIRMED,
        message: "the tag still reads as 55 00 84 82 12 after the blanking write",
      }),
    );

    it("is named as what it is rather than as a failure", () => {
      expect(notice.tone).toBe("err");
      expect(notice.text).toContain(WILL_NOT_ACCEPT_WRITES);
      expect(notice.text).not.toMatch(/^Not blanked/);
      expect(notice.text).not.toMatch(/^Unknown/);
    });

    it("names both likely causes", () => {
      expect(notice.text).toMatch(/already (been )?written/i);
      expect(notice.text).toMatch(/never writable/i);
    });

    it("says nothing changed and no copy was counted", () => {
      expect(notice.text).toMatch(/nothing about (it|the tag) (was )?changed/i);
      expect(notice.text).not.toMatch(/confirmed cop(y|ies)/i);
      expect(notice.text).not.toMatch(/verified/i);
    });

    it("does not offer a retry as though the attempt were the problem", () => {
      expect(notice.text).not.toMatch(/try again/i);
    });
  });

  it("never claims a blank for any outcome other than blanked", () => {
    const others: BlankResult["outcome"][] = [
      "refused",
      "unverified",
      "failed",
      "willNotAcceptWrites",
    ];
    for (const outcome of others) {
      const notice = blankNotice(result(outcome, { message: "reason" }));
      expect(notice.tone).not.toBe("ok");
      expect(notice.text).not.toMatch(/^Blanked/);
    }
  });

  it("is worded apart from a guard refusal, a failure, and an unknown", () => {
    // A user who sees two of these on different days must be able to tell that
    // something different happened: refused (nothing was sent), failed (sent,
    // not working), unverified (sent, unknown), will-not-accept (sent, and the
    // tag itself refused). Only the last one is evidence about the tag.
    const others = (["refused", "failed", "unverified"] as const).map(
      (outcome) => blankNotice(result(outcome, { message: "reason" })).text,
    );
    for (const other of others) {
      expect(other).not.toContain(WILL_NOT_ACCEPT_WRITES);
      expect(other).not.toMatch(/never writable/i);
    }
  });
});

describe("BLANK_OUTCOME_HINT", () => {
  it("explains why a blanked tag shows no Identity, and that it is not a copy", () => {
    expect(BLANK_OUTCOME_HINT).toMatch(/no Identity/i);
    expect(BLANK_OUTCOME_HINT).toMatch(/not a copy|no copy/i);
  });
});
