/**
 * The copy guard: the one place GLOSSARY.md's retired vocabulary is enforced.
 *
 * Every user-facing string in this app is checked against the same list, and it
 * is checked here rather than in each test, because a guard copied into three
 * tests is three guards that drift. `pageCopy.test.ts`, `clearTag.test.ts` and
 * `eraseTag.test.ts` all call these functions; no test owns a pattern of its own.
 *
 * The vocabulary: a 125 kHz credential is a **Tag**, whatever its form factor,
 * and a 13.56 MHz serial is a **UID**. The form factor is never part of the
 * model, so `badge`, `fob`, `card` and `transponder` are retired as names for
 * the object. `chip` is retired in the same sense — it names a piece of silicon,
 * not the thing in the user's hand — and `card type` survives as an approved
 * term of its own: the derived label ("MIFARE Classic 1K") for a 13.56 MHz Tag's
 * family, which is never the Tag itself.
 *
 * Inflections matter more than they look. This guard was written because a page
 * subtitle read "Badges, fobs and elevator tags." and `\b(badge|fob)\b` matched
 * none of it: the singular matched, the plural — the form the defect actually
 * took — did not. So every term is matched in the forms real copy puts on it,
 * plural and possessive included.
 */

import { PAGES } from "./pageCopy";

/**
 * One retired term with the endings copy puts on it: the plural `s` and the
 * possessive `'s` (straight or typographic).
 *
 * None of the four takes `es` — "badges" is `badge` + `s`, not `badge` + `es`;
 * an `(s|es)?` alternation here would have produced "badgees" and matched
 * nothing real.
 *
 * The word boundaries stay. Dropping them is the other way to catch a plural,
 * and it makes the guard match "cardboard" and "chipset": a guard that fails on
 * legitimate words is a guard someone deletes rather than fixes.
 */
const RETIRED_INFLECTIONS = String.raw`\b(?:badges?|fobs?|chips?|transponders?)(?:['’]s)?\b`;

/** A bare `card`, with the same plural and possessive endings. */
const BARE_CARD = String.raw`\bcard(?:s|['’]s)?\b`;

/** `card type` and `card types`: the one approved use of "card". */
const APPROVED_CARD_TYPE = /\bcard types?\b/gi;

/** Every match of `pattern` in `text`, lowercased so a failure names the words. */
function matches(text: string, pattern: string): readonly string[] {
  // A fresh regex per call: a `/g` regex kept as a constant carries `lastIndex`
  // between calls, so the second check of the same string would start mid-word.
  return [...text.matchAll(new RegExp(pattern, "gi"))].map((match) => match[0].toLowerCase());
}

/** The retired terms in `text` — zero or more, in the order they appear. */
export function retiredTermsIn(text: string): readonly string[] {
  return matches(text, RETIRED_INFLECTIONS);
}

/**
 * Bare uses of "card" in `text`, after the approved `card type` is stripped.
 *
 * Separate from `retiredTermsIn` because the exemption is narrower here: `card
 * type` is allowed and nothing else containing "card" is, which is a rule about
 * this word rather than about the list.
 */
export function bareCardUses(text: string): readonly string[] {
  return matches(text.replace(APPROVED_CARD_TYPE, " "), BARE_CARD);
}

/**
 * Everything the glossary retires, in one call. This is the guard: a test asserts
 * the result is empty for any string a user can read.
 */
export function unapprovedWords(text: string): readonly string[] {
  return [...retiredTermsIn(text), ...bareCardUses(text)];
}

/**
 * The retired vocabulary in the shell's page copy, over every page.
 *
 * Each page's label, title and subtitle is user-facing text like any other, so it
 * is the same guard rather than a second one. It is offered as one call because
 * three tests looped `PAGES` with their own pattern each: the loops were the
 * guard, and a guard in three places is three guards that drift.
 */
export function pageCopyViolations(): readonly string[] {
  return PAGES.flatMap((page) =>
    unapprovedWords(`${page.label} ${page.title} ${page.subtitle}`).map(
      (word) => `${page.id}: ${word}`,
    ),
  );
}
