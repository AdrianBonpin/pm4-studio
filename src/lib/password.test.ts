import { describe, expect, it } from "vitest";
import {
  ACKNOWLEDGEMENT_LABEL,
  CONFIG_READ_EXPLANATION,
  LOST_PASSWORD_WARNING,
  NO_AUTHENTICATION_EXPLANATION,
  PASSWORD_ACTION_REMOVE,
  PASSWORD_ACTION_SET,
  PASSWORD_FACTS,
  REMOVE_PAGES,
  SET_PAGES,
  UNKNOWN_PASSWORD_WARNING,
  UNRECORDED_PASSWORD_WARNING,
  acknowledgementGiven,
  gateRefusal,
  pagesSentence,
  passwordConfirmation,
  passwordNotice,
  protectionSentence,
  type PasswordAttempt,
} from "./password";

// This is the highest-consequence ticket in the project: the copy IS the
// safety feature, so it is asserted rather than trusted. No hardware, no Reader.

const UID = "04 43 7B 01 CC 09 03";

function attempt(overrides: Partial<PasswordAttempt> = {}): PasswordAttempt {
  return {
    outcome: "refused",
    refusal: "cannot-authenticate",
    message: "nothing was written",
    wouldWritePages: [...SET_PAGES],
    wrotePages: [],
    ...overrides,
  };
}

describe("the lost-password warning", () => {
  it("says the Tag becomes permanently unrecoverable", () => {
    expect(LOST_PASSWORD_WARNING).toMatch(/permanently unrecoverable/i);
    expect(LOST_PASSWORD_WARNING).toMatch(/lost/i);
  });

  it("says nothing can be recovered from it without the password", () => {
    expect(LOST_PASSWORD_WARNING).toMatch(/nothing can be recovered/i);
  });

  it("is part of the confirmation for both operations", () => {
    for (const operation of ["set", "remove"] as const) {
      expect(passwordConfirmation(operation, UID).warning).toBe(LOST_PASSWORD_WARNING);
    }
  });
});

describe("recording the password", () => {
  it("tells the user what happens when it is not recorded anywhere", () => {
    expect(UNRECORDED_PASSWORD_WARNING).toMatch(/not recorded anywhere/i);
    expect(UNRECORDED_PASSWORD_WARNING).toMatch(/lost password/i);
  });

  it("says the app neither stores, echoes, nor recovers it", () => {
    expect(UNRECORDED_PASSWORD_WARNING).toMatch(/does not store/i);
    expect(UNRECORDED_PASSWORD_WARNING).toMatch(/cannot recover/i);
  });

  it("is shown at the point of setting, not only in documentation", () => {
    const confirmation = passwordConfirmation("set", UID);
    expect(confirmation.unrecorded).toBe(UNRECORDED_PASSWORD_WARNING);
  });
});

describe("an unknown password", () => {
  it("is never presented as recoverable", () => {
    expect(UNKNOWN_PASSWORD_WARNING).toMatch(/never presented as recoverable/i);
  });

  it("is the wording for an undeterminable protection state", () => {
    const sentence = protectionSentence("unknown");
    expect(sentence).toMatch(/cannot be determined/i);
    // Reading as "off" is the mistake that gets a protected Tag handled as a
    // working one, so the sentence must state no protection conclusion: no
    // AUTH0 value, and nothing that says the Tag is unprotected.
    expect(sentence).not.toMatch(/AUTH0 reads 0xFF/i);
    expect(sentence).not.toMatch(/\bis unprotected\b/i);
    expect(sentence).toMatch(/not treated as recoverable/i);
  });

  it("is not softened for a Tag that does carry protection", () => {
    expect(protectionSentence("enabled")).toMatch(/not recoverable here/i);
  });
});

describe("the acknowledgement gate", () => {
  it("is closed by default", () => {
    expect(acknowledgementGiven(false)).toBe(false);
    expect(gateRefusal(false)).toBe(ACKNOWLEDGEMENT_LABEL);
  });

  it("opens only for an explicit acknowledgement", () => {
    expect(acknowledgementGiven(true)).toBe(true);
    expect(gateRefusal(true)).toBeNull();
  });

  it("is not passed by a truthy-looking value that is not `true`", () => {
    // A dialog that defaults to "accepted" arrives as something like this.
    for (const value of [0, 1, "true", {}, [], null, undefined]) {
      expect(acknowledgementGiven(value as unknown as boolean)).toBe(false);
    }
  });

  it("asks the user to acknowledge the unrecoverable consequence", () => {
    expect(ACKNOWLEDGEMENT_LABEL).toMatch(/permanently unrecoverable/i);
    expect(ACKNOWLEDGEMENT_LABEL).toMatch(/^I understand/i);
  });
});

describe("the confirmation", () => {
  const confirmation = passwordConfirmation("set", UID);
  const copy = [
    confirmation.title,
    confirmation.warning,
    confirmation.unrecorded,
    ...confirmation.facts.map((fact) => `${fact.title} ${fact.detail}`),
  ].join(" ");

  it("names the Tag it applies to, as it was read", () => {
    expect(confirmation.title).toContain(UID);
  });

  it("does not invent a Tag when none was read", () => {
    expect(passwordConfirmation("set", null).title).toContain("this Tag");
    expect(passwordConfirmation("set", null).title).not.toMatch(/[0-9A-F]{2} [0-9A-F]{2}/);
  });

  it("says setting cannot be undone here", () => {
    expect(confirmation.title).toMatch(/cannot be undone here/i);
  });

  it("names the configuration pages the operation would change", () => {
    expect(confirmation.pages).toEqual(SET_PAGES);
    expect(SET_PAGES).toEqual([131, 133, 134]);
    expect(REMOVE_PAGES).toEqual([131]);
    expect(passwordConfirmation("remove", UID).pages).toEqual(REMOVE_PAGES);
  });

  it("states that the password cannot be verified", () => {
    expect(copy).toMatch(/cannot be verified/i);
  });

  it("states that setting is one-way over this protocol", () => {
    expect(copy).toMatch(/one-way/i);
  });

  it("states that protection status cannot be read", () => {
    expect(copy).toMatch(/cannot see whether a Tag is already protected/i);
  });

  it("uses the two action labels the buttons share", () => {
    expect(passwordConfirmation("set", UID).action).toBe(PASSWORD_ACTION_SET);
    expect(passwordConfirmation("remove", UID).action).toBe(PASSWORD_ACTION_REMOVE);
    expect(PASSWORD_FACTS.length).toBeGreaterThanOrEqual(3);
  });

  it("never claims a password can be set on this Reader", () => {
    // The heading is a question about a consequence, not a promise: the action
    // itself is refused and the explanation says why.
    expect(NO_AUTHENTICATION_EXPLANATION).toMatch(/will therefore not set one/i);
    expect(NO_AUTHENTICATION_EXPLANATION).toMatch(/no command that authenticates/i);
    expect(CONFIG_READ_EXPLANATION).toMatch(/not the Tag's real configuration/i);
    expect(copy).not.toMatch(/password set successfully/i);
  });
});

describe("the notice for an attempt", () => {
  it("says nothing was written before it says why", () => {
    const notice = passwordNotice(attempt({ message: "this Reader cannot authenticate" }));
    expect(notice.text).toMatch(/^Not done — nothing was written to the Tag\./);
    expect(notice.text).toContain("this Reader cannot authenticate");
  });

  it("is amber for a missing acknowledgement and red for a refusal to touch the Tag", () => {
    expect(passwordNotice(attempt({ refusal: "not-acknowledged" })).tone).toBe("warn");
    expect(passwordNotice(attempt({ refusal: "cannot-authenticate" })).tone).toBe("err");
    expect(passwordNotice(attempt({ refusal: "protection-unknown" })).tone).toBe("err");
  });

  it("never reports a page as written", () => {
    expect(attempt().wrotePages).toEqual([]);
    expect(pagesSentence(SET_PAGES)).toMatch(/None was written/i);
    expect(pagesSentence(SET_PAGES)).toContain("131, 133, 134");
    expect(pagesSentence([])).toMatch(/No configuration page/i);
  });
});
