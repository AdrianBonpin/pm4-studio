/** HF decoder — seam S5.
 *
 * Turns the payload of one `0x0069` (13.56 MHz poll) reply into either a decoded
 * reading or an explicit raw-only reading. It is pure: bytes in, value out, no
 * hardware and no Reader knowledge.
 *
 * ## The layout is a HYPOTHESIS
 *
 * Every offset below comes from third-party client source. Not one byte of it
 * has been confirmed against a capture from this Reader:
 *
 * | Payload byte | Meaning (hypothesis)                          |
 * |--------------|-----------------------------------------------|
 * | 0            | validity flag: `0x01` = a Tag is latched      |
 * | 1            | constant `0x01`, carries nothing              |
 * | 2..6         | UID, 4 bytes                                  |
 * | 6..14        | unconfirmed tail                              |
 * | 14..16       | ATQA, two bytes, byte-swapped relative to how |
 * |              | NXP quotes it (feed straight to the resolver) |
 * | 16           | unconfirmed single byte                       |
 * | 17           | SAK of the last cascade level                 |
 * | 18           | unconfirmed trailing byte                     |
 *
 * The reply is 19 bytes and arrives in a single USB report, so nothing needs
 * reassembling here. Ticket 12 replaces the table above with a real capture,
 * which is why `HF_OFFSETS_CONFIRMED` stays false and every decoded value is
 * reported as provisional until then.
 *
 * ## Decode policy
 *
 * Decoded values appear only when the payload is the expected 19-byte shape,
 * the validity flag is set, the UID field holds a 4-byte UID, and the ATQA/SAK
 * pair resolves in the card type table. Anything else is a raw-only reading with
 * a reason: no card type, no capacity, no technologies, no UID split. A
 * confident wrong field is worse than a byte string, because the user cannot
 * tell it is wrong.
 *
 * Raw bytes are part of every reading, decoded or not.
 */

import { resolveCardType, type CardType } from "./cardType";
import type { TagNdefOutcome } from "./tagRecords";

/** The 13.56 MHz poll reply is 19 payload bytes. */
export const HF_POLL_PAYLOAD_LEN = 19;

/** A Tag this decoder can split has a 4-byte UID; wider UIDs are ticket 12. */
export const HF_UID_WIDTH = 4;

/** Offsets, kept in one place so the readout can describe them and so ticket 12
 *  has a single table to correct. Ranges are half-open. */
export const HF_POLL_LAYOUT = {
  validity: 0,
  uid: [2, 6],
  atqa: [14, 16],
  sak: 17,
} as const;

/**
 * Whether a real capture has settled the offsets above.
 *
 * False: derived from third-party source only, so the readout labels every
 * decoded value provisional. Ticket 12 flips this after capturing a real Tag —
 * flipping it without a capture would present a guess as a measurement.
 */
export const HF_OFFSETS_CONFIRMED = false;

/** Why a reading could not be decoded. Each maps to a message in the readout. */
export type HfRawOnlyReason =
  /** The reply contained something that is not a byte. */
  | "invalid-bytes"
  /** The reply was not 19 bytes, so the offsets cannot be trusted at all. */
  | "unexpected-length"
  /** The validity flag was clear: nothing is latched in the field. */
  | "not-latched"
  /** A Tag is latched but its UID field is all zeros. */
  | "empty-uid"
  /** The ATQA announces a 7- or 10-byte UID, which this layout cannot hold. */
  | "unsupported-uid-width"
  /** The ATQA/SAK pair matches nothing in the published table. */
  | "unknown-card-type";

/** Whether a Tag is NDEF formatted, and what settled the answer.
 *
 * A poll reply does not carry it: formatting is in the Tag's memory, in the Type 2
 * Capability Container. The Reader *can* read that memory (`0x0081` — the same
 * command the memory dump and the erase preview use), so the answer is available;
 * it just takes a second command. `formatted` is therefore null on a reading
 * taken from a poll alone, and `true`/`false` once a memory read of the same Tag
 * has settled it (`ndefStatusFor`). It is never filled in from the card family: an
 * NTAG215 can be unformatted, and a MIFARE Classic cannot hold NDEF at all, but a
 * family is still not a reading of the memory. */
export type NdefStatus = {
  formatted: boolean | null;
  /** What is known, and what would settle it. Never empty. */
  note: string;
};

/** A poll reply alone never answers it: the answer is one memory read away. */
const NDEF_NOT_READ_YET: NdefStatus = {
  formatted: null,
  note:
    "A poll reply carries no NDEF information: whether a Tag is formatted lives in its " +
    "memory, in the Type 2 Capability Container. Read the Tag's memory (0x0081) below and " +
    "the answer appears here.",
};

/**
 * The NDEF status a memory read settled, or the honest "read the memory" status
 * when no memory read has been taken (`null`).
 *
 * `outcome` is `tag_records::TagNdef`'s verdict on the Type 2 structure, so this
 * is a wording layer over one determination rather than a second opinion: the
 * erase and load panels read the same field out of the same reply.
 */
export function ndefStatusFor(outcome: TagNdefOutcome | null): NdefStatus {
  switch (outcome) {
    case null:
      return NDEF_NOT_READ_YET;
    case "message":
      return {
        formatted: true,
        note:
          "The Tag's memory was read: its Capability Container is a Type 2 one and its user " +
          "memory holds an NDEF message, so the Tag is NDEF formatted.",
      };
    case "empty":
      return {
        formatted: true,
        note:
          "The Tag's memory was read: it holds an empty NDEF TLV (03 00 FE), so it is NDEF " +
          "formatted and carries no Records.",
      };
    case "missing":
      return {
        formatted: true,
        note:
          "The Tag's memory was read: page 3 is a Type 2 Capability Container, so the Tag is " +
          "NDEF formatted, but its user memory holds no NDEF TLV yet.",
      };
    case "notFormatted":
      return {
        formatted: false,
        note:
          "The Tag's memory was read: page 3 is not a Type 2 Capability Container, so the Tag " +
          "is not NDEF formatted.",
      };
    case "unreadable":
      return {
        formatted: null,
        note:
          "The Tag's memory was read, but the NDEF area could not be parsed, so whether it is " +
          "formatted could not be determined from it. The raw bytes are shown below.",
      };
  }
}

/**
 * The NDEF row a readout shows, or `null` when there is nothing true to show.
 *
 * User story 56: a field this Reader cannot produce for a Tag must be omitted
 * rather than printed as a greyed "not determinable" row on every reading.
 */
export function ndefField(status: NdefStatus): { label: string; value: string } | null {
  if (status.formatted === null) return null;
  return { label: "NDEF formatted", value: status.formatted ? "yes" : "no" };
}

/**
 * Whether a memory read describes the Tag a reading came from.
 *
 * A poll's UID field holds the first four bytes of a wider UID, and a memory read
 * reports the whole thing, so the reading's bytes are a **prefix** of the dump's.
 * An empty UID never matches: a memory read of some other Tag must not be applied
 * to a reading that named none.
 */
export function uidMatchesMemory(readingUid: string, dumpUid: string): boolean {
  const reading = readingUid.trim().toUpperCase();
  const dump = dumpUid.trim().toUpperCase();
  if (reading === "" || dump === "") return false;
  return dump === reading || dump.startsWith(`${reading} `);
}

export type HfDecodedReading = {
  state: "decoded";
  /** The reply's payload as hex — always present, decoded or not. */
  raw: string;
  /** The UID the reply carries, e.g. `"DE AD BE EF"`. */
  uid: string;
  /** ATQA in the order the resolver takes it (transmission order). */
  atqa: readonly [number, number];
  /** SAK of the last cascade level. */
  sak: number;
  /** What the pair identifies, straight from the card type table. */
  cardType: CardType;
  ndef: NdefStatus;
  /** True while the offsets are unconfirmed — see `HF_OFFSETS_CONFIRMED`. */
  provisional: boolean;
};

export type HfRawReading = {
  state: "raw";
  /** The reply's payload as hex — always present, decoded or not. */
  raw: string;
  reason: HfRawOnlyReason;
  /** One sentence naming what failed, safe to show the user. */
  detail: string;
};

export type HfReading = HfDecodedReading | HfRawReading;

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xff;
}

/** Bytes as upper-case hex separated by spaces, e.g. `"DE AD BE EF"`. A value
 *  that is not a byte shows as `??` rather than a plausible-looking wrong
 *  number, so a broken reply is visible as broken. */
export function hexBytes(bytes: readonly number[]): string {
  return bytes
    .map((b) => (isByte(b) ? b.toString(16).toUpperCase().padStart(2, "0") : "??"))
    .join(" ");
}

function hex2(byte: number): string {
  return isByte(byte) ? byte.toString(16).toUpperCase().padStart(2, "0") : "??";
}

function rawOnly(raw: string, reason: HfRawOnlyReason, detail: string): HfRawReading {
  return { state: "raw", raw, reason, detail };
}

/** Where ISO/IEC 14443-3 keeps the UID size: the top two bits of the ATQA byte
 *  that carries bits 16..15. In this codebase's ATQA order that byte is
 *  `atqa[0]` — `cardType.ts` supplies the bytes transmission-order-first, so
 *  NXP's 0x0044 arrives as [0x44, 0x00]. */
function uidSizeName(atqa0: number): string | null {
  switch (atqa0 >> 6) {
    case 0:
      return null; // single size: 4 bytes
    case 1:
      return "a 7-byte";
    case 2:
      return "a 10-byte";
    default:
      return "a reserved-size";
  }
}

/**
 * Decode one 13.56 MHz poll payload.
 *
 * Never throws on hardware input: a payload of the wrong length, the wrong
 * shape, or with a byte that is not a byte produces a raw-only reading, because
 * the caller still has to show the user what came back.
 */
export function decodeHfPayload(payload: readonly number[]): HfReading {
  const raw = hexBytes(payload);

  if (!payload.every(isByte)) {
    return rawOnly(
      raw,
      "invalid-bytes",
      "The reply contained a value that is not a byte, so it cannot be decoded. " +
        "The raw bytes are shown above; `??` marks the bad one.",
    );
  }

  if (payload.length !== HF_POLL_PAYLOAD_LEN) {
    return rawOnly(
      raw,
      "unexpected-length",
      `Expected a ${HF_POLL_PAYLOAD_LEN}-byte 13.56 MHz reply and got ${payload.length} ` +
        "bytes. Every field offset would be a guess on a different shape, so nothing is decoded.",
    );
  }

  const flag = payload[HF_POLL_LAYOUT.validity];
  if (flag !== 0x01) {
    return rawOnly(
      raw,
      "not-latched",
      `The validity flag is 0x${hex2(flag)}, not 0x01: the Reader latched no Tag in this ` +
        "poll, so the rest of the reply is noise.",
    );
  }

  const [uidFrom, uidTo] = HF_POLL_LAYOUT.uid;
  const uidBytes = payload.slice(uidFrom, uidTo);
  if (uidBytes.length !== HF_UID_WIDTH) {
    return rawOnly(
      raw,
      "unsupported-uid-width",
      `The UID field is ${uidBytes.length} bytes and this decoder only splits ` +
        `${HF_UID_WIDTH}, so no UID is shown.`,
    );
  }
  if (uidBytes.every((b) => b === 0)) {
    return rawOnly(
      raw,
      "empty-uid",
      "The validity flag says a Tag is latched, but the UID field is all zeros. That is not " +
        "a UID, so none is shown.",
    );
  }

  const [atqaFrom, atqaTo] = HF_POLL_LAYOUT.atqa;
  const atqa = payload.slice(atqaFrom, atqaTo) as [number, number];
  const sak = payload[HF_POLL_LAYOUT.sak];

  const cardType = resolveCardType(atqa, sak);
  if (!cardType) {
    return rawOnly(
      raw,
      "unknown-card-type",
      `ATQA ${hexBytes(atqa)} with SAK ${hex2(sak)} matches no published ATQA/SAK ` +
        "assignment, so the family is not named. A wrong family is worse than none.",
    );
  }

  const widerUid = uidSizeName(atqa[0]);
  if (widerUid) {
    return rawOnly(
      raw,
      "unsupported-uid-width",
      `The ATQA announces ${widerUid} UID, but this reply's UID field holds ` +
        `${HF_UID_WIDTH} bytes and where the remaining bytes sit has never been captured. ` +
        "No UID is split rather than showing a fragment as if it were the whole UID.",
    );
  }

  return {
    state: "decoded",
    raw,
    uid: hexBytes(uidBytes),
    atqa,
    sak,
    cardType,
    ndef: NDEF_NOT_READ_YET,
    provisional: !HF_OFFSETS_CONFIRMED,
  };
}
