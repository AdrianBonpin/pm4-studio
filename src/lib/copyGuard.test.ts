import { describe, expect, it } from "vitest";
import { bareCardUses, retiredTermsIn, unapprovedWords } from "./copyGuard";

/**
 * The guard that holds user-facing copy to GLOSSARY.md's vocabulary.
 *
 * It was written because a page subtitle read "Badges, fobs and elevator tags."
 * — and it did not catch that sentence. `\b(badge|fob)\b` matches the singular
 * and nothing else, so the plural sailed through, and the guard only failed
 * 5/5 because two unrelated tests happened to loop the same pages with a looser
 * pattern. A guard that cannot catch the defect it was written for is not a
 * guard, so the inflections are the first thing tested here and the historical
 * wording is quoted verbatim.
 */

describe("the retired-term guard", () => {
  it("catches the sentence that started this: 'Badges, fobs and elevator tags.'", () => {
    // Verbatim. This is the copy the guard was written to refuse.
    const original = "Badges, fobs and elevator tags.";
    const found = retiredTermsIn(original);
    expect(found).toContain("badges");
    expect(found).toContain("fobs");
    expect(unapprovedWords(original)).not.toEqual([]);
  });

  it("catches every retired term in singular, plural and possessive", () => {
    for (const term of ["badge", "fob", "chip", "transponder"]) {
      for (const form of [term, `${term}s`, `${term}'s`, `${term}’s`]) {
        expect(retiredTermsIn(`The ${form} is on the reader`)).toEqual([form]);
        expect(retiredTermsIn(`The ${form[0].toUpperCase()}${form.slice(1)} is on it`)).toEqual([
          form,
        ]);
      }
    }
  });

  it("matches whole words only, so a longer word that contains one is not copy", () => {
    // The boundary is load-bearing: without it the guard cries wolf, and a guard
    // that fails on legitimate words gets deleted rather than fixed.
    expect(retiredTermsIn("The cardboard box holds a badgeholder")).toEqual([]);
    expect(retiredTermsIn("fobby chipsets")).toEqual([]);
  });

  it("says nothing about a sentence in approved vocabulary", () => {
    const approved =
      "EM4100 tags. Read an Identity, Clone it onto a Blank, or blank a tag.";
    expect(retiredTermsIn(approved)).toEqual([]);
    expect(unapprovedWords(approved)).toEqual([]);
  });

  it("reports every hit, lowercased, so a failure names all of them", () => {
    expect(retiredTermsIn("Badges, fobs and CHIPS")).toEqual(["badges", "fobs", "chips"]);
  });
});

describe("the bare-'card' guard", () => {
  it("accepts the one approved use: 'card type'", () => {
    expect(bareCardUses("Read the UID, the card type, and the raw memory.")).toEqual([]);
    expect(bareCardUses("Read the UID and the card types.")).toEqual([]);
  });

  it("rejects 'card' and 'cards' anywhere else", () => {
    expect(bareCardUses("Tap a card on the reader")).toEqual(["card"]);
    expect(bareCardUses("Tap cards on the reader")).toEqual(["cards"]);
    expect(unapprovedWords("Tap a card on the reader")).toEqual(["card"]);
  });

  it("does not read 'card type' as an exemption for a bare 'card' in the same line", () => {
    expect(bareCardUses("The card type is Classic, so the card is a 1K")).toEqual(["card"]);
  });

  it("matches whole words only", () => {
    expect(bareCardUses("A cardboard sleeve")).toEqual([]);
  });
});
