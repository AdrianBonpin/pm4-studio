import { describe, expect, it } from "vitest";
import { bareCardUses, pageCopyViolations } from "./copyGuard";
import { PAGES, PAGE_SUBTITLES } from "./pageCopy";

/**
 * The shell's page copy is user-facing text like any other, so it is held to the
 * same glossary guard as a confirmation. It lives in a module rather than inside
 * `App.tsx` for exactly that reason: the guard could not reach it otherwise, and
 * a retired word in a page subtitle is the same defect as one in a confirmation.
 *
 * The words, and their inflections, live in `copyGuard.ts` — one guard shared
 * with the confirmation tests, so the three cannot drift apart.
 */

describe("the shell's page copy", () => {
  it("covers exactly the five destinations, in the order the sidebar shows them", () => {
    // The set is the ticket: 125 kHz · 13.56 MHz · Library · Tools · Settings.
    // A sixth entry, or a renamed one, is a change to the shell's navigation and
    // fails here rather than shipping quietly.
    expect(PAGES.map((page) => page.id)).toEqual([
      "lf",
      "hf",
      "library",
      "tools",
      "settings",
    ]);
    expect(PAGES.map((page) => page.label)).toEqual([
      "125 kHz",
      "13.56 MHz",
      "Library",
      "Tools",
      "Settings",
    ]);
    expect(PAGE_SUBTITLES).toHaveLength(PAGES.length);
    // Nothing may be blank: an empty hint is a hole, not restraint.
    for (const page of PAGES) {
      expect(page.title.trim()).not.toBe("");
      expect(page.subtitle.trim()).not.toBe("");
    }
  });

  it("does not offer Drafts as a destination, because Library holds it", () => {
    // Drafts stops being somewhere you navigate to. Library's subtitle may name
    // it — the collection is reachable from there — but no destination may.
    expect(PAGES.some((page) => (page.id as string) === "drafts")).toBe(false);
    expect(PAGES.some((page) => page.label === "Drafts")).toBe(false);
  });

  it("never calls a Tag a badge, fob, chip or transponder", () => {
    expect(pageCopyViolations()).toEqual([]);
  });

  it("uses 'card' only in the approved term 'card type'", () => {
    for (const page of PAGES) {
      expect(bareCardUses(page.subtitle)).toEqual([]);
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
