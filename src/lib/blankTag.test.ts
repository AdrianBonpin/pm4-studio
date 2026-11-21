import { describe, expect, it } from "vitest";
import {
  BLANK_ACTION_LABEL,
  BLANK_IS_NOT_A_FACTORY_RESET,
  BLANK_OUTCOME_HINT,
  blankConfirmation,
  blankNotice,
} from "./blankTag";
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
    expect(copy).not.toMatch(/badge|fob/i);
    expect(BLANK_IS_NOT_A_FACTORY_RESET).not.toMatch(/badge|fob/i);
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

  it("never claims a blank for any outcome other than blanked", () => {
    const others: BlankResult["outcome"][] = ["refused", "unverified", "failed"];
    for (const outcome of others) {
      const notice = blankNotice(result(outcome, { message: "reason" }));
      expect(notice.tone).not.toBe("ok");
      expect(notice.text).not.toMatch(/^Blanked/);
    }
  });
});

describe("BLANK_OUTCOME_HINT", () => {
  it("explains why a blanked tag shows no Identity, and that it is not a copy", () => {
    expect(BLANK_OUTCOME_HINT).toMatch(/no Identity/i);
    expect(BLANK_OUTCOME_HINT).toMatch(/not a copy|no copy/i);
  });
});
