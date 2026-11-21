/**
 * The confirmation that names what an irreversible write will destroy.
 *
 * The spec's safety invariant is "every write is preceded by a confirmation
 * naming what will be replaced", and `write_guard::decide` permits writing over a
 * Tag that carries a **different** Identity: it refuses only an unreadable Tag
 * and a Tag already presenting the target. So on the two paths where the flow
 * itself has not read the Tag — authoring an Identity by hand, and cloning onto
 * what the user believes is a Blank — the value that is about to vanish is
 * exactly the value nobody named.
 *
 * This module is that naming, shared by both paths so the two cannot drift:
 *   - a Tag carrying another Identity is named in full (customer, facility, card
 *     and the 32-bit data field), and called out as **not a Blank**;
 *   - a Tag that reads no Identity says so, and says why that is ambiguous — a
 *     Blank and an empty reader look alike — rather than inventing a Blank;
 *   - a Tag already carrying the target Identity is reported as refused, because
 *     the guard will refuse it and an offered button would be a lie.
 *
 * It decides nothing about whether the write may happen. That is the guard's,
 * and it runs again on the Tag that is actually in position when the write is
 * sent: this is the sentence the user consents to, not a permission.
 */

import type { LfCard } from "../types";

/**
 * The Tag in the write position, as the confirmation step read it.
 *
 * Two cases, because the Reader cannot tell a Blank from an empty field: a 125
 * kHz read that returns no Identity covers both.
 */
export type WritePosition =
  | { readonly kind: "identified"; readonly card: LfCard }
  | { readonly kind: "no-identity" };

/** The Identity that is going to be written. `LfCard` and `IdentityPreview` both fit. */
export interface WriteTarget {
  readonly id: string;
  readonly customer: number;
  readonly facility: number;
  readonly card: number;
  readonly data32: number;
}

/** One consequence the user must read before the write is offered. */
export interface ReplacementFact {
  readonly title: string;
  readonly detail: string;
}

export interface ReplacementConfirmation {
  /** The heading: names what is written, and what it replaces. */
  readonly title: string;
  /** The irreversible button's own words. */
  readonly action: string;
  /** The Identity being written. */
  readonly identity: string;
  /** The Identity the Tag carries now, when one was read. */
  readonly replacing: string | null;
  readonly facts: readonly ReplacementFact[];
  /** True when another Identity is about to be destroyed. */
  readonly destructive: boolean;
  /**
   * True when the Tag already presents this Identity. The guard refuses that, so
   * no write should be offered: the user is told instead.
   */
  readonly alreadyCarries: boolean;
}

/** `0x` plus a value padded to `width` hex digits. */
function hexValue(n: number, width: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(width, "0")}`;
}

/**
 * Build the confirmation for one write.
 *
 * The target is the value the write will send, and the position is what the
 * Reader saw on the Tag — never what the flow assumed was there.
 */
export function replacementConfirmation(
  target: WriteTarget,
  position: WritePosition,
): ReplacementConfirmation {
  if (position.kind === "no-identity") {
    return {
      title: `Write ${target.id} to the tag on the reader`,
      action: `Write ${target.id} to this tag`,
      identity: target.id,
      replacing: null,
      destructive: false,
      alreadyCarries: false,
      facts: [
        {
          title: "No Identity was read",
          detail:
            "That is what a Blank looks like — a Tag that carries no Identity — and it is also " +
            "what an empty reader looks like, so this is not a claim that a Blank is there.",
        },
        {
          title: "The Reader reads the tag again before writing",
          detail:
            "A tag it cannot read at that moment is refused rather than written blind, and " +
            "nothing is sent.",
        },
      ],
    };
  }

  const card = position.card;
  const fields =
    `customer ${card.customer} (${hexValue(card.customer, 2)}), ` +
    `facility ${card.facility} (${hexValue(card.facility, 2)}), ` +
    `card ${card.card} (${hexValue(card.card, 4)}), ` +
    `data32 ${hexValue(card.data32, 8)}`;

  if (card.id === target.id) {
    return {
      title: `The tag on the reader already carries ${card.id}`,
      action: `Refused: the tag already carries ${card.id}`,
      identity: target.id,
      replacing: card.id,
      destructive: false,
      alreadyCarries: true,
      facts: [
        {
          title: "This write would be refused",
          detail:
            `The tag on the reader already presents ${card.id}, which is the Identity being ` +
            "written. That is almost always the source tag left on the reader.",
        },
        {
          title: "Put a Blank on the reader instead",
          detail:
            "A tag that already presents this Identity is never written again: writing it is " +
            "the ordering that has already locked one chip permanently.",
        },
      ],
    };
  }

  return {
    title: `Writing ${target.id} replaces ${card.id}`,
    action: `Replace ${card.id} with ${target.id}`,
    identity: target.id,
    replacing: card.id,
    destructive: true,
    alreadyCarries: false,
    facts: [
      {
        title: `The tag on the reader carries ${card.id}`,
        detail: `${fields}.`,
      },
      {
        title: "That Identity is destroyed by this write",
        detail:
          `The tag will present ${target.id} instead. The Identity it carries now cannot be ` +
          "recovered from the tag afterwards, and nothing here keeps a copy of it.",
      },
      {
        title: "That tag is not a Blank",
        detail:
          "A Blank carries no Identity. This tag carries one, so the write replaces it rather " +
          "than filling an empty tag. Take it off and put a Blank on the reader if that is not " +
          "what you meant.",
      },
    ],
  };
}
