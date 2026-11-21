/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReplacementConfirmation,
  replacementActionVariant,
  replacementTone,
} from "./ReplacementConfirmation";
// The two callers as text. "Both call sites render the one component" is a fact
// about their source rather than about any single render — and the clone path's
// whole defect was that it did not call it.
import authorSource from "./AuthorIdentity.tsx?raw";
import cloneSource from "./CloneWizard.tsx?raw";
import { replacementConfirmation, type WriteTarget } from "../lib/replacement";
import type { LfCard } from "../types";

/**
 * The one rendering of a write confirmation, shared by the two paths that show
 * one: authoring an Identity by hand and cloning onto what the user believes is
 * a Blank.
 *
 * It used to be markup copied into both components, and the copies drifted: the
 * clone path hardcoded the warn frame and ignored `destructive`, so the sentence
 * "you are overwriting a different tag" — the case where a Tag's Identity is
 * destroyed — read as the milder, routine treatment, while the author path got
 * the destructive one. Inconsistent is worse than absent: a user who is shown the
 * calm version of a destructive write learns the alarm means nothing. These tests
 * hold both paths to the same rendering, and hold the styling to the flag rather
 * than to the path.
 */

const TARGET: WriteTarget = {
  id: "55 00 84 82 12",
  customer: 0x55,
  facility: 0x84,
  card: 0x8212,
  data32: 0x0084_8212,
};

/** A Tag that already carries something else — the write destroys it. */
const CARRYING: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "77 00 AB CD EF",
};

/** A Tag that already carries the target Identity — the guard refuses it. */
const SAME: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: TARGET.id,
  facility: TARGET.facility,
  card: TARGET.card,
  raw: "55 00 84 82 12",
};

/** The write destroys a different Identity. */
const DESTRUCTIVE = replacementConfirmation(TARGET, { kind: "identified", card: CARRYING });
/** Nothing was read, so nothing is known to be destroyed. */
const BLANK = replacementConfirmation(TARGET, { kind: "no-identity" });
/** The Tag already carries what would be written. */
const ALREADY = replacementConfirmation(TARGET, { kind: "identified", card: SAME });

const render = (confirmation: typeof DESTRUCTIVE) =>
  renderToStaticMarkup(<ReplacementConfirmation confirmation={confirmation} />);

describe("the shared write confirmation", () => {
  it("gives the same visual treatment for the same case, whichever path showed it", () => {
    // Authoring and cloning build the confirmation in one module and render it
    // through one component, so the case — not the caller — decides the look.
    expect(replacementTone(true)).toEqual(replacementTone(DESTRUCTIVE.destructive));
    expect(replacementTone(false)).toEqual(replacementTone(BLANK.destructive));
    expect(replacementTone(true)).not.toEqual(replacementTone(false));
  });

  it("reads as destructive when an Identity is about to be destroyed", () => {
    const markup = render(DESTRUCTIVE);

    expect(DESTRUCTIVE.destructive).toBe(true);
    expect(markup).toContain("border-warn");
    expect(markup).toContain("bg-warn/5");
    expect(markup).toContain("text-warn");
    // The warning icon, so the block is not read as ordinary body text.
    expect(markup).toContain("<svg");
    // And the button that sends the write is the danger variant.
    expect(replacementActionVariant(DESTRUCTIVE.destructive)).toBe("danger");
  });

  it("does not cry destructive when nothing is known to be destroyed", () => {
    for (const calm of [BLANK, ALREADY]) {
      const markup = render(calm);

      expect(calm.destructive).toBe(false);
      expect(markup).not.toContain("warn");
      expect(markup).toContain("border-border");
      expect(markup).toContain("bg-surface/40");
      expect(markup).not.toContain("<svg");
      expect(replacementActionVariant(calm.destructive)).toBe("primary");
    }
  });

  it("names what is written and what it replaces, from the confirmation alone", () => {
    const markup = render(DESTRUCTIVE);

    expect(markup).toContain(TARGET.id);
    expect(markup).toContain(DESTRUCTIVE.title);
    for (const fact of DESTRUCTIVE.facts) {
      expect(markup).toContain(fact.title);
      expect(markup).toContain(fact.detail);
    }
  });
});

describe("the two write paths", () => {
  // Both paths must render the component rather than their own copy of it. This
  // is read from the source because the drift it prevents was a source-level
  // drift: one file kept a second, staler rendering of the same block.
  const CALLERS = [
    ["AuthorIdentity.tsx", authorSource],
    ["CloneWizard.tsx", cloneSource],
  ] as const;

  it("both render the shared component, and neither hand-rolls the frame", () => {
    for (const [file, source] of CALLERS) {
      expect(source, file).toContain("<ReplacementConfirmation");
      expect(source, file).toContain("replacementActionVariant");
      // The destructive frame lives in the component only.
      expect(source, file).not.toContain("bg-warn/5");
      expect(source, file).not.toContain("border-warn");
      // And neither path decides a danger variant for itself.
      expect(source, file).not.toContain('"danger" : "primary"');
    }
  });
});
