import { describe, expect, it } from "vitest";
import {
  RESET_ACTION_LABEL,
  RESET_ANOTHER_CONTROL,
  RESET_OUTCOME_HINT,
  RESET_PANEL_HINT,
  RESET_PANEL_TITLE,
  RESET_READ_CONTROL,
  WILL_NOT_ACCEPT_WRITES,
  resetConfirmation,
  resetNotice,
} from "./blankTag";
import { pageCopyViolations, unapprovedWords } from "./copyGuard";
import { LF_MODE_LABEL, LF_MODES } from "./lfModes";
import { PAGE_SUBTITLES } from "./pageCopy";
import { READER_CAPABILITY_LIMITS } from "./readerIdentity";
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
  const confirmation = resetConfirmation(CONFIRMED);
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

  it("is labelled Reset, and never claims a factory restore", () => {
    // The name. This test used to require the opposite — that the title and the
    // button contain "blank" — which is how the mode pill came to say Reset while
    // the panel behind it said Blank: the panel's own test was pinning the word
    // GLOSSARY puts on Reset's *Avoid* line.
    expect(confirmation.title).toMatch(/^Reset\b/);
    expect(RESET_ACTION_LABEL).toMatch(/^Reset\b/);
    // The claim it must never make, in the confirmation or in the outcome words:
    // no restore of a factory configuration and no unlock. Neither is reachable
    // over this protocol.
    expect(copy).not.toMatch(/factory/i);
    expect(copy).not.toMatch(/unlock/i);
    expect(copy).not.toMatch(/restore/i);
  });

  it("leaves the factory-restore denial where the limits are stated once", () => {
    // The denial is not deleted, it is *moved*: whether Reset can restore or unlock
    // is a limit of this Reader, and the limits are stated once, in Settings →
    // Diagnostics → Capability limits (`components/ReaderLimits`). So the panel
    // spends no paragraph on it and this test fails if the fact disappears.
    const restore = READER_CAPABILITY_LIMITS.find((limit) => limit.id === "restore");
    expect(restore).toBeDefined();
    expect(restore?.label).toMatch(/restore/i);
    expect(restore?.detail).toMatch(/not possible/i);
    expect(restore?.detail).toMatch(/cannot be recovered/i);
  });

  it("never uses the words the glossary retired", () => {
    expect(unapprovedWords(copy)).toEqual([]);
    expect(unapprovedWords(`${RESET_PANEL_TITLE} ${RESET_PANEL_HINT}`)).toEqual([]);
    // The same guard covers the shell's page copy. It used to reach module
    // constants only, so a subtitle reading "badges, fobs" passed CI — the
    // plural form the pattern could not see.
    expect(pageCopyViolations()).toEqual([]);
    expect(PAGE_SUBTITLES.length).toBeGreaterThan(0);
  });

  it("never calls the operation a wipe, an erase or a format", () => {
    for (const words of [RESET_ACTION_LABEL, confirmation.title, RESET_PANEL_TITLE]) {
      expect(words).not.toMatch(/wipe|erase|format|restore|unlock/i);
    }
  });

  // The follow-up ticket's last criterion, and the reason this file now imports
  // `lib/lfModes`: the mode's name and the panel's words are one name, so the two
  // cannot drift apart again the way "Reset" and "Blank a tag" did.
  describe("the mode and its panel say the same word", () => {
    const mode = LF_MODES.find((entry) => entry.id === "reset");

    it("is the same name in the pill and in the panel", () => {
      expect(mode?.label).toBe("Reset");
      const label = LF_MODE_LABEL.reset;
      // Every word the panel leads with names the operation, and the control that
      // is a sentence about the tag still ends in the same verb.
      for (const words of [
        RESET_PANEL_TITLE,
        RESET_ACTION_LABEL,
        RESET_ANOTHER_CONTROL,
        confirmation.title,
      ]) {
        expect(words.startsWith(label)).toBe(true);
      }
      expect(RESET_READ_CONTROL.endsWith(`to ${label.toLowerCase()}`)).toBe(true);
    });

    it("never uses 'blank' as the verb for what the user does", () => {
      // "Blank" as a *noun* stays, in Clone and Batch, where it names the state of
      // a Tag that carries no Identity. As the action the user performs it is
      // retired (GLOSSARY, Reset's *Avoid* line).
      const panel = [
        RESET_PANEL_TITLE,
        RESET_PANEL_HINT,
        RESET_ACTION_LABEL,
        RESET_READ_CONTROL,
        RESET_ANOTHER_CONTROL,
        confirmation.title,
        ...confirmation.facts.map((fact) => `${fact.title} ${fact.detail}`),
        resetNotice(result("blanked")).text,
        resetNotice(result("refused", { message: "reason" })).text,
      ].join(" ");
      expect(panel).not.toMatch(/\bblank(s|ed|ing)?\b/i);
    });
  });
});

describe("resetNotice", () => {
  it("reports a Reset in Reset's words, never as verified, and says what to expect next", () => {
    const notice = resetNotice(result("blanked"));
    expect(notice.tone).toBe("ok");
    // The outcome words say Reset: the store's outcome is `blanked` on the wire,
    // but the user performed a Reset and must read the word the pill said.
    expect(notice.text).toContain("Reset —");
    expect(notice.text).not.toMatch(/verified/i);
    expect(notice.text).toMatch(/no Identity/i);
    // The library is untouched: a Reset is not a copy.
    expect(notice.text).toMatch(/no copy|unchanged/i);
    expect(notice.text).not.toMatch(/confirmed cop(y|ies)/i);
  });

  it("says the Identity is gone and leaves writability to the tag", () => {
    // What is true after a Reset: the reading is empty and the Identity is gone.
    // Whether the tag then takes a new Identity is the tag's answer — the app
    // cannot promise recovery, and it cannot warn of a lock it has not tested for.
    const text = resetNotice(result("blanked")).text;
    expect(text).toMatch(/Identity is gone/i);
    expect(text).toMatch(/depends on the tag/i);
    expect(text).toMatch(/cannot tell/i);
    // It no longer describes a locked tag as though it were the Reset's result,
    // and it never says the tag is unusable.
    expect(text).not.toMatch(/may refuse further writes/i);
    expect(text).not.toMatch(/unusable/i);
    // Nor does it promise a new Identity can be written.
    expect(text).not.toMatch(/can be written (again|to it)/i);
  });

  it("reports a refusal as not reset, with the guard's reason and no retry offer", () => {
    const notice = resetNotice(
      result("refused", { message: "could not read the tag on the reader" }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not reset");
    expect(notice.text).toContain("could not read the tag on the reader");
  });

  it("reports a failed Reset as not reset, in the reason's own words", () => {
    const still = resetNotice(
      result("failed", {
        message: "the tag still reads as 55 00 84 82 12 after the reset write",
      }),
    );
    expect(still.tone).toBe("err");
    expect(still.text).toContain("Not reset");
    expect(still.text).toContain("still reads as");

    const unsent = resetNotice(result("failed", { message: "USB write failed: timeout" }));
    expect(unsent.tone).toBe("err");
    expect(unsent.text).toContain("USB write failed: timeout");
  });

  it("reports an unreadable read-back as unknown, not as reset", () => {
    const notice = resetNotice(
      result("unverified", { message: "the tag could not be read back" }),
    );
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/unknown/i);
    expect(notice.text).not.toContain("Reset —");
  });

  // The refusal is its own outcome: a tag that read back its own Identity after
  // the write is evidence about the tag, so it is not worded as a generic
  // failure and not as an unknown (ADR 0007).
  describe("a tag that will not accept writes", () => {
    const notice = resetNotice(
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
      const notice = resetNotice(result(outcome, { message: "reason" }));
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
      (outcome) => resetNotice(result(outcome, { message: "reason" })).text,
    );
    for (const other of others) {
      expect(other).not.toContain(WILL_NOT_ACCEPT_WRITES);
      expect(other).not.toMatch(/never writable/i);
    }
  });
});

describe("RESET_OUTCOME_HINT", () => {
  it("explains why a blanked tag shows no Identity, and that it is not a copy", () => {
    expect(RESET_OUTCOME_HINT).toMatch(/no Identity/i);
    expect(RESET_OUTCOME_HINT).toMatch(/not a copy|no copy/i);
  });
});
