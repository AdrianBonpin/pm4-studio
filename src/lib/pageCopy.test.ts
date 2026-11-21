import { describe, expect, it } from "vitest";
import { PAGES, PAGE_SUBTITLES } from "./pageCopy";

/**
 * The shell's page copy is user-facing text like any other, so it is held to the
 * same glossary guard as a confirmation. It lives in a module rather than inside
 * `App.tsx` for exactly that reason: the guard could not reach it otherwise, and
 * a retired word in a page subtitle is the same defect as one in a confirmation.
 *
 * The words GLOSSARY.md retires for a physical transponder are `card`, `fob`,
 * `badge`, `chip` and `transponder`; "the object is a Tag". `card type` survives
 * as an approved term of its own (a derived 13.56 MHz label), which is why the
 * check below strips it before looking for a bare `card`.
 */

/** Words GLOSSARY.md retires, in the sense this app uses them. */
const RETIRED = /\b(badge|fob|chip|transponder)\b/i;

describe("the shell's page copy", () => {
  it("covers every page in the sidebar", () => {
    expect(PAGES.map((page) => page.id)).toEqual([
      "lf",
      "hf",
      "drafts",
      "library",
      "tools",
    ]);
    expect(PAGE_SUBTITLES).toHaveLength(PAGES.length);
    // Nothing may be blank: an empty hint is a hole, not restraint.
    for (const page of PAGES) {
      expect(page.title.trim()).not.toBe("");
      expect(page.subtitle.trim()).not.toBe("");
    }
  });

  it("never calls a Tag a badge, fob, chip or transponder", () => {
    for (const page of PAGES) {
      const copy = `${page.label} ${page.title} ${page.subtitle}`;
      expect(copy).not.toMatch(RETIRED);
    }
  });

  it("uses 'card' only in the approved term 'card type'", () => {
    for (const page of PAGES) {
      const withoutCardType = page.subtitle.replace(/card type/gi, "");
      expect(withoutCardType).not.toMatch(/\bcard/i);
    }
  });

  it("says 125 kHz copy in the same words as the 13.56 MHz copy", () => {
    // The two radio pages are siblings, and one was corrected to "tags" while
    // the other still said "badges, fobs".
    const lf = PAGES.find((page) => page.id === "lf");
    const hf = PAGES.find((page) => page.id === "hf");
    expect(lf?.subtitle).toMatch(/\btags\b/i);
    expect(hf?.subtitle).toMatch(/\btags\b/i);
  });

  it("names the objects the page works on, not the hardware's form factors", () => {
    const lf = PAGES.find((page) => page.id === "lf");
    expect(lf?.subtitle).toMatch(/Identity|Clone|Blank/);
  });
});
