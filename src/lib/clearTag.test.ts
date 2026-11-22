import { describe, expect, it } from "vitest";
import {
  CLEAR_ACTION_LABEL,
  CLEAR_ANOTHER_CONTROL,
  CLEAR_FACTS,
  CLEAR_PANEL_HINT,
  CLEAR_PANEL_TITLE,
  CLEAR_READ_CONTROL,
  DESTROY_ACTION_LABEL,
  DESTROY_ANOTHER_CONTROL,
  DESTROY_ENTER_CONTROL,
  DESTROY_FACTS,
  DESTROY_PANEL_HINT,
  DESTROY_PANEL_TITLE,
  TAG_OPERATION_LABEL,
  WILL_NOT_ACCEPT_WRITES,
  clearConfirmation,
  clearNotice,
  destroyConfirmation,
  destroyNotice,
  reReadNotice,
  tagOperationNotice,
} from "./clearTag";
import { pageCopyViolations, unapprovedWords } from "./copyGuard";
import { LF_MODE_LABEL, LF_MODES } from "./lfModes";
import { PAGE_SUBTITLES } from "./pageCopy";
import { READER_CAPABILITY_LIMITS } from "./readerIdentity";
import { severityOf } from "./severity";
import type { ClearResult } from "../types";

// The two confirmations are the only thing standing between a user and a lost
// credential, or between a user and a consumed tag, so their wording is asserted
// rather than trusted. The notices are asserted the same way, because the one
// thing this feature must never do is word a destruction as a clear.

const CONFIRMED = "55 00 84 82 12";
const PLACEHOLDER = "00 00 FF FF FF";

function result(
  outcome: ClearResult["outcome"],
  overrides: Partial<ClearResult> = {},
): ClearResult {
  const operation = overrides.operation ?? (outcome === "destroyed" ? "destroy" : "clear");
  return {
    customer: 0x55,
    data32: 0x0084_8212,
    operation,
    outcome,
    cleared: outcome === "cleared",
    destroyed: outcome === "destroyed",
    presents: outcome === "cleared" ? PLACEHOLDER : null,
    message: null,
    ...overrides,
  };
}

describe("Clear's confirmation", () => {
  const confirmation = clearConfirmation(CONFIRMED);
  const copy = [
    confirmation.title,
    ...confirmation.facts.map((f) => `${f.title} ${f.detail}`),
  ].join(" ");

  it("names the Identity that will be overwritten", () => {
    expect(confirmation.identity).toBe(CONFIRMED);
    expect(confirmation.title).toContain(CONFIRMED);
    expect(confirmation.action).toBe(CLEAR_ACTION_LABEL);
  });

  it("says the value on the tag cannot be recovered afterwards", () => {
    expect(copy).toMatch(/overwritten for good/i);
    expect(copy).toMatch(/cannot be recovered/i);
  });

  it("says the tag stops being a credential and is not a working one", () => {
    expect(copy).toMatch(/placeholder/i);
    expect(copy).toMatch(/no building system issues/i);
    expect(copy).toMatch(/will not open anything/i);
  });

  it("says the tag stays a tag and can be written again from this app", () => {
    // The user's requirement in their own terms: a cleared tag must be able to be
    // rewritten. The confirmation promises the *app's* half — a legal write
    // position and a flow that accepts it — and leaves the chip's answer to the
    // chip, because that is the only honest split.
    expect(copy).toMatch(/stays writable here|written again from this app/i);
    expect(copy).toMatch(/clone an Identity onto it, or author one/i);
    expect(copy).toMatch(/the tag's answer/i);
  });

  // ADR 0007: a writability test is a write, and the confirmation says so before
  // the write happens.
  describe("states the writability caveats in plain words", () => {
    const facts = confirmation.facts.map((f) => `${f.title} ${f.detail}`);
    const inAFact = (pattern: RegExp) => facts.some((fact) => pattern.test(fact));

    it("says this Reader cannot tell whether a tag will accept a write", () => {
      expect(inAFact(/cannot tell whether a tag will accept a write/i)).toBe(true);
      expect(copy).toMatch(/cannot tell whether a tag will accept a write/i);
    });

    it("says a tag already written once may refuse forever", () => {
      expect(inAFact(/already been written/i)).toBe(true);
      expect(copy).toMatch(/may permanently refuse/i);
    });

    it("says no check exists, so nothing invites a pre-check", () => {
      expect(copy).toMatch(/no check exists/i);
      expect(copy).not.toMatch(/check (the|this) tag first|probe/i);
    });

    // Kept through the payload change on purpose. Clearing writes a clone-shaped
    // payload now rather than an all-zero one, which is an argument that the chip
    // will survive it — but no cleared tag has been confirmed to take a new
    // Identity yet, so the advice the spec, ADR 0007 and ticket 12 all state still
    // applies. Retire this when the hardware checklist records that confirmation.
    it("says the attempt is safe only on a tag you can afford to lose", () => {
      expect(inAFact(/afford to lose/i)).toBe(true);
      expect(copy).toMatch(/afford to lose/i);
    });
  });

  it("is named Clear, and never claims a factory restore", () => {
    expect(confirmation.title).toMatch(/^Clear\b/);
    expect(CLEAR_ACTION_LABEL).toMatch(/^Clear\b/);
    expect(CLEAR_PANEL_TITLE).toMatch(/^Clear\b/);
    // The claim it must never make, in the confirmation or in the outcome words:
    // no restore of a factory configuration and no unlock. Neither is reachable
    // over this protocol.
    expect(copy).not.toMatch(/factory/i);
    expect(copy).not.toMatch(/unlock/i);
    expect(copy).not.toMatch(/restore/i);
  });

  it("never promises that Destroy's permanence applies to it", () => {
    // Clear is the reversible one. If its confirmation said "permanent" without
    // qualification the two operations would read the same, and the safe one would
    // look like the destructive one.
    expect(copy).not.toMatch(/permanently disables/i);
    expect(copy).not.toMatch(/cannot be reused/i);
  });
});

describe("Destroy's confirmation", () => {
  const confirmation = destroyConfirmation(CONFIRMED);
  const copy = [
    confirmation.title,
    ...confirmation.facts.map((f) => `${f.title} ${f.detail}`),
  ].join(" ");

  it("names the Identity and the action, in Destroy's own words", () => {
    expect(confirmation.identity).toBe(CONFIRMED);
    expect(confirmation.title).toContain(CONFIRMED);
    expect(confirmation.title).toMatch(/destroy/i);
    expect(confirmation.action).toBe(DESTROY_ACTION_LABEL);
  });

  it("states plainly that the tag is permanently disabled", () => {
    // The ticket's criterion, word for word: not "may refuse further writes".
    expect(copy).toMatch(/permanently disables the tag/i);
    expect(copy).toMatch(/never accept data again/i);
    expect(copy).not.toMatch(/may (permanently )?refuse/i);
    expect(copy).not.toMatch(/may not accept/i);
  });

  it("states that the tag cannot be recovered or reused", () => {
    expect(copy).toMatch(/cannot be recovered or reused/i);
    expect(copy).toMatch(/no factory restore/i);
    expect(copy).toMatch(/cannot be written again/i);
  });

  it("warns that every reader still sees a destroyed tag", () => {
    // The failure mode that produced the wrong diagnosis in the field: a tag that
    // answers the field looks alive, and it is not.
    expect(copy).toMatch(/still see it|keeps answering readers/i);
    expect(copy).toMatch(/does not mean it still works/i);
  });

  it("separates itself from Clear rather than offering it as an alternative", () => {
    expect(copy).toMatch(/Clear is the operation for a tag you want back/i);
    expect(copy).not.toMatch(/may be reusable|can be reused|try again/i);
  });

  it("shares none of Clear's reassurance", () => {
    expect(copy).not.toMatch(/written again from this app/i);
    expect(copy).not.toMatch(/stays a tag/i);
  });
});

describe("the two confirmations are different documents", () => {
  it("do not share a title, an action or a fact", () => {
    const clear = clearConfirmation(CONFIRMED);
    const destroy = destroyConfirmation(CONFIRMED);
    expect(clear.title).not.toBe(destroy.title);
    expect(clear.action).not.toBe(destroy.action);
    expect(clear.facts.map((f) => f.title)).not.toEqual(
      destroy.facts.map((f) => f.title),
    );
    expect(CLEAR_FACTS.every((f) => !DESTROY_FACTS.includes(f))).toBe(true);
  });
});

describe("clearNotice", () => {
  it("reports a clear as cleared, in Clear's words and not as verified", () => {
    const notice = clearNotice(result("cleared"));
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("Cleared —");
    expect(notice.text).toContain(PLACEHOLDER);
    expect(notice.text).not.toMatch(/verified/i);
    expect(notice.text).not.toMatch(/confirmed cop(y|ies)/i);
    expect(notice.text).toMatch(/no copy/i);
  });

  it("says the tag is not a working credential, and does not claim a later write", () => {
    const text = clearNotice(result("cleared")).text;
    // The two halves the ticket asks for, in words that cannot be turned round.
    expect(text).toMatch(/not a working credential/i);
    expect(text).toMatch(/nothing will open with it/i);
    // Reusable: the app will take it as a write position...
    expect(text).toMatch(/written again from this app/i);
    // ...and the app does not claim the chip accepted a later write, which it
    // cannot know.
    expect(text).not.toMatch(/has accepted|accepted a later write|was written again/i);
    expect(text).toMatch(/Whether that next write is accepted is the tag's answer/i);
  });

  it("never says the tag was destroyed, disabled or made unrecoverable", () => {
    const text = clearNotice(result("cleared")).text;
    expect(text).not.toMatch(/destroyed/i);
    expect(text).not.toMatch(/disabled/i);
    expect(text).not.toMatch(/cannot be reused/i);
    expect(text).not.toMatch(/will never accept data again/i);
  });

  it("reports a refusal as not cleared, with the guard's reason", () => {
    const notice = clearNotice(
      result("refused", { message: "could not read the tag on the reader" }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not cleared");
    expect(notice.text).toContain("could not read the tag on the reader");
  });

  it("reports a lost transmission as not cleared", () => {
    const notice = clearNotice(result("failed", { message: "USB write failed: timeout" }));
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not cleared");
    expect(notice.text).toContain("USB write failed: timeout");
  });

  it("reports an unreadable read-back as unknown, not as cleared", () => {
    const notice = clearNotice(
      result("unverified", { message: "the tag could not be read back" }),
    );
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/unknown/i);
    expect(notice.text).not.toContain("Cleared —");
  });

  describe("a tag that will not accept writes", () => {
    const notice = clearNotice(
      result("willNotAcceptWrites", {
        presents: CONFIRMED,
        message: "the tag still reads as 55 00 84 82 12 after the clearing write",
      }),
    );

    it("is named as what it is rather than as a failure", () => {
      expect(notice.tone).toBe("err");
      expect(notice.text).toContain(WILL_NOT_ACCEPT_WRITES);
      expect(notice.text).not.toMatch(/^Not cleared/);
      expect(notice.text).not.toMatch(/^Unknown/);
    });

    it("names both likely causes and says nothing changed", () => {
      expect(notice.text).toMatch(/already (been )?written/i);
      expect(notice.text).toMatch(/never writable/i);
      expect(notice.text).toMatch(/nothing about the tag was changed/i);
      expect(notice.text).not.toMatch(/confirmed cop(y|ies)/i);
    });

    it("does not offer a retry as though the attempt were the problem", () => {
      expect(notice.text).not.toMatch(/try again/i);
    });
  });
});

describe("destroyNotice", () => {
  it("reports a destroy as destroyed, and never as recoverable", () => {
    const notice = destroyNotice(result("destroyed"));
    expect(notice.text).toContain("Destroyed —");
    expect(notice.text).toMatch(/never accept data again/i);
    expect(notice.text).toMatch(/cannot be recovered or reused/i);
    expect(notice.text).not.toMatch(/recover it|reuse it|can be reused|recoverable/i);
    expect(notice.text).not.toMatch(/may (permanently )?refuse/i);
  });

  it("never says the tag was cleared, left usable, or writable again", () => {
    const text = destroyNotice(result("destroyed")).text;
    expect(text).not.toMatch(/cleared/i);
    expect(text).not.toMatch(/written again/i);
    expect(text).not.toMatch(/placeholder/i);
    expect(text).not.toMatch(/stays a tag/i);
  });

  it("keeps the still-answering-readers caveat, so a reply is not read as life", () => {
    const text = destroyNotice(result("destroyed")).text;
    expect(text).toMatch(/still sees it|keeps answering/i);
    expect(text).toMatch(/not a sign it still works/i);
  });

  it("is not reported at the refusal's severity, because the user asked for it", () => {
    // A destroy the user chose is completed. It is the alphabet's *needs you*
    // (two chirps), never *attention* (three): a deliberate destruction reported as
    // a failure would send the user looking for a fault that is the app doing what
    // it was told.
    const notice = destroyNotice(result("destroyed"));
    expect(notice.tone).toBe("warn");
    expect(severityOf("destroyed")).toBe("warning");
    expect(severityOf("cleared")).toBe("success");
    expect(severityOf("destroyed")).not.toBe(severityOf("cleared"));
  });

  it("reports a refusal as not destroyed", () => {
    const notice = destroyNotice(
      result("refused", { operation: "destroy", message: "nothing to destroy" }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not destroyed");
  });
});

describe("neither operation can be reported as the other", () => {
  // The requirement the ticket's classification seam exists for. Three routes are
  // covered: the outcome word, the echo of the operation, and the severity.
  it("is refused when the outcome belongs to the other operation", () => {
    const clearGotDestroy = clearNotice(result("destroyed", { operation: "clear" }));
    const destroyGotClear = destroyNotice(result("cleared", { operation: "destroy" }));

    for (const notice of [clearGotDestroy, destroyGotClear]) {
      expect(notice.tone).toBe("err");
      expect(notice.text).toMatch(/cannot say what the tag now carries/i);
    }
    expect(clearGotDestroy.text).not.toContain("Cleared —");
    expect(destroyGotClear.text).not.toContain("Destroyed —");
  });

  it("is refused when the backend echoes a different operation", () => {
    // A wire mixup, not a wording one: the result says a destroy ran while the
    // interface asked for a clear.
    const notice = tagOperationNotice("clear", result("destroyed", { operation: "destroy" }));
    expect(notice.tone).toBe("err");
    expect(notice.text).not.toContain("Cleared —");
  });

  it("is never reported at the same severity, so the sounds differ", () => {
    expect(clearNotice(result("cleared")).tone).toBe("ok");
    expect(destroyNotice(result("destroyed")).tone).toBe("warn");
    expect(clearNotice(result("cleared")).tone).not.toBe(
      destroyNotice(result("destroyed")).tone,
    );
  });

  it("is never worded with the other operation's verb, for any outcome", () => {
    const outcomes: ClearResult["outcome"][] = [
      "refused",
      "unverified",
      "failed",
      "willNotAcceptWrites",
    ];
    for (const outcome of outcomes) {
      const clear = clearNotice(result(outcome, { message: "reason" })).text;
      const destroy = destroyNotice(
        result(outcome, { operation: "destroy", message: "reason" }),
      ).text;
      expect(clear).not.toMatch(/destroyed/i);
      expect(destroy).not.toMatch(/\bcleared\b/i);
    }
  });
});

describe("reReadNotice", () => {
  it("treats a destroyed tag's empty reading as expected, with the caveat", () => {
    const notice = reReadNotice("destroy", null, null);
    expect(notice.tone).toBe("ok");
    expect(notice.text).toMatch(/no Identity/i);
    expect(notice.text).toMatch(/lifted off/i);
  });

  it("does not treat a cleared tag's empty reading as expected", () => {
    // A cleared tag carries a value, so reading nothing means the tag is off the
    // reader or the write did not land. Calling that "expected" would hide a
    // failed clear.
    const notice = reReadNotice("clear", PLACEHOLDER, null);
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/should read as one/i);
  });

  it("confirms the placeholder is still there", () => {
    const notice = reReadNotice("clear", PLACEHOLDER, { id: PLACEHOLDER });
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain(PLACEHOLDER);
  });

  it("warns when a clear left something that is not the placeholder", () => {
    const notice = reReadNotice("clear", PLACEHOLDER, { id: CONFIRMED });
    expect(notice.tone).toBe("warn");
    expect(notice.text).toContain(CONFIRMED);
    expect(notice.text).toMatch(/not the placeholder/i);
  });
});

describe("the panel's copy", () => {
  const panel = [
    CLEAR_PANEL_TITLE,
    CLEAR_PANEL_HINT,
    CLEAR_ACTION_LABEL,
    CLEAR_READ_CONTROL,
    CLEAR_ANOTHER_CONTROL,
    DESTROY_PANEL_TITLE,
    DESTROY_PANEL_HINT,
    DESTROY_ENTER_CONTROL,
    DESTROY_ACTION_LABEL,
    DESTROY_ANOTHER_CONTROL,
    ...CLEAR_FACTS.map((f) => `${f.title} ${f.detail}`),
    ...DESTROY_FACTS.map((f) => `${f.title} ${f.detail}`),
    clearNotice(result("cleared")).text,
    destroyNotice(result("destroyed")).text,
    clearNotice(result("refused", { message: "reason" })).text,
  ].join(" ");

  it("never uses the words the glossary retired", () => {
    expect(unapprovedWords(panel)).toEqual([]);
    expect(pageCopyViolations()).toEqual([]);
    expect(PAGE_SUBTITLES.length).toBeGreaterThan(0);
  });

  it("never calls the operation a wipe, an erase, a format or a reset", () => {
    for (const words of [
      CLEAR_ACTION_LABEL,
      CLEAR_PANEL_TITLE,
      CLEAR_PANEL_HINT,
      DESTROY_ACTION_LABEL,
      DESTROY_PANEL_TITLE,
      DESTROY_PANEL_HINT,
      clearConfirmation(CONFIRMED).title,
      destroyConfirmation(CONFIRMED).title,
    ]) {
      expect(words).not.toMatch(/wipe|erase|format|restore|unlock|reset/i);
    }
  });

  it("never uses 'blank' as the verb for what the user does", () => {
    // "Blank" as a *noun* stays, in Clone and Batch, where it names the state of a
    // Tag that carries no Identity. Here it does not appear at all.
    expect(panel).not.toMatch(/\bblank(s|ed|ing)?\b/i);
  });

  it("leaves the factory-restore denial where the limits are stated once", () => {
    // Whether Clear or Destroy can restore or unlock is a limit of this Reader, and
    // the limits are stated once, in Settings → Diagnostics → Capability limits
    // (`components/ReaderLimits`). Delete the fact and this fails.
    const restore = READER_CAPABILITY_LIMITS.find((limit) => limit.id === "restore");
    expect(restore).toBeDefined();
    expect(restore?.label).toMatch(/restore/i);
    expect(restore?.detail).toMatch(/not possible/i);
    expect(restore?.detail).toMatch(/cannot be recovered/i);
  });

  // The follow-up ticket's criterion: the mode's name and the panel's words are one
  // name. It failed once — the pill said Reset while the panel said "Blank a tag" —
  // so the binding is asserted rather than assumed.
  describe("the mode and its panel say the same word", () => {
    const mode = LF_MODES.find((entry) => entry.id === "clear");

    it("is the same name in the pill and in the panel", () => {
      expect(mode?.label).toBe("Clear");
      const label = LF_MODE_LABEL.clear;
      expect(label).toBe(TAG_OPERATION_LABEL.clear);
      for (const words of [
        CLEAR_PANEL_TITLE,
        CLEAR_ACTION_LABEL,
        CLEAR_ANOTHER_CONTROL,
        clearConfirmation(CONFIRMED).title,
      ]) {
        expect(words.startsWith(label)).toBe(true);
      }
      expect(CLEAR_READ_CONTROL.endsWith(`to ${label.toLowerCase()}`)).toBe(true);
    });

    it("no longer offers a mode called Reset", () => {
      expect(LF_MODES.map((m) => m.label)).not.toContain("Reset");
      expect(LF_MODES.map((m) => m.id)).not.toContain("reset");
    });
  });
});
