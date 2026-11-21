import { describe, expect, it } from "vitest";
import { replacementConfirmation, type WriteTarget } from "./replacement";
import type { LfCard } from "../types";

/**
 * The confirmation that names what an irreversible write will DESTROY.
 *
 * Every write in this app is preceded by one, and the spec's requirement is
 * specific: it names what will be replaced, not only what will be written. The
 * guard permits writing over a Tag that carries a *different* Identity
 * (`write_guard::decide`), so authoring and cloning — the two paths where the
 * Tag in the write position has not been read by the flow itself — are exactly
 * where the old value can vanish unnamed.
 */

const TARGET: WriteTarget = {
  id: "55 00 84 82 12",
  customer: 0x55,
  facility: 0x84,
  card: 0x8212,
  data32: 0x0084_8212,
};

/** A Tag that already carries something else — the case that used to vanish. */
const CARRYING: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "77 00 AB CD EF",
};

function prose(confirmation: ReturnType<typeof replacementConfirmation>): string {
  return [
    confirmation.title,
    confirmation.action,
    ...confirmation.facts.map((fact) => `${fact.title} ${fact.detail}`),
  ].join(" ");
}

describe("a Tag carrying a different Identity", () => {
  const confirmation = replacementConfirmation(TARGET, { kind: "identified", card: CARRYING });
  const copy = prose(confirmation);

  it("names the Identity that will be destroyed, with all of its fields", () => {
    expect(confirmation.replacing).toBe(CARRYING.id);
    expect(confirmation.title).toContain(CARRYING.id);
    // customer, facility, card and the 32-bit data field, so the user can
    // recognise the credential they are about to lose.
    expect(copy).toContain("77");
    expect(copy).toContain("171"); // facility 0xAB
    expect(copy).toContain("52719"); // card 0xCDEF
    expect(copy).toContain("0x00ABCDEF");
  });

  it("names the Identity that will be written, so both are on one screen", () => {
    expect(confirmation.identity).toBe(TARGET.id);
    expect(confirmation.title).toContain(TARGET.id);
    expect(confirmation.action).toContain(TARGET.id);
  });

  it("says the old Identity is destroyed and cannot be recovered", () => {
    expect(copy).toMatch(/destroyed/i);
    expect(copy).toMatch(/cannot be recovered/i);
  });

  it("says the tag is not a Blank, because it carries an Identity", () => {
    expect(copy).toMatch(/not a Blank/i);
  });

  it("is marked destructive, so the action reads as the irreversible one", () => {
    expect(confirmation.destructive).toBe(true);
    expect(confirmation.alreadyCarries).toBe(false);
  });
});

describe("a Tag that reads no Identity at all", () => {
  const confirmation = replacementConfirmation(TARGET, { kind: "no-identity" });
  const copy = prose(confirmation);

  it("does not claim anything is being replaced", () => {
    expect(confirmation.replacing).toBeNull();
    expect(confirmation.destructive).toBe(false);
    expect(copy).not.toMatch(/replaces|destroyed/i);
  });

  it("says no Identity was read, and that a Blank and an empty field look alike", () => {
    expect(copy).toMatch(/no Identity/i);
    expect(copy).toMatch(/Blank/);
    expect(copy).toMatch(/empty (field|reader)/i);
  });

  it("says the Reader reads the tag again and refuses one it cannot read", () => {
    expect(copy).toMatch(/read(s)? (the tag|it) again/i);
    expect(copy).toMatch(/refus/i);
  });

  it("still names the Identity that will be written", () => {
    expect(confirmation.identity).toBe(TARGET.id);
    expect(confirmation.title).toContain(TARGET.id);
  });
});

describe("a Tag already carrying the target Identity", () => {
  const same: LfCard = { ...TARGET, raw: TARGET.id };
  const confirmation = replacementConfirmation(TARGET, { kind: "identified", card: same });
  const copy = prose(confirmation);

  it("says the write is refused rather than pretending to replace it", () => {
    expect(confirmation.alreadyCarries).toBe(true);
    expect(confirmation.destructive).toBe(false);
    expect(copy).toMatch(/refused/i);
    expect(copy).toMatch(/source|original/i);
    expect(copy).toMatch(/Blank/);
  });

  it("names the Identity it found, so the user can recognise the tag", () => {
    expect(confirmation.replacing).toBe(TARGET.id);
    expect(copy).toContain(TARGET.id);
  });
});

describe("the words", () => {
  it("never uses the terms the glossary retired", () => {
    const cases = [
      replacementConfirmation(TARGET, { kind: "identified", card: CARRYING }),
      replacementConfirmation(TARGET, { kind: "no-identity" }),
      replacementConfirmation(TARGET, {
        kind: "identified",
        card: { ...TARGET, raw: TARGET.id },
      }),
    ];
    for (const confirmation of cases) {
      expect(prose(confirmation)).not.toMatch(/badge|fob/i);
    }
  });

  it("always gives a reason, never an empty fact list", () => {
    const cases = [
      replacementConfirmation(TARGET, { kind: "identified", card: CARRYING }),
      replacementConfirmation(TARGET, { kind: "no-identity" }),
    ];
    for (const confirmation of cases) {
      expect(confirmation.facts.length).toBeGreaterThan(0);
      for (const fact of confirmation.facts) {
        expect(fact.title.trim()).not.toBe("");
        expect(fact.detail.trim()).not.toBe("");
      }
    }
  });
});
