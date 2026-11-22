/**
 * Authoring an Identity by hand: the ranges the form shows, the two ways an entry
 * can be written, and the confirmation that names exactly what will be sent.
 *
 * The conversion is deliberately **not** here. Turning customer/facility/card, or
 * five hex bytes, into an Identity is the Rust codec's job — `author_identity.rs`
 * on top of `identity.rs`, reached through `lf_identity_preview` and
 * `lf_identity_preview_hex`. That keeps one bit layout in the app, so this form
 * and the decoder that reports a read cannot disagree about what a facility code
 * is. Nothing in this module decides whether a value is in range either: it
 * carries what the user typed as far as the call, and words what comes back.
 *
 * What it does own is the copy. An authored write is irreversible on the Tag, so
 * the confirmation states what the guard will refuse and what a read-back has to
 * prove, before the write is offered rather than after it.
 */

import { copyWriteKind, severityOf, toneForSeverity } from "./severity";
import { refusalCauseOf, type WriteNotice } from "./writeOutcome";
import type { IdentityPreview, WriteResult } from "../types";

/** The two ways an Identity can be entered. */
export type AuthorMode = "parts" | "hex";

/** One field of the parts form. */
export interface AuthorFieldSpec {
  readonly id: "customer" | "facility" | "card";
  readonly label: string;
  readonly range: string;
}

/**
 * The parts form, with each field's valid range stated beside it. The ranges are
 * the same ones `author_identity.rs` refuses against, and the numbers are the
 * Identity's own: one customer byte, one facility byte, a two-byte card.
 */
export const PART_FIELDS: readonly AuthorFieldSpec[] = [
  { id: "customer", label: "Customer", range: "0–255 (0x00–0xFF)" },
  { id: "facility", label: "Facility", range: "0–255 (0x00–0xFF)" },
  { id: "card", label: "Card", range: "0–65535 (0x0000–0xFFFF)" },
];

/** What a raw entry must be, said once, in the digits it is written with. */
export const RAW_SHAPE_HINT =
  "Five bytes: 10 hex digits. The second byte must be 00, because the facility and card fields occupy the 24 bits after it.";

/** A raw Identity shaped like the ones this app writes. */
export const RAW_HEX_EXAMPLE = "55 00 84 82 12";

/** Bytes in a raw Identity entry. */
export const RAW_BYTES = 5;

/** Hex digits in a raw Identity entry. */
export const RAW_DIGITS = RAW_BYTES * 2;

export interface AuthorEntry {
  customer: string;
  facility: string;
  card: string;
  hex: string;
}

export const EMPTY_ENTRY: AuthorEntry = { customer: "", facility: "", card: "", hex: "" };

/**
 * A raw entry reduced to just its hex digits: no `0x`, no spaces, no separators,
 * upper case. Typing `55:00:84:82:12`, pasting `5500848212` and copying the
 * readout all become the same text, which is what the Rust parser expects.
 */
export function normalizeHexInput(text: string): string {
  const body = text.trim().replace(/^0x/i, "");
  return body.replace(/[\s:_-]/g, "").toUpperCase();
}

/**
 * How far through a raw entry the user is. Digits rather than bytes while typing:
 * a half-typed byte is a real state, and rounding it to "3 bytes" would claim
 * more was entered than was.
 */
export function hexEntryShape(text: string): {
  digits: number;
  bytes: number;
  complete: boolean;
} {
  const digits = normalizeHexInput(text).length;
  return { digits, bytes: Math.floor(digits / 2), complete: digits === RAW_DIGITS };
}

/**
 * Whether an entry is complete enough to be previewed.
 *
 * Only completeness, never validity: a complete entry that is out of range is
 * still sent, so the refusal that names the range comes from the code that owns
 * the range.
 */
export function canPreview(mode: AuthorMode, entry: AuthorEntry): boolean {
  if (mode === "hex") return hexEntryShape(entry.hex).complete;
  return (
    entry.customer.trim() !== "" && entry.facility.trim() !== "" && entry.card.trim() !== ""
  );
}

/** What an incomplete entry still needs, in the words of the field it is in. */
export function entryHint(mode: AuthorMode, entry: AuthorEntry): string {
  if (mode === "hex") {
    const shape = hexEntryShape(entry.hex);
    if (shape.complete) return RAW_SHAPE_HINT;
    return `${shape.digits} of ${RAW_DIGITS} hex digits. ${RAW_SHAPE_HINT}`;
  }
  return "Decimal, or hex with a 0x prefix. The ranges beside each field are what it will hold.";
}

/** The row that carries the bytes actually sent: what the Reader is asked for. */
export const PAYLOAD_FACT_LABEL = "Write payload";

/** One row of the confirmation: the label the user reads and the value shown. */
export interface PreviewFact {
  readonly label: string;
  readonly value: string;
}

/** `0x` plus a value padded to `width` hex digits. */
function hexValue(n: number, width: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(width, "0")}`;
}

/**
 * The exact Identity that will be written, as rows.
 *
 * The id comes first because it is the value every other surface shows, and the
 * write payload is last because it is the evidence: the bytes the Reader is
 * asked for. Both are produced by the Rust codec from the same Identity the
 * guard is handed, so nothing here restates the bit layout.
 */
export function previewFacts(preview: IdentityPreview): PreviewFact[] {
  return [
    { label: "Identity", value: preview.id },
    { label: "Customer", value: `${preview.customer} (${hexValue(preview.customer, 2)})` },
    { label: "Facility", value: `${preview.facility} (${hexValue(preview.facility, 2)})` },
    { label: "Card", value: `${preview.card} (${hexValue(preview.card, 4)})` },
    { label: "data32", value: hexValue(preview.data32, 8) },
    { label: PAYLOAD_FACT_LABEL, value: preview.payloadHex },
  ];
}

/** One consequence the user must read before the write is offered. */
export interface AuthorFact {
  readonly title: string;
  readonly detail: string;
}

/**
 * What the write will do, and what will stop it. Both refusals are stated as
 * facts because neither is dismissable: they are the fail-closed guard (ADR
 * 0001), not warnings.
 */
export const AUTHOR_FACTS: readonly AuthorFact[] = [
  {
    title: "The tag is read before it is written",
    detail:
      "A tag that cannot be read is refused outright and nothing is sent. Writing blind could overwrite the tag you took the value from, and one T5577 is already permanently locked by an earlier write.",
  },
  {
    title: "A tag already carrying this Identity is refused",
    detail:
      "That is almost always the tag the value came from, left on the reader. Take it off and put a Blank on instead.",
  },
  {
    title: "Only a read-back proves the Identity landed",
    detail:
      "A write that goes out but cannot be read back afterwards is reported as unknown, with what to do next. It is never counted as written.",
  },
];

/** Shown while the write is offered: where the tag goes and what it must be. */
export const BLANK_ON_READER_HINT =
  "Put a Blank on the reader — a 125 kHz tag that carries no Identity — flat and centred. The reader is read before it is written, so a tag that cannot be read is refused rather than written blind.";

/** The confirmation, ready to render. */
export interface AuthorConfirmation {
  /** The Identity that will be written, as the user saw it typed. */
  readonly identity: string;
  readonly title: string;
  /**
   * The label of the button that starts the write. It says *read then write*
   * rather than *write*, because the Tag in the write position is read before the
   * write is offered: the next screen names what that write will replace, and an
   * existing Identity is only visible once the Tag has been read.
   */
  readonly action: string;
  readonly facts: readonly AuthorFact[];
  /** Whether this write also keeps the Identity as a Snapshot in one action. */
  readonly keepSnapshot: boolean;
  readonly blankHint: string;
}

/**
 * Build the confirmation for one previewed Identity.
 *
 * It takes the preview rather than the raw entry so the confirmation can only
 * name an Identity the codec already produced: the value on screen is the value
 * on the wire, and the same Identity is handed to the write.
 */
export function authorConfirmation(
  preview: IdentityPreview,
  keepSnapshot: boolean,
): AuthorConfirmation {
  const facts = keepSnapshot
    ? [
        ...AUTHOR_FACTS,
        {
          title: "Kept as a Snapshot",
          detail:
            "A verified write adds this Identity to the library in the same step, so the value you typed is kept even if you lose the tag.",
        },
      ]
    : AUTHOR_FACTS;
  return {
    identity: preview.id,
    title: `Write ${preview.id} to the Blank on the reader?`,
    action: "Read the tag, then write",
    facts,
    keepSnapshot,
    blankHint: BLANK_ON_READER_HINT,
  };
}

/**
 * What a hand-authored write produced, worded for this flow.
 *
 * The outcome vocabulary is the shared one — `verified`, `refused`,
 * `unverified`, `failed` — and an unconfirmed read-back is "unknown" with the
 * next step named, never "failed". What this does **not** carry is the
 * library-count sentence: the Snapshot line beside it says what the library did,
 * and stating a count here as well would let the same screen say "no Snapshot
 * carries this Identity" and "kept as a Snapshot" at once.
 */
export function authorWriteNotice(result: WriteResult, targetId: string): WriteNotice {
  // The severity is the seam's, so this notice cannot be drawn in a calmer
  // tone than the sound the same write made (ADR 0008).
  const tone = toneForSeverity(
    severityOf(copyWriteKind(result.outcome, refusalCauseOf(result))),
  );
  switch (result.outcome) {
    case "verified":
      return {
        tone,
        text: `Written and verified — the tag reads ${result.readback?.id ?? targetId}.`,
      };
    case "refused":
      return {
        tone,
        text: `Not written: ${result.message ?? "the reader refused the write"}`,
      };
    case "unverified":
      return {
        tone,
        text:
          `Unknown: the write was sent, but the tag could not be read back, so whether ` +
          `${targetId} is on it is not known. Read the tag on the reader to find out: if it ` +
          `reads as ${targetId} the write landed, and if it does not, write it again.`,
      };
    case "failed":
      return {
        tone,
        text: `Not written: the write could not be sent${result.message ? ` (${result.message})` : ""}.`,
      };
    case "cleared":
    case "destroyed":
      // A hand-authored write aims at an Identity, so neither can happen. Naming it
      // is better than wording it as a result.
      return {
        tone,
        text:
          "Unexpected outcome: this write reported a cleared or destroyed tag, which authoring " +
          "cannot do. Nothing here counts it as written.",
      };
    case "erased":
      // Erasing NDEF content is its own operation with its own notice; see
      // `lib/eraseTag.ts`. An authoring write places an Identity, so this
      // cannot happen either, and naming it keeps it from being worded as one.
      return {
        tone,
        text:
          "Unexpected outcome: this write reported an erased tag, which authoring cannot do. " +
          "Erasing NDEF content has its own notice; nothing here counts it as written.",
      };
  }
}

/**
 * The Snapshot line after a verified write that was kept.
 *
 * The Snapshot is created from the read-back that proved the write, so it is
 * created *after* it: the confirmed-copy count starts at 0 rather than claiming
 * this write. Said here rather than left to be discovered, because a Snapshot
 * that appeared to ignore the write that made it would look like a bug.
 */
export function snapshotKeptNote(name: string): string {
  return (
    `Kept as a Snapshot in the library: ${name}, recorded from the read-back that proved this ` +
    `write. Its confirmed-copy count starts at 0, because the Snapshot was created after the ` +
    `write; only a later verified write raises it.`
  );
}

/** The Snapshot line when saving failed. The Tag is written either way. */
export function snapshotFailedNote(reason: string | null): string {
  const detail = reason ? ` (${reason})` : "";
  return `The tag was written, but the Snapshot could not be saved${detail}. The Identity is safe on the tag; save it from a read if you need it in the library.`;
}

/**
 * The Snapshot line when the Identity was already in the library.
 *
 * A repeat is not a fault: writing the same Identity to a second Blank is the
 * normal way to make a second copy, and the Snapshot already describes it.
 */
export function snapshotDuplicateNote(name: string): string {
  return `Already in the library as ${name}. The write is counted against it.`;
}
